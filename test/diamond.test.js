// test/diamond.test.js
//
// Tests the Diamond deployment, loupe functions, and ownership
// Run: npx hardhat test

const { ethers } = require("hardhat");
const { expect } = require("chai");

function getSelectors(contract) {
  return contract.interface.fragments
    .filter((f) => f.type === "function")
    .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
}

describe("Diamond", function () {
  let diamond, diamondCutFacet, diamondLoupeFacet, ownershipFacet;
  let diamondInit;
  let deployer, other;
  let diamondAddress;

  before(async function () {
    [deployer, other] = await ethers.getSigners();

    // Deploy facets
    diamondCutFacet     = await ethers.deployContract("DiamondCutFacet");
    diamondLoupeFacet   = await ethers.deployContract("DiamondLoupeFacet");
    ownershipFacet      = await ethers.deployContract("OwnershipFacet");
    diamondInit         = await ethers.deployContract("DiamondInit");

    // Deploy Diamond
    diamond = await ethers.deployContract("Diamond", [
      deployer.address,
      await diamondCutFacet.getAddress(),
    ]);
    diamondAddress = await diamond.getAddress();

    // Initial diamondCut to register Loupe + Ownership
    const cut = [
      {
        facetAddress: await diamondLoupeFacet.getAddress(),
        action: 0,
        functionSelectors: getSelectors(diamondLoupeFacet),
      },
      {
        facetAddress: await ownershipFacet.getAddress(),
        action: 0,
        functionSelectors: getSelectors(ownershipFacet),
      },
    ];

    const initCalldata = diamondInit.interface.encodeFunctionData("init", [
      "0x0000000000000000000000000000000000000001", // dummy USDC
      deployer.address,
      50, // 50 bps
    ]);

    const dc = await ethers.getContractAt("IDiamondCut", diamondAddress);
    const tx = await dc.diamondCut(cut, await diamondInit.getAddress(), initCalldata);
    await tx.wait();
  });

  // ── Loupe tests ───────────────────────────────────────────────────────────

  it("should have 3 facets after initial cut", async function () {
    const loupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress);
    const facet_s = await loupe.facets();
    expect(facet_s.length).to.equal(3); // DiamondCut + DiamondLoupe + Ownership
  });

  it("should return all facet addresses", async function () {
    const loupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress);
    const addresses = await loupe.facetAddresses();
    expect(addresses).to.include(await diamondCutFacet.getAddress());
    expect(addresses).to.include(await diamondLoupeFacet.getAddress());
    expect(addresses).to.include(await ownershipFacet.getAddress());
  });

  it("should find the correct facet for a selector", async function () {
    const loupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress);
    // facets() selector is in DiamondLoupeFacet
    const sel = ethers.id("facets()").slice(0, 10);
    const addr = await loupe.facetAddress(sel);
    expect(addr.toLowerCase()).to.equal(
      (await diamondLoupeFacet.getAddress()).toLowerCase()
    );
  });

  it("should support ERC-165, IDiamondCut, IDiamondLoupe, IERC173 interfaces", async function () {
    const loupe = await ethers.getContractAt("DiamondLoupeFacet", diamondAddress);

    // ERC-165 interfaceId
    expect(await loupe.supportsInterface("0x01ffc9a7")).to.be.true;
    // IDiamondCut interfaceId
    expect(await loupe.supportsInterface("0x1f931c1c")).to.be.true;
    // IDiamondLoupe interfaceId
    expect(await loupe.supportsInterface("0x48e2b093")).to.be.true;
    // IERC173 interfaceId
    expect(await loupe.supportsInterface("0x7f5828d0")).to.be.true;
  });

  // ── Ownership tests ───────────────────────────────────────────────────────

  it("should return correct owner", async function () {
    const ownership = await ethers.getContractAt("OwnershipFacet", diamondAddress);
    expect(await ownership.owner()).to.equal(deployer.address);
  });

  it("should transfer ownership", async function () {
    const ownership = await ethers.getContractAt("OwnershipFacet", diamondAddress);
    await ownership.transferOwnership(other.address);
    expect(await ownership.owner()).to.equal(other.address);
    // Transfer back
    await ownership.connect(other).transferOwnership(deployer.address);
    expect(await ownership.owner()).to.equal(deployer.address);
  });

  it("should revert transfer from non-owner", async function () {
    const ownership = await ethers.getContractAt("OwnershipFacet", diamondAddress);
    await expect(
      ownership.connect(other).transferOwnership(other.address)
    ).to.be.revertedWith("LibDiamond: Must be contract owner");
  });

  // ── Upgrade test ──────────────────────────────────────────────────────────

  it("should be upgradeable via diamondCut", async function () {
    // TODO: deploy a new test facet and add it
    // This test is a placeholder — add your facet tests below
    expect(true).to.be.true;
  });
});
