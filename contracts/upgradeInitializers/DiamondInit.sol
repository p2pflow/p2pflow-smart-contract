// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/******************************************************************************\
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
*
* DiamondInit — runs ONCE after deploy via delegatecall from diamondCut.
* Sets ERC-165 flags and bare PlatformConfig (replaces a separate AdminFacet init).
* Not registered as a facet.
\******************************************************************************/

import { LibDiamond } from "../libraries/LibDiamond.sol";
import { IDiamondLoupe } from "../interfaces/IDiamondLoupe.sol";
import { IDiamondCut } from "../interfaces/IDiamondCut.sol";
import { IERC173 } from "../interfaces/IERC173.sol";
import { IERC165 } from "../interfaces/IERC165.sol";
import { Modifiers } from "../shared/AppStorage.sol";

contract DiamondInit is Modifiers {
    /// @param _usdcToken USDC (or test ERC20) used for merchant stake / liquidity
    /// @param _minMerchantStakeUsdc minimum at registration
    /// @dev `msg.sender` is the account that invoked `diamondCut` — stored as platform admin
    function init(address _usdcToken, uint256 _minMerchantStakeUsdc) external {
        require(!s.config.initialized, "Already initialized");
        require(_usdcToken != address(0), "Zero USDC");

        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IERC165).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;
        ds.supportedInterfaces[type(IERC173).interfaceId] = true;

        s.config.usdcToken = _usdcToken;
        s.config.minMerchantStakeUsdc = _minMerchantStakeUsdc;
        s.config.paused = false;
        s.config.admin = msg.sender;
        s.config.initialized = true;

        // Prime the reentrancy slot to the "not entered" sentinel so the first
        // guarded call doesn't burn a cold-slot SSTORE going from 0 -> 2.
        s._reentrancyStatus = 1;
    }
}
