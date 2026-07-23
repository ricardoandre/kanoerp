/**
 * probe-ig-metrics.js
 *
 * PURPOSE: Instagram Graph API metric names/params get renamed, deprecated,
 * or gated by API version and account type more often than the ads API
 * does (e.g. account-level `impressions` was dropped for many accounts,
 * `audience_city`/`audience_country`/`audience_gender_age` were replaced
 * by `follower_demographics` with a `breakdown` param). Rather than
 * hard-coding a schema off training data that might be stale, this script
 * asks your actual account, on your actual API version, what it will
 * accept — and prints raw success/failure per candidate so we finalize
 * ig-sync table columns off ground truth. Same spirit as the
 * "ACTION REQUIRED" note in fb-ads-sync/lib/transform.js.
 *
 * Run: node probe-ig-metrics.js
 *
 * .env expected (same file as test_ig_permission.js):
 *   ACCESS_TOKEN=...
 *   FB_API_VERSION=v25.0   // optional, matches what you're already on
 *   IG_USER_ID=17841403040120984   // askalabel's ID, confirmed working
 */

require('dotenv').config();
const axios = require('axios');

const API_VERSION = process.env.FB_API_VERSION || 'v25.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;
const TOKEN = process.env.ACCESS_TOKEN;
const IG_USER_ID = process.env.IG_USER_ID || '17841403040120984'; // askalabel

if (!TOKEN) {
  console.error('✗ ACCESS_TOKEN missing in .env');
  process.exit(1);
}

async function get(path, params = {}) {
  try {
    const res = await axios.get(`${BASE_URL}${path}`, {
      params: { access_token: TOKEN, ...params },
    });
    return { ok: true, data: res.data };
  } catch (err) {
    const e = err.response ? err.response.data : { message: err.message };
    return { ok: false, error: e?.error?.message || JSON.stringify(e) };
  }
}

function line() {
  console.log('-'.repeat(70));
}

// ---------------------------------------------------------------------
// 1. ACCOUNT-LEVEL DAILY INSIGHTS
// ---------------------------------------------------------------------
async function probeAccountInsights() {
  line();
  console.log('1. ACCOUNT INSIGHTS (period=day)');
  line();

  // Candidates span old + new metric names — some will 400, that's expected
  // and informative, not a bug.
  const candidates = [
    'reach',
    'impressions', // likely to fail — dropped account-level in newer versions
    'accounts_engaged',
    'total_interactions',
    'likes',
    'comments',
    'shares',
    'saves',
    'replies',
    'profile_views',
    'website_clicks',
    'follower_count',
    'profile_links_taps',
  ];

  for (const metric of candidates) {
    const res = await get(`/${IG_USER_ID}/insights`, { metric, period: 'day' });
    if (res.ok) {
      const val = JSON.stringify(res.data.data?.[0]?.values?.slice(-1)?.[0]);
      console.log(`  ✓ ${metric.padEnd(22)} -> ${val}`);
    } else {
      console.log(`  ✗ ${metric.padEnd(22)} -> ${res.error}`);
    }
  }
}

// ---------------------------------------------------------------------
// 2. MEDIA LIST + PER-MEDIA-TYPE INSIGHTS
// ---------------------------------------------------------------------
async function probeMediaInsights() {
  line();
  console.log('2. MEDIA LIST + MEDIA INSIGHTS');
  line();

  const mediaRes = await get(`/${IG_USER_ID}/media`, {
    fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count',
    limit: 15,
  });

  if (!mediaRes.ok) {
    console.log(`  ✗ Could not list media: ${mediaRes.error}`);
    return;
  }

  const items = mediaRes.data.data || [];
  console.log(`  Found ${items.length} recent media items.`);

  // One example per distinct media_product_type (FEED/REELS/STORY/AD etc.)
  const seenTypes = new Set();
  const samples = [];
  for (const item of items) {
    const key = item.media_product_type || item.media_type;
    if (!seenTypes.has(key)) {
      seenTypes.add(key);
      samples.push(item);
    }
  }

  if (!samples.length) {
    console.log('  (no media returned — nothing to probe insights on)');
    return;
  }

  const candidates = [
    'reach',
    'likes',
    'comments',
    'saved',
    'shares',
    'total_interactions',
    'video_views', // older name
    'plays', // newer name (Reels)
    'ig_reels_avg_watch_time',
    'ig_reels_video_view_total_time',
    'impressions', // may fail depending on media age/type
    'navigation', // stories only, will fail on feed posts — expected
    'exits',
    'taps_forward',
    'taps_back',
    'replies',
  ];

  for (const item of samples) {
    console.log(`\n  --- media_id=${item.id} type=${item.media_type}/${item.media_product_type} ---`);
    for (const metric of candidates) {
      const res = await get(`/${item.id}/insights`, { metric });
      if (res.ok) {
        const val = res.data.data?.[0]?.values?.[0]?.value;
        console.log(`    ✓ ${metric.padEnd(28)} -> ${JSON.stringify(val)}`);
      } else {
        console.log(`    ✗ ${metric.padEnd(28)} -> ${res.error}`);
      }
    }
  }
}

