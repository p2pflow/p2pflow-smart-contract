// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// =============================================================================
// AppStorage.sol — Single Source of Truth for All Diamond State
//
// PATTERN: "AppStorage at Slot 0" + Modifiers inheritance
// Source: https://eips.ethereum.org/EIPS/eip-2535#facets-state-variables-and-diamond-storage
//
// WHY THIS PATTERN:
// In a Diamond, all facets share the same storage via delegatecall.
// If two facets declare state variables independently, Solidity assigns
// both to slot 0 and they overwrite each other. Bug city.
//
// Fix: Put ALL state in ONE struct (AppStorage). Every facet inherits
// the Modifiers contract which places AppStorage at slot 0. Since every
// facet starts with the same struct at the same slot, they share cleanly.
//
// LibDiamond (proxy machinery) stores its own state at a keccak256 slot
// far away, so it never touches slot 0 either.
//
// HOW TO USE IN YOUR FACETS:
//   import "../shared/AppStorage.sol";
//   contract MyFacet is Modifiers {
//       function doSomething() external notPaused {
//           s.paused = true;   // s is AppStorage, available via inheritance
//       }
//   }
// =============================================================================

// =============================================================================
// ENUMS
// Add your domain enums here when building business facets.
// Example:
//   enum OrderStatus { Pending, Accepted, PaymentSent, Completed, Disputed, Cancelled }
//   enum MerchantStatus { Inactive, Active, Paused, Banned }
//   enum DisputeResolution { None, UserWins, MerchantWins, Split }
// =============================================================================

// =============================================================================
// STRUCTS
// Add your domain structs here when building business facets.
// Example:
//   struct Order { bytes32 orderId; address user; address merchant; ... }
//   struct Merchant { bytes32 merchantId; address wallet; ... }
//   struct Dispute { bytes32 disputeId; bytes32 orderId; ... }
// =============================================================================

// =============================================================================
// AppStorage — THE MASTER STATE STRUCT
//
// Rules:
//   1. NEVER declare state variables inside a facet contract directly.
//   2. ALL state must live here in AppStorage.
//   3. Add fields as you build facets. Never remove or reorder existing fields
//      after deployment (that breaks storage layout on-chain).
// =============================================================================
struct AppStorage {
    // Platform
    address usdcToken;           // ERC-20 token for payments (USDC)
    address treasury;            // receives platform fees
    uint256 platformFeeBps;      // platform fee, e.g. 50 = 0.5%
    bool    paused;              // global emergency pause

    // Access control
    address admin;               // primary admin
    mapping(address => bool) isAdmin;
    address[] adminList;

    // Add your domain mappings below as you build facets:
    // mapping(bytes32 => Order)    orders;
    // mapping(bytes32 => Merchant) merchants;
    // mapping(address => bytes32)  walletToMerchantId;
    // bytes32[]                    allOrderIds;
    // ...
}

// =============================================================================
// Modifiers — Base contract every facet inherits
//
// Declaring `AppStorage internal s` here at slot 0 is the KEY to the pattern.
// When a facet inherits Modifiers:
//   - It gets `s` pointing to slot 0 of the Diamond's storage
//   - All facets share the same `s` because they all delegatecall into the
//     Diamond's storage space
//   - You get common modifiers for free
//
// IMPORTANT: Never add any other state variables before `s` in this contract
// or any contract it inherits from. That would shift `s` off slot 0.
// =============================================================================
contract Modifiers {
    AppStorage internal s;

    modifier onlyAdmin() {
        require(
            s.isAdmin[msg.sender] || msg.sender == s.admin,
            "Modifiers: Not admin"
        );
        _;
    }

    modifier notPaused() {
        require(!s.paused, "Modifiers: Platform is paused");
        _;
    }
}
