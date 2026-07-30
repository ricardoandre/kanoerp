require('dotenv').config();

const { listAll } = require('./lib/nocobase');
const { archiveMediaFiles } = require('./lib/media-images');

// Run ONCE against already-backfilled media (e.g. after backfill-media.js
// finishes) to archive every file (all carousel slides, full videos +
// thumbnails) for posts that don't have any archived yet. Safe to
// re-run/resume — only processes rows with zero linked attachments so far,
// so an interrupted run just picks up where it left off.
//
// See the cost note at the top of lib/media-images.js before running this
// at scale — full video downloads are a lot heavier than the old
// cover-image-only version.
//
// Usage:
//   node backfill-media-images.js                          (all missing, no throttle)
//   IMAGE_BACKFILL_LIMIT=20 node backfill-media-images.js   (small test batch)
//   IMAGE_BACKFILL_DELAY_MS=250 node backfill-media-images.js (throttled full run)

const LIMIT = Number(process.env.IMAGE_BACKFILL_LIMIT || Infinity);
const DELAY_MS = Number(process.env.IMAGE_BACKFILL_DELAY_MS || 0);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log('Scanning ig_media for rows with no archived files yet...');

  let rows;
  try {
    rows = await listAll('ig_media', {
      fields: 'media_id,media_type,media_product_type,media_url',
      appends: 'media_images',
    });
  } catch (e) {
    console.error(`Could not list ig_media: ${e.message}`);
    process.exit(1);
  }
  console.log(`  ${rows.length} total ig_media row(s)`);

  const missing = rows.filter((r) => !Array.isArray(r.media_images) || r.media_images.length === 0);
  const batch = missing.slice(0, LIMIT);
  console.log(
    `  ${missing.length} row(s) missing archived files` +
    (batch.length < missing.length ? ` — processing first ${batch.length} this run (IMAGE_BACKFILL_LIMIT)` : ' — processing all') +
    (DELAY_MS > 0 ? `, ${DELAY_MS}ms delay between items` : '') +
    '\n'
  );

  let totalFiles = 0;
  let mediaWithFiles = 0;
  let skippedNoUrl = 0;
  let processed = 0;

  for (const row of batch) {
    processed++;
    if (processed % 100 === 0) console.log(`  ...${processed}/${batch.length}`);

    try {
      const result = await archiveMediaFiles({
        mediaId: row.media_id,
        mediaType: row.media_type,
        mediaProductType: row.media_product_type,
        mediaUrl: row.media_url,
        // thumbnail_url was never persisted on ig_media — archiveMediaFiles
        // auto-recovers it with a live lookup for VIDEO items when this is
        // omitted, so passing null here is fine, not a degradation.
        thumbnailUrl: null,
      });
      if (result.uploaded > 0) {
        mediaWithFiles++;
        totalFiles += result.uploaded;
      } else if (!result.skipped) {
        skippedNoUrl++;
        console.warn(`  media ${row.media_id} (${row.media_type}): no resolvable URL, skipped`);
      }
    } catch (e) {
      console.error(`  media ${row.media_id} (${row.media_type}) failed: ${e.message}`);
    }

    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  console.log(
    `\nDone. Posts archived: ${mediaWithFiles}, total files uploaded: ${totalFiles}, ` +
    `skipped (no URL): ${skippedNoUrl}, total attempted: ${batch.length} (of ${missing.length} remaining)`
  );
}

run();
