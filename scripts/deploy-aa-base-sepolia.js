const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const CHAIN_ID = 84532n;
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

function artifact(name) {
  return JSON.parse(fs.readFileSync(
    path.join(ROOT, `artifacts/contracts/aa/${name}.sol/${name}.json`),
    "utf8",
  ));
}

async function deploy(name, args, wallet) {
  const item = artifact(name);
  const factory = new ethers.ContractFactory(item.abi, item.bytecode, wallet);
  const contract = await factory.deploy(...args);
  const transaction = contract.deploymentTransaction();
  console.log(`submitted ${name}: ${transaction.hash}`);
  const receipt = await transaction.wait(1);
  const address = await contract.getAddress();
  let code = "0x";
  for (let attempt = 0; attempt < 30 && code === "0x"; attempt += 1) {
    code = await wallet.provider.send("eth_getCode", [address, "latest"]);
    if (code === "0x") await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (code === "0x") throw new Error(`${name} bytecode is unavailable`);
  console.log(`deployed ${name}: ${address}`);
  return { contract, address, receipt };
}

async function main() {
  const broadcast = process.argv.includes("--broadcast");
  const rpc = process.env.BASE_SEPOLIA_RPC_URL;
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  const signerKey = process.env.SPONSORSHIP_SIGNER_PRIVATE_KEY;
  if (!rpc || !deployerKey || !signerKey) {
    throw new Error("BASE_SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY and SPONSORSHIP_SIGNER_PRIVATE_KEY are required");
  }
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) throw new Error(`Expected Base Sepolia ${CHAIN_ID}, got ${network.chainId}`);
  if (await provider.getCode(ENTRY_POINT) === "0x") throw new Error("Canonical EntryPoint v0.7 is not deployed");
  const wallet = new ethers.Wallet(deployerKey, provider);
  const sponsor = new ethers.Wallet(signerKey);
  if (sponsor.address === wallet.address) throw new Error("Sponsorship signer must differ from deployer");
  const balance = await provider.getBalance(wallet.address);
  const deposit = ethers.parseEther(process.env.PAYMASTER_INITIAL_DEPOSIT_ETH || "0.01");
  const minimumBalance = deposit + ethers.parseEther("0.003");
  if (balance < minimumBalance) {
    throw new Error(`Deployer balance ${ethers.formatEther(balance)} ETH is below required ${ethers.formatEther(minimumBalance)} ETH`);
  }
  artifact("P2PFlow7702Account");
  artifact("P2PFlowVerifyingPaymaster");
  console.log(`chainId=${network.chainId}`);
  console.log(`entryPoint=${ENTRY_POINT}`);
  console.log(`deployer=${wallet.address}`);
  console.log(`verifyingSigner=${sponsor.address}`);
  console.log(`deployerBalanceEth=${ethers.formatEther(balance)}`);
  console.log(`initialDepositEth=${ethers.formatEther(deposit)}`);
  if (!broadcast) return console.log("AA deployment check passed. Use --broadcast to deploy.");

  const existingAccount = process.env.EXISTING_ACCOUNT_IMPLEMENTATION_ADDRESS;
  const account = existingAccount
    ? {
        address: ethers.getAddress(existingAccount),
        receipt: { hash: process.env.EXISTING_ACCOUNT_DEPLOYMENT_TX || null, blockNumber: null },
      }
    : await deploy("P2PFlow7702Account", [ENTRY_POINT], wallet);
  if (await provider.send("eth_getCode", [account.address, "latest"]) === "0x") {
    throw new Error("Existing account implementation bytecode is unavailable");
  }
  const paymaster = await deploy("P2PFlowVerifyingPaymaster", [ENTRY_POINT, sponsor.address], wallet);
  const depositTransaction = await paymaster.contract.deposit({ value: deposit });
  const depositReceipt = await depositTransaction.wait(1);
  let deposited = 0n;
  const entryPoint = new ethers.Contract(ENTRY_POINT, ["function balanceOf(address) view returns (uint256)"], provider);
  for (let attempt = 0; attempt < 30 && deposited < deposit; attempt += 1) {
    deposited = await entryPoint.balanceOf(paymaster.address);
    if (deposited < deposit) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (deposited < deposit) throw new Error("Paymaster EntryPoint deposit was not credited");

  const output = path.join(ROOT, "deployments/base-sepolia/aa-deployment.json");
  const summary = {
    chainId: Number(CHAIN_ID),
    entryPoint: ENTRY_POINT,
    accountImplementation: account.address,
    paymaster: paymaster.address,
    owner: wallet.address,
    verifyingSigner: sponsor.address,
    depositWei: deposited.toString(),
    accountDeploymentTransactionHash: account.receipt.hash,
    paymasterDeploymentTransactionHash: paymaster.receipt.hash,
    depositTransactionHash: depositReceipt.hash,
    deploymentBlock: paymaster.receipt.blockNumber,
  };
  fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  console.log(`manifest=${output}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
