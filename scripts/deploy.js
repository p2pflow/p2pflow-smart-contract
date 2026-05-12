// scripts/deploy.js
//
// Deploy Diamond + core EIP-2535 facets + MerchantFacet; init via DiamondInit.
// Run: npx hardhat run scripts/deploy.js --network localhost

const { ethers } = require("hardhat");

function getSelectors(contract) {
  const signatures = contract.interface.fragments
    .filter((f) => f.type === "function")
    .map((f) => f.format("sighash"));

  return signatures.map((sig) => ethers.id(sig).slice(0, 10));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

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

  const ConfigFacet = await ethers.deployContract("ConfigFacet");
  await ConfigFacet.waitForDeployment();
  console.log("ConfigFacet:      ", await ConfigFacet.getAddress());

  const MerchantFacet = await ethers.deployContract("MerchantFacet");
  await MerchantFacet.waitForDeployment();
  console.log("MerchantFacet:    ", await MerchantFacet.getAddress());

  console.log("\n── Deploying Diamond proxy...");
  const Diamond = await ethers.deployContract("Diamond", [
    deployer.address,
    await DiamondCutFacet.getAddress(),
  ]);
  await Diamond.waitForDeployment();
  const diamondAddress = await Diamond.getAddress();
  console.log("Diamond:          ", diamondAddress);

  const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);

  const DiamondInit = await ethers.deployContract("DiamondInit");
  await DiamondInit.waitForDeployment();
  console.log("DiamondInit:      ", await DiamondInit.getAddress());

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
    {
      facetAddress: await ConfigFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(ConfigFacet),
    },
    {
      facetAddress: await MerchantFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(MerchantFacet),
    },
  ];

  const USDC_ADDRESS =
    process.env.USDC_ADDRESS || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  const MIN_MERCHANT_STAKE = process.env.MIN_MERCHANT_STAKE_USDC || "1000000"; // 1 USDC if 6 decimals

  const initCalldata = DiamondInit.interface.encodeFunctionData("init", [
    USDC_ADDRESS,
    MIN_MERCHANT_STAKE,
  ]);

  console.log("\n── Running initial diamondCut...");
  const tx = await diamondCut.diamondCut(
    cut,
    await DiamondInit.getAddress(),
    initCalldata
  );
  const receipt = await tx.wait();
  if (!receipt.status) throw new Error("diamondCut failed");
  console.log("DiamondCut completed. Tx:", tx.hash);

  console.log("\n✅ Deployment complete");
  console.log("─────────────────────────────────────────");
  console.log("Diamond (proxy):  ", diamondAddress);
  console.log("DiamondCutFacet:  ", await DiamondCutFacet.getAddress());
  console.log("DiamondLoupeFacet:", await DiamondLoupeFacet.getAddress());
  console.log("OwnershipFacet:   ", await OwnershipFacet.getAddress());
  console.log("ConfigFacet:      ", await ConfigFacet.getAddress());
  console.log("MerchantFacet:    ", await MerchantFacet.getAddress());
  console.log("─────────────────────────────────────────");
  console.log("Diamond owner:   ", deployer.address);
  console.log("Platform admin:  ", deployer.address, "(set in DiamondInit)");
  console.log("USDC:            ", USDC_ADDRESS);

  const addresses = {
    diamond: diamondAddress,
    diamondCutFacet: await DiamondCutFacet.getAddress(),
    diamondLoupeFacet: await DiamondLoupeFacet.getAddress(),
    ownershipFacet: await OwnershipFacet.getAddress(),
    configFacet: await ConfigFacet.getAddress(),
    merchantFacet: await MerchantFacet.getAddress(),
    diamondInit: await DiamondInit.getAddress(),
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
