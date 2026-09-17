// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasePaymaster} from "@account-abstraction/contracts/core/BasePaymaster.sol";
import {UserOperationLib} from "@account-abstraction/contracts/core/UserOperationLib.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice Pays only for UserOperations authorized by the P2PFlow policy service.
contract P2PFlowVerifyingPaymaster is BasePaymaster {
    using UserOperationLib for PackedUserOperation;

    uint256 private constant VALIDITY_OFFSET = PAYMASTER_DATA_OFFSET;
    uint256 private constant SIGNATURE_OFFSET = VALIDITY_OFFSET + 12;

    address public verifyingSigner;

    event VerifyingSignerChanged(address indexed previousSigner, address indexed newSigner);

    constructor(IEntryPoint entryPoint_, address verifyingSigner_) BasePaymaster(entryPoint_) {
        require(verifyingSigner_ != address(0), "zero signer");
        verifyingSigner = verifyingSigner_;
    }

    function setVerifyingSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "zero signer");
        emit VerifyingSignerChanged(verifyingSigner, newSigner);
        verifyingSigner = newSigner;
    }

    /// @dev Excludes the signature-bearing suffix while binding every mutable
    ///      UserOperation field, both paymaster gas limits, chain and contracts.
    function getHash(PackedUserOperation calldata userOp, uint48 validUntil, uint48 validAfter)
        public
        view
        returns (bytes32)
    {
        require(userOp.paymasterAndData.length >= PAYMASTER_DATA_OFFSET, "short paymaster data");
        return keccak256(
            abi.encode(
                userOp.getSender(),
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                keccak256(userOp.paymasterAndData[:PAYMASTER_DATA_OFFSET]),
                userOp.preVerificationGas,
                userOp.gasFees,
                block.chainid,
                address(entryPoint),
                address(this),
                validUntil,
                validAfter
            )
        );
    }

    function parsePaymasterAndData(bytes calldata data)
        public
        pure
        returns (uint48 validUntil, uint48 validAfter, bytes calldata signature)
    {
        require(data.length == SIGNATURE_OFFSET + 65, "invalid paymaster data");
        validUntil = uint48(bytes6(data[VALIDITY_OFFSET:VALIDITY_OFFSET + 6]));
        validAfter = uint48(bytes6(data[VALIDITY_OFFSET + 6:SIGNATURE_OFFSET]));
        signature = data[SIGNATURE_OFFSET:];
    }

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256)
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        (uint48 validUntil, uint48 validAfter, bytes calldata signature) =
            parsePaymasterAndData(userOp.paymasterAndData);
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(getHash(userOp, validUntil, validAfter));
        bool failed = ECDSA.recover(digest, signature) != verifyingSigner;
        return ("", _packValidationData(failed, validUntil, validAfter));
    }
}
