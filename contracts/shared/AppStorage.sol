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
}

struct AppStorage {
    PlatformConfig config;
    mapping(address => Merchant) merchants;
    address[] merchantList;
    mapping(bytes32 => PaymentChannel) channels;
    /// key = keccak256(abi.encodePacked(wallet, bankName, accountLast4))
    mapping(bytes32 => bool) channelDuplicateGuard;
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
}
