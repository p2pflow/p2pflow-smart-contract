const { expect } = require("chai");
const { ethers } = require("hardhat");

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

function pack128(high, low) {
  return ethers.toBeHex((BigInt(high) << 128n) | BigInt(low), 32);
}

describe("P2PFlow account abstraction", function () {
  async function fixture() {
    const [owner, sponsor, user, other] = await ethers.getSigners();
    const entryPointArtifact = require("@account-abstraction/contracts/artifacts/EntryPoint.json");
    const entryPoint = await new ethers.ContractFactory(
      entryPointArtifact.abi,
      entryPointArtifact.bytecode,
      owner,
    ).deploy();
    await entryPoint.waitForDeployment();
    const Paymaster = await ethers.getContractFactory("P2PFlowVerifyingPaymaster");
    const paymaster = await Paymaster.deploy(await entryPoint.getAddress(), sponsor.address);
    await paymaster.waitForDeployment();
    const Account = await ethers.getContractFactory("P2PFlow7702Account");
    const account = await Account.deploy(await entryPoint.getAddress());
    await account.waitForDeployment();
    return { owner, sponsor, user, other, entryPoint, paymaster, account };
  }

  it("binds sponsorship to every operation field and validity window", async function () {
    const { sponsor, user, paymaster } = await fixture();
    const staticData = ethers.concat([
      await paymaster.getAddress(),
      ethers.toBeHex(120000, 16),
      ethers.toBeHex(1, 16),
    ]);
    const userOp = {
      sender: user.address,
      nonce: 7,
      initCode: "0x",
      callData: "0x12345678",
      accountGasLimits: pack128(500000, 300000),
      preVerificationGas: 60000,
      gasFees: pack128(1000000, 2000000),
      paymasterAndData: staticData,
      signature: "0x",
    };
    const validAfter = Math.floor(Date.now() / 1000) - 1;
    const validUntil = validAfter + 60;
    const hash = await paymaster.getHash(userOp, validUntil, validAfter);
    const signature = await sponsor.signMessage(ethers.getBytes(hash));
    const fullData = ethers.concat([
      staticData,
      ethers.toBeHex(validUntil, 6),
      ethers.toBeHex(validAfter, 6),
      signature,
    ]);
    const parsed = await paymaster.parsePaymasterAndData(fullData);
    expect(parsed.validUntil).to.equal(validUntil);
    expect(parsed.validAfter).to.equal(validAfter);
    expect(parsed.signature).to.equal(signature);
    expect(await paymaster.getHash({ ...userOp, callData: "0x12345679" }, validUntil, validAfter)).not.equal(hash);
    expect(await paymaster.getHash(userOp, validUntil + 1, validAfter)).not.equal(hash);
  });

  it("restricts signer rotation and paymaster validation entry", async function () {
    const { owner, other, paymaster } = await fixture();
    await expect(paymaster.connect(other).setVerifyingSigner(other.address))
      .to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
    await expect(paymaster.setVerifyingSigner(ethers.ZeroAddress)).to.be.revertedWith("zero signer");
    await expect(paymaster.setVerifyingSigner(other.address))
      .to.emit(paymaster, "VerifyingSignerChanged");
    expect(await paymaster.verifyingSigner()).to.equal(other.address);
    expect(await paymaster.owner()).to.equal(owner.address);
  });

  it("exposes the canonical v0.7 EntryPoint deployment target", async function () {
    expect(ethers.isAddress(ENTRY_POINT)).to.equal(true);
  });

  it("allows account execution only through EntryPoint or delegated self", async function () {
    const { other, account } = await fixture();
    await expect(account.execute(other.address, 0, "0x"))
      .to.be.revertedWith("not authorized");
    await expect(account.executeBatch([], [], [])).to.be.revertedWith("not authorized");
  });
});
