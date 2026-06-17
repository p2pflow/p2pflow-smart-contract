// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// =============================================================================
// AppStorage — merchant + platform config only (Diamond delegatecall slot 0)
// =============================================================================

/// @notice Merchant account standing — admin only (not self-service), except
///         INACTIVE which is set when the merchant has a pending USDC unstake request.
enum MerchantAccountStatus {
    ACTIVE,
    INACTIVE, // unstake requested; waiting for admin approve / reject
    BLACKLISTED,
    DISPUTED
}

/// @notice Merchant presence — merchant toggles when account is ACTIVE
enum MerchantAvailability {
    ONLINE,
    OFFLINE
}

/// @notice Channel lifecycle — admin sets APPROVED / REJECTED / TERMINATED
enum ChannelStatus {
    PENDING,
    APPROVED,
    REJECTED,
    TERMINATED
}

/// @notice When APPROVED, merchant toggles ACTIVE / INACTIVE for taking orders
enum ChannelAvailability {
    ACTIVE,
    INACTIVE
}

struct Merchant {
    address wallet;
    MerchantAccountStatus accountStatus;
    MerchantAvailability availability;
    uint256 usdcLiquidity; // USDC custodied for this merchant (incl. stake)
    /// @dev Full-liquidity snapshot when `withdrawStake()` request is raised; cleared on approve/reject.
    bool unstakePending;
    uint256 unstakeRequestedAmount;
    string telegramUsername;
    uint256 registeredAt;
    bytes32[] channelIds;
}

struct PaymentChannel {
    bytes32 channelId;
    address merchant;
    string bankName;
    string accountLast4;
    string upiId;
    string label;
    ChannelStatus status;
    ChannelAvailability availability;
    uint256 fiatBalance;
    uint256 appliedAt;
    uint256 reviewedAt;
}

/// @notice Bare platform configuration (initialized in DiamondInit)
struct PlatformConfig {
    address admin;
    address usdcToken;
    bool paused;
    uint256 minMerchantStakeUsdc;
    /// @dev Set once by DiamondInit; later upgrades must NOT re-initialize.
    bool initialized;
}

struct AppStorage {
    PlatformConfig config;
    mapping(address => Merchant) merchants;
    address[] merchantList;
    mapping(bytes32 => PaymentChannel) channels;
    /// key = keccak256(abi.encodePacked(wallet, normalizedBankName, accountLast4))
    mapping(bytes32 => bool) channelDuplicateGuard;
    /// @dev Diamond-safe reentrancy lock. 0 = unset (treated as not entered), 1 = not entered, 2 = entered.
    uint256 _reentrancyStatus;
}

contract Modifiers {
    AppStorage internal s;

    modifier onlyAdmin() {
        require(msg.sender == s.config.admin, "Not admin");
        _;
    }

    modifier notPaused() {
        require(!s.config.paused, "Platform is paused");
        _;
    }

    /// @notice Diamond-safe reentrancy guard. Backed by an AppStorage slot so all facets
    ///         that delegatecall into the Diamond share the same lock.
    modifier nonReentrant() {
        require(s._reentrancyStatus != 2, "ReentrancyGuard: reentrant call");
        s._reentrancyStatus = 2;
        _;
        s._reentrancyStatus = 1;
    }
}
