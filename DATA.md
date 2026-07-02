# P2PFlow — Data, Events & Subgraph Reference

> Companion to [API.md](API.md). This file is for **querying**: what data lives
> where on-chain, every event the contracts emit, and every subgraph entity you
> can query on Goldsky (with example queries).
>
> Subgraph endpoint: `VITE_SUBGRAPH_URL` — currently
> `https://api.goldsky.com/api/public/project_cmqqvzyei1dna01up49sc4uxj/subgraphs/dev-sepolia/1.0.0/gn`.
>
> **Golden rule:** the subgraph is a **raw event log**. There is no `Merchant`
> or `PaymentChannel` entity — you reconstruct current state from the event
> streams (latest-timestamp-wins). If you need a live struct read, call the
> `MerchantFacet` view functions on the Diamond.

---

## Table of contents

1. [Where data lives](#1-where-data-lives)
2. [Slot 0 — AppStorage (business state)](#2-slot-0--appstorage-business-state)
3. [Keccak256 slot — Diamond routing state](#3-keccak256-slot--diamond-routing-state)
4. [All events (full reference)](#4-all-events-full-reference)
5. [Subgraph entities (Goldsky schema)](#5-subgraph-entities-goldsky-schema)
6. [Auto-injected fields on every entity](#6-auto-injected-fields-on-every-entity)
7. [Common query patterns](#7-common-query-patterns)
8. [Deriving current state from events](#8-deriving-current-state-from-events)
9. [Gotchas](#9-gotchas)

---

## 1. Where data lives

There are **three** places p2pflow data lives. Pick the right one per read:

| Source | Best for | Latency | Cost |
| --- | --- | --- | --- |
| **Diamond view calls** (RPC → `MerchantFacet.getMerchant(...)`, `ConfigFacet.getConfig()`, ...) | Live current state, one-off lookups, admin actions that need the exact latest value | Realtime | 1 RPC round trip per call |
| **Subgraph (Goldsky)** | History, lists, dashboards, per-wallet feeds, aggregations, "who did what when" | Delayed by 1–2 blocks | Free HTTP POST |
| **Direct log filters via `eth_getLogs`** | One-off debugging, custom indexing | Realtime | Slow — avoid in prod frontends |

Frontends should:

- **Use the subgraph** for anything list-shaped or historical (all channels,
  all merchants, activity feed, pending queue).
- **Use direct contract reads** for the current struct of a specific known
  merchant / channel when accuracy trumps freshness lag.

---

## 2. Slot 0 — AppStorage (business state)

All business data lives at storage slot 0 of the Diamond, under one struct:

```solidity
struct AppStorage {
    PlatformConfig config;                                // slot 0..N
    mapping(address => Merchant) merchants;               // dynamic slot per key
    address[] merchantList;
    mapping(bytes32 => PaymentChannel) channels;
    mapping(bytes32 => bool) channelDuplicateGuard;
    uint256 _reentrancyStatus;
}
```

Read paths (which facet exposes what):

| Data | Getter | Facet | Notes |
| --- | --- | --- | --- |
| `PlatformConfig` (admin, USDC, minStake, paused, initialized) | `getConfig()` | `ConfigFacet` | One struct, all fields |
| `Merchant` for a wallet | `getMerchant(address)` | `MerchantFacet` | Full struct incl. `channelIds[]` |
| Caller's own merchant | `getMyProfile()` | `MerchantFacet` | Same but uses `msg.sender` |
| Every registered merchant address | `getAllMerchants()` | `MerchantFacet` | Order = registration order |
| One `PaymentChannel` | `getChannel(bytes32)` | `MerchantFacet` | Zeros if unknown |
| All channels of one merchant | `getMerchantChannels(address)` | `MerchantFacet` | Any status, in add-order |
| Caller's channels | `getMyChannels()` | `MerchantFacet` | Same, for `msg.sender` |
| All PENDING channels | `getPendingChannels()` | `MerchantFacet` | O(N·M) — small deployments only |
| Duplicate guard hits | — | `MerchantFacet` | Internal-only. Not queryable via getter. |
| Diamond owner | `owner()` | `OwnershipFacet` | ERC-173 (stored in LibDiamond slot, not AppStorage) |

Full field layouts are in [API.md §3](API.md#3-appstorage--enums-structs-storage-layout).

---

## 3. Keccak256 slot — Diamond routing state

At `keccak256("diamond.standard.diamond.storage")` — not in `AppStorage`:

| Data | Getter | Facet |
| --- | --- | --- |
| Registered facet addresses | `facetAddresses()` | `DiamondLoupeFacet` |
| Selectors per facet | `facetFunctionSelectors(address)` | `DiamondLoupeFacet` |
| Facet that owns a selector | `facetAddress(bytes4)` | `DiamondLoupeFacet` |
| Everything at once | `facets()` | `DiamondLoupeFacet` |
| ERC-165 support flag | `supportsInterface(bytes4)` | `DiamondLoupeFacet` |
| Diamond owner | `owner()` | `OwnershipFacet` |

Not indexed by the subgraph. Query via RPC only.

---

## 4. All events (full reference)

Every event the contracts emit. `[i]` = `indexed` (queryable via `where:`).

### From `ConfigFacet`

| Event | Args | Emitted by |
| --- | --- | --- |
| `PlatformPaused` | `address [i] by` | `pausePlatform()` |
| `PlatformUnpaused` | `address [i] by` | `unpausePlatform()` |
| `MinMerchantStakeUpdated` | `uint256 newMinStakeUsdc` | `setMinMerchantStake()` |
| `PlatformAdminTransferred` | `address [i] previousAdmin`, `address [i] newAdmin` | `transferPlatformAdmin()` |

### From `MerchantFacet`

| Event | Args | Emitted by |
| --- | --- | --- |
| `MerchantRegistered` | `address [i] wallet`, `uint256 usdcLiquidity` | `registerMerchant()` |
| `UsdcDeposited` | `address [i] wallet`, `uint256 amount` | `depositStake()` |
| `UsdcWithdrawn` | `address [i] wallet`, `uint256 amount` | `approveMerchantUnstake()` (this is when USDC actually leaves) |
| `UnstakeRequested` | `address [i] wallet`, `uint256 amount` | `withdrawStake()` |
| `UnstakeRequestRejected` | `address [i] wallet` | `rejectMerchantUnstake()` |
| `AvailabilityChanged` | `address [i] wallet`, `MerchantAvailability availability` (uint8: 0=ONLINE, 1=OFFLINE) | `goOnline()`, `goOffline()` |
| `ChannelAdded` | `bytes32 [i] channelId`, `address [i] wallet` | `addPaymentChannel()` |
| `ChannelApproved` | `bytes32 [i] channelId`, `address [i] wallet` | `approveChannel()` |
| `ChannelRejected` | `bytes32 [i] channelId`, `address [i] wallet` | `rejectChannel()` |
| `ChannelAvailabilityChanged` | `bytes32 [i] channelId`, `address [i] wallet`, `ChannelAvailability availability` (uint8: 0=ACTIVE, 1=INACTIVE) | `setPaymentChannelActive()`, `setPaymentChannelInactive()` |
| `FiatMigrated` | `bytes32 [i] fromChannelId`, `bytes32 [i] toChannelId`, `address [i] wallet`, `uint256 amount` | `migrateAndTerminate()` (only when balance > 0) |
| `ChannelTerminated` | `bytes32 [i] channelId`, `address [i] wallet` | `migrateAndTerminate()` (always) |
| `MerchantBlacklisted` | `address [i] wallet` | `blacklistMerchant()` |
| `MerchantDisputed` | `address [i] wallet` | `setMerchantDisputed()` |
| `MerchantDisputeCleared` | `address [i] wallet` | `clearMerchantDispute()` |

### From `LibDiamond` (Diamond core)

| Event | Args | When |
| --- | --- | --- |
| `DiamondCut` | `FacetCut[] _diamondCut`, `address _init`, `bytes _calldata` | Every `diamondCut()` call (deploy + upgrades) |
| `OwnershipTransferred` | `address [i] previousOwner`, `address [i] newOwner` | Diamond constructor + `transferOwnership()` |

Note the difference: `PlatformAdminTransferred` (business event) vs
`OwnershipTransferred` (ERC-173). See [API.md §18](API.md#18-two-role-model-diamond-owner-vs-platform-admin).

---

## 5. Subgraph entities (Goldsky schema)

Goldsky auto-indexes one entity **per event**. Naming rule:

- Entity name = Solidity event name **camelCased** (first letter lowercased)
  and **pluralized with an `s`** in the query root.
- e.g. event `MerchantRegistered` → query root `merchantRegistereds`.
- One row = one emitted event. `id` = a unique per-log id (usually `txHash-logIndex`).

Every entity has the arg fields from §4 plus the [auto-injected fields](#6-auto-injected-fields-on-every-entity).

### Entity list (business events)

| Query root | Fields (event args) |
| --- | --- |
| `merchantRegistereds` | `wallet: Bytes`, `usdcLiquidity: BigInt` |
| `usdcDepositeds` | `wallet: Bytes`, `amount: BigInt` |
| `usdcWithdrawns` | `wallet: Bytes`, `amount: BigInt` |
| `unstakeRequesteds` | `wallet: Bytes`, `amount: BigInt` |
| `unstakeRequestRejecteds` | `wallet: Bytes` |
| `availabilityChangeds` | `wallet: Bytes`, `availability: Int` (0=ONLINE, 1=OFFLINE) |
| `channelAddeds` | `channelId: Bytes`, `wallet: Bytes` |
| `channelApproveds` | `channelId: Bytes`, `wallet: Bytes` |
| `channelRejecteds` | `channelId: Bytes`, `wallet: Bytes` |
| `channelAvailabilityChangeds` | `channelId: Bytes`, `wallet: Bytes`, `availability: Int` (0=ACTIVE, 1=INACTIVE) |
| `fiatMigrateds` | `fromChannelId: Bytes`, `toChannelId: Bytes`, `wallet: Bytes`, `amount: BigInt` |
| `channelTerminateds` | `channelId: Bytes`, `wallet: Bytes` |
| `merchantBlacklisteds` | `wallet: Bytes` |
| `merchantDisputeds` | `wallet: Bytes` |
| `merchantDisputeCleareds` | `wallet: Bytes` |
| `platformPauseds` | `by: Bytes` |
| `platformUnpauseds` | `by: Bytes` |
| `minMerchantStakeUpdateds` | `newMinStakeUsdc: BigInt` |
| `platformAdminTransferreds` | `previousAdmin: Bytes`, `newAdmin: Bytes` |

### Entity list (Diamond core)

| Query root | Fields |
| --- | --- |
| `ownershipTransferreds` | `previousOwner: Bytes`, `newOwner: Bytes` |
| `diamondCuts` | `init: Bytes`, `calldata: Bytes` (the `_diamondCut` array is usually decoded as a nested type in the generated schema — inspect via GraphiQL) |

### Meta

| Query root | Fields |
| --- | --- |
| `_meta` | `block { number, timestamp, hash }`, `deployment: String`, `hasIndexingErrors: Boolean` |

---

## 6. Auto-injected fields on every entity

Goldsky adds these to **every** event entity:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `ID` | Per-log unique id (safe to use as React key) |
| `block_number` | `BigInt` | Block the event was emitted in |
| `timestamp_` | `BigInt` | Block timestamp (seconds) — **note the trailing underscore** |
| `transactionHash_` | `Bytes` | Tx hash — **trailing underscore** |
| `contractId_` | `Bytes` | Address of the emitting contract (always the Diamond in our case) |

**Watch the trailing underscore on `timestamp_` and `transactionHash_`.** It's
a Goldsky quirk to avoid clashing with GraphQL reserved words. If you write
`timestamp` (no underscore) the query silently returns nothing for that field.

Ordering is done via these fields:

```graphql
orderBy: timestamp_
orderDirection: desc
```

---

## 7. Common query patterns

Copy-pasteable. All examples assume lower-cased hex addresses.

### 7.1 Is a wallet registered?

```graphql
query IsRegistered($wallet: String!) {
  merchantRegistereds(
    where: { wallet: $wallet }
    first: 1
    orderBy: timestamp_
    orderDirection: desc
  ) {
    id
    usdcLiquidity
    timestamp_
    transactionHash_
  }
}
```

Registered if the array length ≥ 1.

### 7.2 Full merchant profile (one round trip)

```graphql
query MerchantProfile($wallet: String!) {
  merchantRegistereds(where: { wallet: $wallet }, first: 1, orderBy: timestamp_, orderDirection: desc) {
    id wallet usdcLiquidity timestamp_ transactionHash_
  }
  merchantBlacklisteds(where: { wallet: $wallet }, first: 1, orderBy: timestamp_, orderDirection: desc) {
    id timestamp_
  }
  merchantDisputeds(where: { wallet: $wallet }, first: 1, orderBy: timestamp_, orderDirection: desc) {
    id timestamp_
  }
  merchantDisputeCleareds(where: { wallet: $wallet }, first: 1, orderBy: timestamp_, orderDirection: desc) {
    id timestamp_
  }
  availabilityChangeds(where: { wallet: $wallet }, first: 1, orderBy: timestamp_, orderDirection: desc) {
    id availability timestamp_
  }
  unstakeRequesteds(where: { wallet: $wallet }, first: 1, orderBy: timestamp_, orderDirection: desc) {
    id amount timestamp_
  }
  unstakeRequestRejecteds(where: { wallet: $wallet }, first: 1, orderBy: timestamp_, orderDirection: desc) {
    id timestamp_
  }
}
```

Derivation logic: [§8](#8-deriving-current-state-from-events).

### 7.3 All channels for a wallet (any status)

```graphql
query MerchantChannels($wallet: String!, $first: Int! = 200) {
  channelAddeds(where: { wallet: $wallet }, first: $first, orderBy: timestamp_, orderDirection: desc) {
    id channelId timestamp_ transactionHash_
  }
  channelApproveds(where: { wallet: $wallet }, first: $first, orderBy: timestamp_, orderDirection: desc) {
    id channelId timestamp_
  }
  channelRejecteds(where: { wallet: $wallet }, first: $first, orderBy: timestamp_, orderDirection: desc) {
    id channelId timestamp_
  }
  channelTerminateds(where: { wallet: $wallet }, first: $first, orderBy: timestamp_, orderDirection: desc) {
    id channelId timestamp_
  }
  channelAvailabilityChangeds(where: { wallet: $wallet }, first: $first, orderBy: timestamp_, orderDirection: desc) {
    id channelId availability timestamp_
  }
}
```

### 7.3b All merchants + all their payment channels (single query)

One round trip. Returns every merchant registration and every channel event
across the whole platform, then you group them client-side by `wallet` /
`channelId`. The subgraph has no nested `merchant.channels` relation, so this
is the correct pattern.

```graphql
query AllMerchantsAndChannels($first: Int! = 1000) {
  merchantRegistereds(first: $first, orderBy: timestamp_, orderDirection: asc) {
    id
    wallet
    usdcLiquidity
    timestamp_
    transactionHash_
  }
  channelAddeds(first: $first, orderBy: timestamp_, orderDirection: asc) {
    id
    channelId
    wallet
    timestamp_
    transactionHash_
  }
  channelApproveds(first: $first, orderBy: timestamp_, orderDirection: asc) {
    channelId
    wallet
    timestamp_
  }
  channelRejecteds(first: $first, orderBy: timestamp_, orderDirection: asc) {
    channelId
    wallet
    timestamp_
  }
  channelTerminateds(first: $first, orderBy: timestamp_, orderDirection: asc) {
    channelId
    wallet
    timestamp_
  }
  channelAvailabilityChangeds(first: $first, orderBy: timestamp_, orderDirection: asc) {
    channelId
    wallet
    availability
    timestamp_
  }
}
```

Client-side join (JS) — assembles `[{ merchant, channels: [...] }]`:

```js
function groupMerchantsWithChannels(data) {
  const byChannelId = new Map();

  // Seed one row per channel from ChannelAdded (that's when it exists).
  for (const c of data.channelAddeds) {
    byChannelId.set(c.channelId, {
      channelId: c.channelId,
      wallet: c.wallet,
      addedAt: Number(c.timestamp_),
      status: "PENDING",           // default until a resolution event overrides
      statusAt: Number(c.timestamp_),
      availability: "ACTIVE",      // implicit on approval; overridden below if event exists
      availabilityAt: -1,
    });
  }

  // Latest-timestamp-wins for status (see §8).
  const applyStatus = (rows, label) => {
    for (const r of rows) {
      const ch = byChannelId.get(r.channelId);
      if (!ch) continue;
      const ts = Number(r.timestamp_);
      if (ts >= ch.statusAt) { ch.status = label; ch.statusAt = ts; }
    }
  };
  applyStatus(data.channelApproveds,   "APPROVED");
  applyStatus(data.channelRejecteds,   "REJECTED");
  applyStatus(data.channelTerminateds, "TERMINATED");

  // Availability toggles only meaningful for APPROVED channels.
  for (const r of data.channelAvailabilityChangeds) {
    const ch = byChannelId.get(r.channelId);
    if (!ch) continue;
    const ts = Number(r.timestamp_);
    if (ts > ch.availabilityAt) {
      ch.availability = Number(r.availability) === 0 ? "ACTIVE" : "INACTIVE";
      ch.availabilityAt = ts;
    }
  }

  // Group channels by wallet.
  const channelsByWallet = new Map();
  for (const ch of byChannelId.values()) {
    if (!channelsByWallet.has(ch.wallet)) channelsByWallet.set(ch.wallet, []);
    channelsByWallet.get(ch.wallet).push(ch);
  }

  // Emit one row per merchant.
  return data.merchantRegistereds.map((m) => ({
    merchant: {
      wallet: m.wallet,
      usdcLiquidityAtRegister: m.usdcLiquidity,
      registeredAt: Number(m.timestamp_),
    },
    channels: channelsByWallet.get(m.wallet) ?? [],
  }));
}
```

Notes:

- `first: 1000` is the graph-node hard cap per collection. For platforms
  exceeding that, paginate each list independently with `skip:` and merge —
  or move this to the on-chain call `getAllMerchants()` +
  `getMerchantChannels(wallet)` in a `Promise.all`.
- Fetches the whole world; run once per session and cache. Don't call this on
  every keystroke of a search box.
- Availability defaults to `"ACTIVE"` because the contract sets it implicitly
  on `approveChannel()` without emitting `ChannelAvailabilityChanged` (see
  [§8 → Channel availability](#8-deriving-current-state-from-events)).

To resolve a channel's current status: pick the entity with the highest
`timestamp_` between `channelApproveds`, `channelRejecteds`, `channelTerminateds`
for that `channelId`. If none, it's still `PENDING`.

### 7.4 Pending channels queue (admin view)

```graphql
query PendingChannels($first: Int! = 200) {
  channelAddeds(first: $first, orderBy: timestamp_, orderDirection: asc) {
    id channelId wallet timestamp_ transactionHash_
  }
  channelApproveds(first: 1000) { channelId }
  channelRejecteds(first: 1000) { channelId }
  channelTerminateds(first: 1000) { channelId }
}
```

Client-side: filter out every `channelId` present in `channelApproveds`,
`channelRejecteds`, or `channelTerminateds`. What's left is `PENDING`.

Better long-term: get the pending list from
`MerchantFacet.getPendingChannels()` (contract) and only use the subgraph for
the *added-at* timestamp.

### 7.5 Merchant activity feed (deposits / withdrawals / fiat migrations)

```graphql
query MerchantActivity($wallet: String!, $first: Int! = 100) {
  usdcDepositeds(where: { wallet: $wallet }, first: $first, orderBy: timestamp_, orderDirection: desc) {
    id amount timestamp_ transactionHash_
  }
  usdcWithdrawns(where: { wallet: $wallet }, first: $first, orderBy: timestamp_, orderDirection: desc) {
    id amount timestamp_ transactionHash_
  }
  fiatMigrateds(where: { wallet: $wallet }, first: $first, orderBy: timestamp_, orderDirection: desc) {
    id fromChannelId toChannelId amount timestamp_ transactionHash_
  }
}
```

Cumulative liquidity = `sum(usdcDepositeds.amount) + sum(initial-registration.usdcLiquidity) − sum(usdcWithdrawns.amount)`.

### 7.6 Platform config history

```graphql
query PlatformConfig {
  minMerchantStakeUpdateds(first: 1, orderBy: timestamp_, orderDirection: desc) {
    newMinStakeUsdc timestamp_
  }
  platformPauseds(first: 1, orderBy: timestamp_, orderDirection: desc) {
    by timestamp_
  }
  platformUnpauseds(first: 1, orderBy: timestamp_, orderDirection: desc) {
    by timestamp_
  }
  platformAdminTransferreds(first: 1, orderBy: timestamp_, orderDirection: desc) {
    previousAdmin newAdmin timestamp_
  }
}
```

Currently paused iff `platformPauseds[0].timestamp_ > platformUnpauseds[0].timestamp_`
(with `-1` for missing rows).

### 7.7 Indexer health

```graphql
query Meta {
  _meta {
    block { number timestamp hash }
    deployment
    hasIndexingErrors
  }
}
```

Poll every 30s; alert if `hasIndexingErrors === true` or `block.number` lags
the RPC head by more than N blocks.

### 7.8 Filter helpers

- **Multiple wallets:** `where: { wallet_in: ["0xaaaa...", "0xbbbb..."] }`
- **Time range:** `where: { timestamp__gte: "1719878400", timestamp__lte: "1720483200" }`
  (note the double underscore: field is `timestamp_`, comparator is `_gte` →
  `timestamp__gte`)
- **Amount threshold:** `where: { amount_gt: "1000000000" }` (BigInt strings)
- **Channel id:** `where: { channelId: "0xabc...def" }` (32-byte hex string)
- **Pagination:** `first: 100, skip: 200` — max `first` is 1000

Case rule: **all address `where` values must be lower-cased**. The subgraph
stores them lower-cased. `0xAbC…` will match nothing.

---

## 8. Deriving current state from events

The subgraph doesn't materialize `Merchant` or `PaymentChannel` — you rebuild
them client-side. The rules:

### Merchant account status

Start with `ACTIVE`. Then apply latest-timestamp-wins among:

- `merchantBlacklisteds` → `BLACKLISTED` (terminal — nothing overrides this on-chain)
- `merchantDisputeds` → `DISPUTED`
- `merchantDisputeCleareds` → `ACTIVE`
- `unstakeRequesteds` (unresolved) → `INACTIVE`
- `unstakeRequestRejecteds` after `unstakeRequesteds` → back to `ACTIVE`
- `usdcWithdrawns` after `unstakeRequesteds` → `ACTIVE` (unstake was approved)

Reference implementation: [p2pflow-admin-ui/src/hooks/useSubgraph.js](../p2pflow-admin-ui/src/hooks/useSubgraph.js) → `useMerchantProfile`.

### Merchant availability

Latest `availabilityChangeds.availability` wins. Default to `OFFLINE` if none
recorded (matches the contract behavior on brand-new merchants who haven't
toggled since registration — but note that at registration `availability` is
set to `ONLINE` in the struct, without emitting `AvailabilityChanged`. If you
need the true initial value use `MerchantFacet.getMerchant()`.).

### Channel status

For a given `channelId`, take the max `timestamp_` across:

- `channelApproveds` → `APPROVED`
- `channelRejecteds` → `REJECTED`
- `channelTerminateds` → `TERMINATED`

If none exist and `channelAddeds` does → `PENDING`.

### Channel availability

For an `APPROVED` channel, latest `channelAvailabilityChangeds.availability`
wins. On approval the contract sets `ACTIVE` implicitly (no
`ChannelAvailabilityChanged` emitted at that moment), so:

- If `channelAvailabilityChangeds` for this id is empty → treat as `ACTIVE`
  (matches contract default post-approval).
- Otherwise use the latest event.

### Fiat balances

The subgraph does not directly emit `fiatBalance` on approval / transfer.
`FiatMigrated.amount` tells you what moved between channels. If you need the
current balance of a specific channel, call `MerchantFacet.getChannel(id)`
on-chain.

### Unstake state

- `hasUnstakeRequest = max_ts(unstakeRequesteds) > max_ts(unstakeRequestRejecteds)`
- If the latest `usdcWithdrawns.timestamp_ > latest unstakeRequesteds.timestamp_`,
  the unstake was approved and completed.

---

## 9. Gotchas

1. **`timestamp_` and `transactionHash_` have trailing underscores.** Miss it,
   get null. Always double-check the field name.
2. **Addresses in `where:` must be lower-case hex.** Even though the returned
   `Bytes` fields render lower-case, filters are strict string compares.
3. **Enums are stored as `Int` (uint8).** `availability: 0` means `ONLINE` for
   merchants and `ACTIVE` for channels — different enum, same numeric encoding.
   Always compare against the right enum table (§4).
4. **There is no cross-entity `wallet.channels` relation.** You issue one query
   per event type and join client-side on `channelId` / `wallet`.
5. **`getPendingChannels()` on-chain vs subgraph-derived pending list** can
   momentarily disagree because the subgraph lags ~1–2 blocks. If you're
   showing a queue that admins act on, prefer the on-chain call for the
   authoritative list and the subgraph only for enrichment.
6. **Availability at registration is not emitted.** A brand-new `ACTIVE`+`ONLINE`
   merchant has no `AvailabilityChanged` event. Fall back to `getMerchant()`
   if this matters for your UI.
7. **`FiatMigrated` is only emitted when `amount > 0`.** Terminating a channel
   with a zero balance emits `ChannelTerminated` alone.
8. **`UsdcWithdrawn` fires on unstake *approval*, not on `withdrawStake()`.**
   That's when USDC actually leaves. `UnstakeRequested` is the initial merchant
   action.
9. **Max page size is 1000.** Beyond that, paginate with `skip:` in increments
   of `first:`.
10. **The subgraph is versioned in the URL** (`.../1.0.0/gn`). If the contract
    ABI changes (new event, changed indexed fields), a new subgraph version
    ships at a new URL — update `VITE_SUBGRAPH_URL`.
