// scripts/deploy.js
//
// Deploys the full Diamond with all core facets using Hardhat + ethers.js
// Run:  npx hardhat run scripts/deploy.js --network localhost
//
// Deployment order:
//   1. Deploy all Facet contracts (separate contracts, NOT proxies)
//   2. Deploy Diamond.sol with DiamondCutFacet address
//   3. Call diamondCut() to register all other facets
//   4. Call DiamondInit.init() via the cut's _init / _calldata args

const { ethers } = require("hardhat");

// Helper: extract all 4-byte function selectors from a contract's ABI
function getSelectors(contract) {
  const signatures = contract.interface.fragments
    .filter((f) => f.type === "function")
    .map((f) => f.format("sighash"));

  return signatures.map((sig) => ethers.id(sig).slice(0, 10));
}

// Helper: remove specific selectors (e.g. exclude init() from being registered)
function selectorsExcept(contract, excludeFnNames) {
  return getSelectors(contract).filter((sel) => {
    const fragment = contract.interface.getFunction(sel);
    return !excludeFnNames.includes(fragment?.name);
  });
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // ── 1. Deploy core facets ─────────────────────────────────────────────────
  console.log("\n── Deploying facets...");

  const DiamondCutFacet = await ethers.deployContract("DiamondCutFacet");
  await DiamondCutFacet.waitForDeployment();
  console.log("DiamondCutFacet:  ", await DiamondCutFacet.getAddress());

  const DiamondLoupeFacet = await ethers.deployContract("DiamondLoupeFacet");
  await DiamondLoupeFacet.waitForDeployment();
  console.log("DiamondLoupeFacet:", await DiamondLoupeFacet.getAddress());

  const OwnershipFacet = await ethers.deployContract("OwnershipFacet");
  await OwnershipFacet.waitForDeployment();
  console.log("OwnershipFacet:   ", await OwnershipFacet.getAddress());

  // ── 2. Deploy the Diamond proxy ───────────────────────────────────────────
  console.log("\n── Deploying Diamond proxy...");
  const Diamond = await ethers.deployContract("Diamond", [
    deployer.address,                        // contractOwner
    await DiamondCutFacet.getAddress(),      // bootstrap with DiamondCutFacet
  ]);
  await Diamond.waitForDeployment();
  const diamondAddress = await Diamond.getAddress();
  console.log("Diamond:          ", diamondAddress);

  // ── 3. Get the DiamondCut interface at the Diamond's address ──────────────
  const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);

  // ── 4. Deploy DiamondInit ─────────────────────────────────────────────────
  const DiamondInit = await ethers.deployContract("DiamondInit");
  await DiamondInit.waitForDeployment();
  console.log("DiamondInit:      ", await DiamondInit.getAddress());

  // ── 5. Build the FacetCut array for the initial cut ───────────────────────
  // Registers DiamondLoupe + Ownership facets
  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

  const cut = [
    {
      facetAddress: await DiamondLoupeFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(DiamondLoupeFacet),
    },
    {
      facetAddress: await OwnershipFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(OwnershipFacet),
    },
  ];

  // ── 6. Encode DiamondInit.init() call ─────────────────────────────────────
  // Replace with your real USDC token address and treasury
  const USDC_ADDRESS  = process.env.USDC_ADDRESS  || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // Sepolia USDC
  const TREASURY      = process.env.TREASURY      || deployer.address;
  const PLATFORM_FEE  = 50; // 50 bps = 0.5%

  const initCalldata = DiamondInit.interface.encodeFunctionData("init", [
    USDC_ADDRESS,
    TREASURY,
    PLATFORM_FEE,
  ]);

  // ── 7. Execute the diamondCut ─────────────────────────────────────────────
  console.log("\n── Running initial diamondCut...");
  const tx = await diamondCut.diamondCut(
    cut,
    await DiamondInit.getAddress(),
    initCalldata
  );
  const receipt = await tx.wait();
  if (!receipt.status) throw new Error("diamondCut failed");
  console.log("DiamondCut completed. Tx:", tx.hash);

  // ── 8. Print summary ──────────────────────────────────────────────────────
  console.log("\n✅ Deployment complete");
  console.log("─────────────────────────────────────────");
  console.log("Diamond (proxy):  ", diamondAddress);
  console.log("DiamondCutFacet:  ", await DiamondCutFacet.getAddress());
  console.log("DiamondLoupeFacet:", await DiamondLoupeFacet.getAddress());
  console.log("OwnershipFacet:   ", await OwnershipFacet.getAddress());
  console.log("─────────────────────────────────────────");
  console.log("Owner:", deployer.address);
  console.log("USDC: ", USDC_ADDRESS);

  // Save addresses for frontend use
  const addresses = {
    diamond:           diamondAddress,
    diamondCutFacet:   await DiamondCutFacet.getAddress(),
    diamondLoupeFacet: await DiamondLoupeFacet.getAddress(),
    ownershipFacet:    await OwnershipFacet.getAddress(),
  };

  const fs = require("fs");
  fs.writeFileSync(
    "./deployed-addresses.json",
    JSON.stringify(addresses, null, 2)
  );
  console.log("\nAddresses saved to deployed-addresses.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
