/**
 * One-time historical backfill for GMV Max data (campaign + product + creative
 * level, all daily), going back to each campaign's actual creation date.
 *
 * This can take a LONG time and make a LOT of API calls — resilience matters:
 * - Checkpoints progress to backfill-checkpoint.json after every chunk, so a
 *   crash/kill doesn't lose completed work. Re-running this script picks up
 *   right where it left off automatically.
 * - Requests time out after 60s instead of hanging forever on a stuck connection.
 * - Wrap with the retry loop in package.json's backfill:gmvmax:resilient script
 *   (or run `until node src/backfill-gmvmax.js; do sleep 10; done` yourself)
 *   so it auto-resumes if killed (e.g. by an OOM kill) instead of needing you
 *   to notice and restart manually.
 *
 * Usage: node src/backfill-gmvmax.js
 *        (delete backfill-checkpoint.json to force a full restart from scratch)
 */
import fs from "fs";
import { getAccountsWithAdsAuth } from "./nocobase/accounts.js";
import { fetchGmvMaxCampaigns, chunkDateRange, dateNDaysAgo } from "./tiktok/gmvmax.js";
import { syncGmvMaxWindow } from "./tiktok/gmvmax-sync-core.js";

const CHECKPOINT_FILE = "backfill-checkpoint.json";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCheckpoint() {
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8"));
  } catch {
    return {}; // { [accountName]: completedChunkIndex }
  }
}
function saveCheckpoint(checkpoint) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

// Surface anything that would otherwise crash the process silently.
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

async function main() {
  const checkpoint = loadCheckpoint();
  const accounts = await getAccountsWithAdsAuth();
  console.log(`Backfilling GMV Max history for ${accounts.length} account(s)...`);
  if (Object.keys(checkpoint).length > 0) {
    console.log(`Resuming from checkpoint:`, checkpoint);
  }

  for (const account of accounts) {
    console.log(`\n=== ${account.name} ===`);

    const campaignMap = await fetchGmvMaxCampaigns({
      accessToken: account.ads_access_token,
      advertiserId: account.ads_advertiser_id,
    });

    const createTimes = Object.values(campaignMap)
      .map((c) => c.create_time)
      .filter(Boolean)
      .map((t) => t.slice(0, 10));

    if (createTimes.length === 0) {
      console.log(`  No campaigns with a known creation date found, skipping.`);
      continue;
    }

    const earliestDate = createTimes.sort()[0];
    const today = dateNDaysAgo(0);
    const chunks = chunkDateRange(earliestDate, today, 29);

    const startFromChunk = checkpoint[account.name] || 0;
    if (startFromChunk > 0) {
      console.log(`  Resuming ${account.name} from chunk ${startFromChunk + 1}/${chunks.length} (already completed 1-${startFromChunk}).`);
    }

    console.log(`  Earliest campaign created: ${earliestDate}`);
    console.log(`  Backfilling in ${chunks.length} chunks of up to 29 days each...`);

    let totalCampaignRows = 0;
    let totalProductRows = 0;
    let totalCreativeRows = 0;

    for (let i = startFromChunk; i < chunks.length; i++) {
      const { start, end } = chunks[i];
      console.log(`  [${i + 1}/${chunks.length}] ${start} to ${end}...`);

      try {
        const { campaignRows, productRows, creativeRows } = await syncGmvMaxWindow({
          account,
          startDate: start,
          endDate: end,
        });
        totalCampaignRows += campaignRows;
        totalProductRows += productRows;
        totalCreativeRows += creativeRows;
        console.log(`      wrote ${campaignRows} campaign, ${productRows} product, ${creativeRows} creative rows`);
      } catch (err) {
        console.error(`      chunk failed:`, err.response?.data || err.message);
      }

      checkpoint[account.name] = i + 1;
      saveCheckpoint(checkpoint);

      await sleep(500);
    }

    console.log(
      `  [${account.name}] BACKFILL TOTAL (this run): ${totalCampaignRows} campaign rows, ` +
      `${totalProductRows} product rows, ${totalCreativeRows} creative rows`
    );
  }

  console.log("\nBackfill complete.");
}

main().catch((err) => {
  console.error("Fatal backfill error:", err);
  process.exit(1);
});