// ---------------------------------------------------------------------
// 3. ACTIVE STORIES + STORY INSIGHTS (stories expire in 24h, so this only
//    ever shows what's live RIGHT NOW — expect empty most of the time
//    unless something was posted in the last 24h)
// ---------------------------------------------------------------------
async function probeStories() {
  line();
  console.log('3. ACTIVE STORIES (24h window)');
  line();

  const res = await get(`/${IG_USER_ID}/stories`, {
    fields: 'id,media_type,media_product_type,timestamp,permalink',
  });

  if (!res.ok) {
    console.log(`  ✗ Could not list stories: ${res.error}`);
    return;
  }

  const items = res.data.data || [];
  console.log(`  ${items.length} active stor${items.length === 1 ? 'y' : 'ies'} right now.`);
  if (!items.length) {
    console.log('  (nothing active — post a story within 24h of running this to see insight fields)');
    return;
  }

  const candidates = ['reach', 'replies', 'navigation', 'exits', 'taps_forward', 'taps_back', 'total_interactions'];
  const first = items[0];
  console.log(`\n  --- story media_id=${first.id} ---`);
  for (const metric of candidates) {
    const r = await get(`/${first.id}/insights`, { metric });
    if (r.ok) {
      const val = r.data.data?.[0]?.values?.[0]?.value;
      console.log(`    ✓ ${metric.padEnd(18)} -> ${JSON.stringify(val)}`);
    } else {
      console.log(`    ✗ ${metric.padEnd(18)} -> ${r.error}`);
    }
  }
}

// ---------------------------------------------------------------------
// 4. FOLLOWER / AUDIENCE DEMOGRAPHICS
//    Old metrics (audience_city/audience_country/audience_gender_age) were
//    deprecated in favor of follower_demographics / engaged_audience_
//    demographics / reached_audience_demographics with a `breakdown` param.
//    Probing both eras since this changes by API version.
// ---------------------------------------------------------------------
async function probeDemographics() {
  line();
  console.log('4. FOLLOWER / AUDIENCE DEMOGRAPHICS');
  line();

  // Newer-style: metric + period=lifetime + metric_type=total_value + breakdown
  const newMetrics = ['follower_demographics', 'engaged_audience_demographics', 'reached_audience_demographics'];
  const breakdowns = ['city', 'country', 'age', 'gender'];

  for (const metric of newMetrics) {
    for (const breakdown of breakdowns) {
      const res = await get(`/${IG_USER_ID}/insights`, {
        metric,
        period: 'lifetime',
        metric_type: 'total_value',
        breakdown,
      });
      if (res.ok) {
        const total = res.data.data?.[0]?.total_value;
        console.log(`  ✓ ${metric}/${breakdown}`.padEnd(48) + `-> ${JSON.stringify(total).slice(0, 80)}`);
      } else {
        console.log(`  ✗ ${metric}/${breakdown}`.padEnd(48) + `-> ${res.error}`);
      }
    }
  }

  // Older-style fallback (pre-deprecation accounts sometimes still on this)
  const oldMetrics = ['audience_city', 'audience_country', 'audience_gender_age'];
  for (const metric of oldMetrics) {
    const res = await get(`/${IG_USER_ID}/insights`, { metric, period: 'lifetime' });
    if (res.ok) {
      console.log(`  ✓ (legacy) ${metric}`.padEnd(48) + '-> ok');
    } else {
      console.log(`  ✗ (legacy) ${metric}`.padEnd(48) + `-> ${res.error}`);
    }
  }
}

async function main() {
  console.log(`\n=== IG metric probe (${API_VERSION}, ig_user_id=${IG_USER_ID}) ===\n`);
  await probeAccountInsights();
  await probeMediaInsights();
  await probeStories();
  await probeDemographics();
  line();
  console.log('Done. Paste this full output back so we can finalize ig-sync table columns.');
}

main();
