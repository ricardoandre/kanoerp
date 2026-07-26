require('dotenv').config();

const ig = require('./lib/instagram');
const { upsertMany, upsertManyRelational } = require('./lib/nocobase');
const { archiveMediaFiles } = require('./lib/media-images');
const { parseAccounts, filterAccountsFromArgs } = require('./lib/ig-accounts');

// Run ONCE to catalog your full post history (e.g. all 3,584 askalabel
// posts), then let sync.js's bounded daily pull handle new posts + refreshed
// snapshots going forward. This will take a while and make a LOT of API
// calls (2-3 per post: insights + comments, plus pagination) — expect it to
// run for a long time on an account this size. Safe to re-run/resume:
// upserts mean a re-run just refreshes rows, no duplicates.
//
// Usage:
//   node backfill-media.js
//   node backfill-media.js --account=AskaLabel

const COMMENTS_PER_MEDIA_LIMIT = Number(process.env.COMMENTS_PER_MEDIA_LIMIT || Infinity);

// Smaller than sync.js's default (50) — one account already hit Meta's
// "reduce the amount of data you're asking for" complexity-limit error at
// 50/page. Lower this further (e.g. 10) via env if it recurs even at 25.
const MEDIA_PAGE_SIZE = Number(process.env.MEDIA_PAGE_SIZE || 25);

async function run() {
  const accounts = filterAccountsFromArgs(parseAccounts());
  console.log(`Backfilling full Instagram media history for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  for (const account of accounts) {
    console.log(`\n#### ${account.label} (${account.id}) ####`);

    let mediaList;
    try {
      mediaList = await ig.fetchMediaList({ igUserId: account.id, limit: MEDIA_PAGE_SIZE, maxItems: Infinity });
    } catch (e) {
      console.error(`  ✗ could not fetch media list, skipping this account entirely: ${e.message}`);
      continue; // move on to the next account instead of crashing the whole run
    }
    console.log(`  found ${mediaList.length} total media items — this will take a while`);

    const mediaRows = mediaList.map((m) => ({
      media_id: m.id,
      account: account.label,
      ig_user_id: account.id,
      caption: m.caption || '',
      media_type: m.media_type,
      media_product_type: m.media_product_type,
      permalink: m.permalink,
      media_url: m.media_url || m.thumbnail_url || '',
      timestamp: m.timestamp,
    }));
    const mediaOk = await upsertMany('ig_media', mediaRows, ['media_id']);
    console.log(`  ig_media: ${mediaOk}/${mediaRows.length} upserted`);

    const syncedAt = new Date().toISOString();
    let processed = 0;

    for (const m of mediaList) {
      processed++;
      if (processed % 100 === 0) console.log(`  ...${processed}/${mediaList.length}`);

      try {
        const metrics = await ig.fetchMediaInsights({ mediaId: m.id, mediaProductType: m.media_product_type });
        await upsertManyRelational(
          'ig_media_insights',
          [{
            fk_ig_media_id: m.id,
            synced_at: syncedAt,
            reach: metrics.reach || 0,
            likes: metrics.likes || 0,
            comments: metrics.comments || 0,
            saved: metrics.saved || 0,
            shares: metrics.shares || 0,
            total_interactions: metrics.total_interactions || 0,
            ig_reels_avg_watch_time: metrics.ig_reels_avg_watch_time || 0,
            ig_reels_video_view_total_time: metrics.ig_reels_video_view_total_time || 0,
          }],
          ['fk_ig_media_id', 'synced_at'],
          { fieldName: 'ig_media', targetKey: 'media_id', fkField: 'fk_ig_media_id' }
        );
      } catch (e) {
        console.error(`  media ${m.id} insights failed: ${e.message}`);
      }

      try {
        const comments = await ig.fetchMediaComments({ mediaId: m.id, maxItems: COMMENTS_PER_MEDIA_LIMIT });
        const commentRows = comments.map((c) => ({
          fk_ig_media_id: m.id,
          comment_id: c.id,
          from_username: c.username || '',
          from_id: c.from?.id || '',
          content: c.text || '',
          timestamp: c.timestamp,
          like_counts: c.like_count || 0,
        }));
        await upsertManyRelational(
          'ig_media_comments',
          commentRows,
          ['comment_id'],
          { fieldName: 'ig_media', targetKey: 'media_id', fkField: 'fk_ig_media_id' }
        );
      } catch (e) {
        console.error(`  media ${m.id} comments failed: ${e.message}`);
      }

      try {
        const result = await archiveMediaFiles({
          mediaId: m.id,
          mediaType: m.media_type,
          mediaProductType: m.media_product_type,
          mediaUrl: m.media_url,
          thumbnailUrl: m.thumbnail_url,
        });
        if (result.uploaded > 0) console.log(`    media ${m.id}: archived ${result.uploaded} file(s)`);
      } catch (e) {
        console.error(`  media ${m.id} archival failed: ${e.message}`);
      }
    }
  }

  console.log('\nBackfill done.');
}

run();
