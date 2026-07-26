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
// Usage: node backfill-media-images.js

async function run() {
  console.log('Scanning ig_media for rows with no archived files yet...');

  let rows;
  try {
    rows = await listAll('ig_media', {
      fields: 'media_id,media_type,media_product_type,media_url,thumbnail_url',
      appends: 'media_images',
    });
  } catch (e) {
    console.error(`Could not list ig_media: ${e.message}`);
    process.exit(1);
  }
  console.log(`  ${rows.length} total ig_media row(s)`);

  const missing = rows.filter((r) => !Array.isArray(r.media_images) || r.media_images.length === 0);
  console.log(`  ${missing.length} row(s) missing archived files — starting pass\n`);

  let totalFiles = 0;
  let mediaWithFiles = 0;
  let skippedNoUrl = 0;
  let processed = 0;

  for (const row of missing) {
    processed++;
    if (processed % 100 === 0) console.log(`  ...${processed}/${missing.length}`);

    try {
      const result = await archiveMediaFiles({
        mediaId: row.media_id,
        mediaType: row.media_type,
        mediaProductType: row.media_product_type,
        mediaUrl: row.media_url,
        thumbnailUrl: row.thumbnail_url,
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
  }

  console.log(
    `\nDone. Posts archived: ${mediaWithFiles}, total files uploaded: ${totalFiles}, ` +
    `skipped (no URL): ${skippedNoUrl}, total attempted: ${missing.length}`
  );
}

run();
