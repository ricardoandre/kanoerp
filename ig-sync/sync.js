require('dotenv').config();

const ig = require('./lib/instagram');
const { upsert, upsertMany, upsertManyRelational } = require('./lib/nocobase');
const { parseAccounts, filterAccountsFromArgs } = require('./lib/ig-accounts');

// How many recent media items to (re)catalog + snapshot-insight each run.
// Media/comments grow slowly compared to ad entities, so a bounded recent
// window is enough for daily syncing — full history is backfill.js's job.
const MEDIA_SYNC_LIMIT = Number(process.env.MEDIA_SYNC_LIMIT || 50);

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// Yesterday only — today is still partial, same reasoning as fb-ads-sync.
function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return ymd(d);
}

async function syncAccountInsights(account) {
  const date = yesterday();
  const metrics = await ig.fetchAccountInsightsPeriod({ igUserId: account.id, since: date, until: date });
  const followerCountEnd = await ig.fetchFollowersCountNow(account.id);

  const row = {
    account: account.label,
    ig_user_id: account.id,
    period_type: 'day',
    period_start: date,
    period_end: date,
    reach: metrics.reach || 0,
    accounts_engaged: metrics.accounts_engaged || 0,
    total_interactions: metrics.total_interactions || 0,
    likes: metrics.likes || 0,
    comments: metrics.comments || 0,
    shares: metrics.shares || 0,
    saves: metrics.saves || 0,
    replies: metrics.replies || 0,
    profile_views: metrics.profile_views || 0,
    website_clicks: metrics.website_clicks || 0,
    profile_link_taps: metrics.profile_links_taps || 0,
    views: metrics.views || 0,
    follower_count_end: followerCountEnd,
  };

  await upsert('ig_account_insights_period', row, ['ig_user_id', 'period_type', 'period_start']);
  console.log(`  account insights (day ${date}): reach=${row.reach}, engaged=${row.accounts_engaged}, followers=${followerCountEnd}`);
}

// Comments-per-post cap for the DAILY job — a viral post could have
// thousands of comments; re-walking all of them every day is wasteful once
// the initial backfill has captured history. Raise this (or use
// backfill-media.js's uncapped pull) if older comments matter more than
// sync speed.
const COMMENTS_PER_MEDIA_LIMIT = Number(process.env.COMMENTS_PER_MEDIA_LIMIT || 200);

async function syncMediaAndComments(account) {
  // maxItems bounds TOTAL media fetched across pages (not just page size) —
  // see lib/instagram.js's paginate() comment for why this matters as your
  // archive grows. backfill-media.js uses maxItems=Infinity instead.
  const mediaList = await ig.fetchMediaList({ igUserId: account.id, limit: 50, maxItems: MEDIA_SYNC_LIMIT });
  console.log(`  fetched ${mediaList.length} recent media item(s)`);

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
  const insightRows = [];
  const commentRows = [];

  for (const m of mediaList) {
    try {
      const metrics = await ig.fetchMediaInsights({ mediaId: m.id, mediaProductType: m.media_product_type });
      insightRows.push({
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
      });
    } catch (e) {
      console.error(`  media ${m.id} insights failed: ${e.message}`);
    }

    try {
      const comments = await ig.fetchMediaComments({ mediaId: m.id, maxItems: COMMENTS_PER_MEDIA_LIMIT });
      for (const c of comments) {
        commentRows.push({
          fk_ig_media_id: m.id,
          comment_id: c.id,
          from_username: c.username || '',
          from_id: c.from?.id || '',
          content: c.text || '',
          timestamp: c.timestamp,
          like_counts: c.like_count || 0,
        });
      }
    } catch (e) {
      console.error(`  media ${m.id} comments failed: ${e.message}`);
    }
  }

  const insightsOk = await upsertManyRelational(
    'ig_media_insights',
    insightRows,
    ['fk_ig_media_id', 'synced_at'],
    { fieldName: 'ig_media', targetKey: 'media_id', fkField: 'fk_ig_media_id' }
  );
  console.log(`  ig_media_insights: ${insightsOk}/${insightRows.length} upserted`);

  const commentsOk = await upsertManyRelational(
    'ig_media_comments',
    commentRows,
    ['comment_id'],
    { fieldName: 'ig_media', targetKey: 'media_id', fkField: 'fk_ig_media_id' }
  );
  console.log(`  ig_media_comments: ${commentsOk}/${commentRows.length} upserted`);
}

async function run() {
  const accounts = filterAccountsFromArgs(parseAccounts());
  console.log(`Syncing Instagram (daily) for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  for (const account of accounts) {
    console.log(`\n== ${account.label} (${account.id}) ==`);
    try {
      await syncAccountInsights(account);
    } catch (e) {
      console.error(`  account insights failed: ${e.message}`);
    }
    try {
      await syncMediaAndComments(account);
    } catch (e) {
      console.error(`  media/comments sync failed: ${e.message}`);
    }
  }

  console.log('\nDone.');
}

run();
