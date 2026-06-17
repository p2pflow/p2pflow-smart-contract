// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Helpers for channel ID generation and field normalization.
library LibMerchants {
    function generateChannelId(
        address wallet,
        uint256 channelCount,
        uint256 chainId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("CHANNEL", wallet, channelCount, chainId));
    }

    /// @notice Normalize a bank name for the duplicate guard: trim ASCII whitespace from
    ///         both ends, then lowercase ASCII A-Z. This prevents trivial dedup bypass via
    ///         "SBI" vs "sbi" vs " SBI ". Non-ASCII bytes pass through unchanged.
    function normalizeBankName(string memory raw) internal pure returns (bytes memory) {
        bytes memory b = bytes(raw);
        uint256 len = b.length;

        uint256 start;
        uint256 end = len;
        while (start < end && _isAsciiSpace(b[start])) start++;
        while (end > start && _isAsciiSpace(b[end - 1])) end--;

        uint256 outLen = end - start;
        bytes memory out = new bytes(outLen);
        for (uint256 i; i < outLen; i++) {
            bytes1 c = b[start + i];
            // 'A' (0x41) .. 'Z' (0x5A) -> add 0x20 to get 'a' .. 'z'
            if (c >= 0x41 && c <= 0x5A) c = bytes1(uint8(c) + 32);
            out[i] = c;
        }
        return out;
    }

    /// @notice Returns true iff every byte of `s` is an ASCII digit '0'..'9'. Empty -> true.
    function isAllAsciiDigits(string memory raw) internal pure returns (bool) {
        bytes memory b = bytes(raw);
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (c < 0x30 || c > 0x39) return false;
        }
        return true;
    }

    function _isAsciiSpace(bytes1 c) private pure returns (bool) {
        // Space, tab, LF, CR
        return c == 0x20 || c == 0x09 || c == 0x0a || c == 0x0d;
    }
}
