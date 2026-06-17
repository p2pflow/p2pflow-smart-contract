/**
 * Smoke test for the live Sepolia diamond.
 *
 * Reads only — does NOT send transactions.
 * Verifies:
 *   - getConfig() returns admin / usdcToken / minMerchantStakeUsdc / paused / initialized
 *   - getAllMerchants() returns the merchant address array
 *   - For each merchant: getMerchant(wallet) returns the profile
 *   - For each channel id under a merchant: getChannel(id) returns the channel
 *
 * Usage:
 *   DIAMOND_ADDRESS=0x... npx hardhat run scripts/smokeTest.js --network sepolia
 *   (or rely on DIAMOND_ADDRESS in .env)
 */

require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
    const diamondAddress = process.env.DIAMOND_ADDRESS;
    if (!diamondAddress) throw new Error("DIAMOND_ADDRESS not set in .env");

    console.log("─────────────────────────────────────────");
    console.log("P2PFlow Diamond — Sepolia smoke test");
    console.log("─────────────────────────────────────────");
    console.log("Diamond:", diamondAddress);

    const config = await ethers.getContractAt("ConfigFacet", diamondAddress);
    const merchants = await ethers.getContractAt("MerchantFacet", diamondAddress);

    console.log("\n── getConfig() ──");
    const cfg = await config.getConfig();
    console.log({
        admin:                cfg.admin,
        usdcToken:            cfg.usdcToken,
        paused:               cfg.paused,
        minMerchantStakeUsdc: cfg.minMerchantStakeUsdc.toString() + "  (raw 6-dec USDC)",
        initialized:          cfg.initialized,
    });

    console.log("\n── getAllMerchants() ──");
    const list = await merchants.getAllMerchants();
    console.log(`Total registered merchants: ${list.length}`);
    list.forEach((w, i) => console.log(`  [${i}] ${w}`));

    for (const wallet of list) {
        console.log(`\n── getMerchant(${wallet}) ──`);
        const m = await merchants.getMerchant(wallet);
        console.log({
            wallet:                  m.wallet,
            accountStatus:           Number(m.accountStatus),
            availability:            Number(m.availability),
            usdcLiquidity:           m.usdcLiquidity.toString() + "  (raw 6-dec)",
            unstakePending:          m.unstakePending,
            unstakeRequestedAmount:  m.unstakeRequestedAmount.toString(),
            telegramUsername:        m.telegramUsername,
            registeredAt:            new Date(Number(m.registeredAt) * 1000).toISOString(),
            channelIds:              m.channelIds,
        });

        for (const id of m.channelIds) {
            console.log(`  ── getChannel(${id}) ──`);
            const ch = await merchants.getChannel(id);
            console.log({
                channelId:     ch.channelId,
                merchant:      ch.merchant,
                bankName:      ch.bankName,
                accountLast4:  ch.accountLast4,
                upiId:         ch.upiId,
                label:         ch.label,
                status:        Number(ch.status),
                availability:  Number(ch.availability),
                fiatBalance:   ch.fiatBalance.toString() + "  (raw 6-dec)",
                appliedAt:     ch.appliedAt > 0n ? new Date(Number(ch.appliedAt) * 1000).toISOString() : "—",
                reviewedAt:    ch.reviewedAt > 0n ? new Date(Number(ch.reviewedAt) * 1000).toISOString() : "(not reviewed)",
            });
        }
    }

    console.log("\n✅ Smoke test complete.");
}

main().catch((err) => {
    console.error("\n❌ Smoke test failed:", err.shortMessage || err.message || err);
    process.exit(1);
});
