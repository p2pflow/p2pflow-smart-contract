// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice ID generation helper for payment channels.
library LibMerchants {
    function generateChannelId(
        address wallet,
        uint256 channelCount,
        uint256 chainId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("CHANNEL", wallet, channelCount, chainId));
    }
}
