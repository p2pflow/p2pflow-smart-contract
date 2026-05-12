// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Modifiers, PlatformConfig } from "../shared/AppStorage.sol";

/// @notice Platform configuration reads and admin controls (initialized in DiamondInit).
contract ConfigFacet is Modifiers {
    event PlatformPaused(address indexed by);
    event PlatformUnpaused(address indexed by);
    event MinMerchantStakeUpdated(uint256 newMinStakeUsdc);
    event PlatformAdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    function getConfig() external view returns (PlatformConfig memory) {
        return s.config;
    }

    function pausePlatform() external onlyAdmin {
        s.config.paused = true;
        emit PlatformPaused(msg.sender);
    }

    function unpausePlatform() external onlyAdmin {
        s.config.paused = false;
        emit PlatformUnpaused(msg.sender);
    }

    function setMinMerchantStake(uint256 minStakeUsdc) external onlyAdmin {
        s.config.minMerchantStakeUsdc = minStakeUsdc;
        emit MinMerchantStakeUpdated(minStakeUsdc);
    }

    function transferPlatformAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Zero address");
        address prev = s.config.admin;
        s.config.admin = newAdmin;
        emit PlatformAdminTransferred(prev, newAdmin);
    }
}
