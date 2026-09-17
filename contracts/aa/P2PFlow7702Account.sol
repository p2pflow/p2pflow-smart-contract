// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseAccount} from "@account-abstraction/contracts/core/BaseAccount.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS} from "@account-abstraction/contracts/core/Helpers.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @notice Stateless ERC-4337 execution logic intended for EIP-7702 delegation.
/// @dev When delegated, address(this) is the user's EOA. It is therefore both
///      the UserOperation sender and the only accepted ECDSA signer.
contract P2PFlow7702Account is BaseAccount, IERC1271 {
    bytes4 private constant EIP1271_MAGIC_VALUE = 0x1626ba7e;

    IEntryPoint private immutable _entryPoint;

    constructor(IEntryPoint entryPoint_) {
        require(address(entryPoint_) != address(0), "zero EntryPoint");
        _entryPoint = entryPoint_;
    }

    receive() external payable {}

    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    function execute(address target, uint256 value, bytes calldata data) external {
        _requireEntryPointOrSelf();
        _call(target, value, data);
    }

    function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata data) external {
        _requireEntryPointOrSelf();
        require(targets.length == data.length, "length mismatch");
        require(values.length == 0 || values.length == targets.length, "value length mismatch");
        for (uint256 i; i < targets.length; ++i) {
            _call(targets[i], values.length == 0 ? 0 : values[i], data[i]);
        }
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view override returns (bytes4) {
        return ECDSA.recover(hash, signature) == address(this) ? EIP1271_MAGIC_VALUE : bytes4(0xffffffff);
    }

    function _validateSignature(PackedUserOperation calldata userOp, bytes32 userOpHash)
        internal
        view
        override
        returns (uint256)
    {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        return ECDSA.recover(digest, userOp.signature) == address(this)
            ? SIG_VALIDATION_SUCCESS
            : SIG_VALIDATION_FAILED;
    }

    function _requireEntryPointOrSelf() internal view {
        require(msg.sender == address(_entryPoint) || msg.sender == address(this), "not authorized");
    }

    function _call(address target, uint256 value, bytes calldata data) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
    }
}
