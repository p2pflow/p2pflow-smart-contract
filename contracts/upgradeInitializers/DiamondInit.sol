// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/******************************************************************************\
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
* Source: https://github.com/mudgen/diamond-3-hardhat
*
* DiamondInit — runs ONCE at deployment via delegatecall
*
* Purpose:
*   After deploying all facets and calling the first diamondCut(), you pass
*   this contract's address and init() selector as the _init / _calldata args.
*   The diamond will delegatecall init() which runs in diamond's storage context,
*   letting you set ERC-165 flags and any initial app state.
*
* This is NOT a facet — it is never registered in the routing table.
* It just gets delegatecalled once and discarded.
\******************************************************************************/

import { LibDiamond } from "../libraries/LibDiamond.sol";
import { IDiamondLoupe } from "../interfaces/IDiamondLoupe.sol";
import { IDiamondCut } from "../interfaces/IDiamondCut.sol";
import { IERC173 } from "../interfaces/IERC173.sol";
import { IERC165 } from "../interfaces/IERC165.sol";

// Import AppStorage + Modifiers — gives us `s` at slot 0
import { Modifiers } from "../shared/AppStorage.sol";

// DiamondInit inherits Modifiers so it gets `s` (AppStorage at slot 0).
// When the Diamond delegatecalls init(), `s` points into Diamond's storage —
// so these writes persist permanently in the Diamond.
contract DiamondInit is Modifiers {
    /// @notice Called ONCE via delegatecall during the initial diamondCut.
    ///         Sets ERC-165 flags and initializes app state.
    /// @param _usdcToken     Address of the USDC ERC-20 contract
    /// @param _treasury      Address that receives platform fees
    /// @param _platformFeeBps Fee in basis points (50 = 0.5%)
    function init(
        address _usdcToken,
        address _treasury,
        uint256 _platformFeeBps
    ) external {
        // ── Register ERC-165 interface support ───────────────────────────────
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IERC165).interfaceId]      = true;
        ds.supportedInterfaces[type(IDiamondCut).interfaceId]  = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;
        ds.supportedInterfaces[type(IERC173).interfaceId]      = true;

        // ── Initialize app state via `s` (AppStorage at slot 0) ─────────────
        s.usdcToken      = _usdcToken;
        s.treasury       = _treasury;
        s.platformFeeBps = _platformFeeBps;
        s.paused         = false;
        s.admin          = msg.sender;   // deployer becomes initial admin
        s.isAdmin[msg.sender] = true;
        s.adminList.push(msg.sender);
    }
}
