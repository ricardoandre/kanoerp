/**
 * ONE-TIME catch-up script — downloads thumbnails for every creative that
 * existed BEFORE this feature was added to the regular sync. Going forward,
 * `sync:gmvmax` caches each creative's thumbnail automatically the moment
 * it's synced (see gmvmax-sync-core.js), so this script does NOT need to
 * be scheduled or re-run regularly — it's purely for backfilling history
 * that predates that change. Safe to re-run if needed (already-cached
 * thumbnails are skipped instantly either way).
 *
 * Usage: node src/cache-thumbnails.js
 */
import { config } from "./config.js";
import { listRecords } from "./nocobase/client.js";
import { ensureThumbnailCached } from "./tiktok/thumbnails.js";

// Surface anything that would otherwise crash the process silently.
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAllUniqueItemIds() {
  const ids = new Set();
  let page = 1;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const rows = await listRecords(config.nocobase.collections.gmvMaxCreatives, {
      fields: ["item_id"],
      pageSize,
      page,
    });
    rows.forEach((r) => {
      if (r.item_id && r.item_id !== "-1") ids.add(String(r.item_id));
    });
    hasMore = rows.length === pageSize;
    page++;
  }

  return Array.from(ids);
}

async function main() {
  console.log("Fetching all unique creative item_ids from tiktok_gmv_max_creatives...");
  const itemIds = await getAllUniqueItemIds();
  console.log(`Found ${itemIds.length} unique creatives.\n`);

  let alreadyCached = 0;
  let downloaded = 0;
  let failed = 0;

  for (let i = 0; i < itemIds.length; i++) {
    const itemId = itemIds[i];
    const result = await ensureThumbnailCached(itemId);

    if (result.downloaded) {
      downloaded++;
      console.log(`[${i + 1}/${itemIds.length}] Downloaded: ${itemId}`);
      await sleep(200); // only throttle on actual downloads, not cache hits
    } else if (result.cached) {
      alreadyCached++;
    } else {
      failed++;
      console.log(`[${i + 1}/${itemIds.length}] Failed: ${itemId} (${result.reason})`);
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ...progress: ${i + 1}/${itemIds.length} (${downloaded} downloaded, ${alreadyCached} already cached, ${failed} failed)`);
    }
  }

  console.log(`\nDone. Downloaded ${downloaded} new, ${alreadyCached} already cached, ${failed} failed.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
