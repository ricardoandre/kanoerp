const axios = require('axios');

const API_VERSION = process.env.FB_API_VERSION || 'v25.0';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

// >>> CRITICAL: media_id / story_id / comment_id are 17+ digit Instagram
//     IDs — past Number.MAX_SAFE_INTEGER (2^53). The Graph API returns them
//     as JSON strings already. NEVER wrap them in Number(...) / parseInt(...)
//     anywhere in this file or in the sync scripts that call it — doing so
//     silently rounds to the nearest representable double and corrupts the
//     stored id. Every function below passes ids straight through as
//     strings; keep it that way when editing.

function get(url, params) {
  return axios
    .get(url, { params: { access_token: ACCESS_TOKEN, ...params } })
    .then((res) => res.data)
    .catch((err) => {
      const msg = err.response?.data?.error?.message || err.message;
      throw new Error(msg);
    });
}

// Generic cursor-paginate helper for list endpoints (/media, /comments, etc).
// `paging.next` is already a fully-formed URL carrying every param + cursor,
// same shape as fb-ads-sync/lib/facebook.js's pagination loop.
//
// maxItems caps the TOTAL rows returned across all pages (not just page
// size) — critical for /media specifically: unlike ad entities (bounded
// count), a media catalog grows every day, so an uncapped daily sync would
// re-walk the ENTIRE post history (thousands of items) on every run and
// only get slower over time. Pass maxItems=Infinity (or omit) for one-time
// full-history backfills; sync.js passes a bounded value for daily runs.
async function paginate(url, params, maxItems = Infinity) {
  const rows = [];
  let nextUrl = url;
  let nextParams = params;
  while (nextUrl && rows.length < maxItems) {
    const data = await get(nextUrl, nextParams);
    if (Array.isArray(data.data)) rows.push(...data.data);
    nextUrl = data.paging && data.paging.next ? data.paging.next : null;
    nextParams = undefined; // paging.next already carries everything
  }
  return rows.slice(0, maxItems);
}

// ---------------------------------------------------------------------
// ACCOUNT-LEVEL PERIOD INSIGHTS (one aggregated row per [since, until])
//
// Confirmed via probe: reach/accounts_engaged/total_interactions/likes/
// comments/shares/saves/replies/profile_views/website_clicks/
// profile_links_taps all require metric_type=total_value and are combinable
// in a single call. `views` is included on the strength of it appearing in
// the API's own "must be one of" validation list, but its exact behavior
// per period/media-type was NOT separately probed — treat the `views`
// column as provisional until you've eyeballed a few real rows.
//
// follower_count is deliberately NOT requested here: the metric endpoint
// returns a per-day delta/time-series value, not a point-in-time total, so
// it can't be aggregated the same way as the others. Total follower count
// as of "now" is fetched separately via fetchFollowersCountNow() below and
// stored as follower_count_end — which means for BACKFILLED historical
// periods that column reflects "current followers," not "followers at the
// end of that period." Flag this limitation in any report using it.
// ---------------------------------------------------------------------
const ACCOUNT_TOTAL_VALUE_METRICS = [
  'reach',
  'accounts_engaged',
  'total_interactions',
  'likes',
  'comments',
  'shares',
  'saves',
  'replies',
  'profile_views',
  'website_clicks',
  'profile_links_taps',
  'views',
];

async function fetchAccountInsightsPeriod({ igUserId, since, until }) {
  const data = await get(`${BASE_URL}/${igUserId}/insights`, {
    metric: ACCOUNT_TOTAL_VALUE_METRICS.join(','),
    period: 'day',
    metric_type: 'total_value',
    since,
    until,
  });
  const out = {};
  for (const entry of data.data || []) {
    // total_value shape observed: { value: N } with no breakdown, since we
    // didn't pass a `breakdown` param here (that's only for demographics).
    out[entry.name] = entry.total_value?.value ?? 0;
  }
  return out;
}

// Current total followers, as of right now — see caveat above re: backfill.
async function fetchFollowersCountNow(igUserId) {
  const data = await get(`${BASE_URL}/${igUserId}`, { fields: 'followers_count' });
  return data.followers_count ?? null;
}

// ---------------------------------------------------------------------
// MEDIA CATALOG + PER-MEDIA INSIGHTS
// ---------------------------------------------------------------------
// limit: per-page size sent to the API. maxItems: total cap across all
// pages — pass Infinity (default) for backfill's one-time full-history
// pull, or a bounded number for sync.js's daily run. See paginate()'s
// comment for why these are two different knobs.
async function fetchMediaList({ igUserId, limit = 50, maxItems = Infinity }) {
  return paginate(
    `${BASE_URL}/${igUserId}/media`,
    { fields: 'id,caption,media_type,media_product_type,permalink,media_url,thumbnail_url,timestamp', limit },
    maxItems
  );
}

// Confirmed working for both FEED (image/carousel) and REELS media:
// reach, likes, comments, saved, shares, total_interactions.
// ig_reels_avg_watch_time / ig_reels_video_view_total_time confirmed
// REELS-only (explicitly rejected — "not supported for this media product
// type" — on the FEED test post).
// `views` was NOT separately probed at media level (same caveat as
// account-level above) — requested as a best-effort separate call so a
// views failure never breaks the confirmed core metrics.
const MEDIA_CORE_METRICS = ['reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'];
const REELS_ONLY_METRICS = ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'];

async function fetchMediaInsights({ mediaId, mediaProductType }) {
  const out = {};

  const core = await get(`${BASE_URL}/${mediaId}/insights`, { metric: MEDIA_CORE_METRICS.join(',') });
  for (const entry of core.data || []) {
    out[entry.name] = entry.values?.[0]?.value ?? 0;
  }

  if (mediaProductType === 'REELS') {
    try {
      const reels = await get(`${BASE_URL}/${mediaId}/insights`, { metric: REELS_ONLY_METRICS.join(',') });
      for (const entry of reels.data || []) {
        out[entry.name] = entry.values?.[0]?.value ?? 0;
      }
    } catch (e) {
      console.warn(`  (media ${mediaId}) reels-only metrics failed: ${e.message}`);
    }
  }

  // Best-effort `views` — see MEDIA_CORE_METRICS comment above.
  try {
    const views = await get(`${BASE_URL}/${mediaId}/insights`, { metric: 'views' });
    out.views = views.data?.[0]?.values?.[0]?.value ?? 0;
  } catch (e) {
    // Not fatal — just means this media/product-type combo doesn't
    // support `views` yet in your API version. Logged, not thrown.
    console.warn(`  (media ${mediaId}) views metric failed: ${e.message}`);
  }

  return out;
}

// ---------------------------------------------------------------------
// COMMENTS
//
// `username` is a top-level field on the comment object per the Graph API
// (works here because the token carries instagram_manage_comments). If a
// future run shows this coming back empty for some comments (e.g. from
// since-deleted/restricted accounts), that's expected API behavior, not a
// bug — Meta doesn't guarantee identity fields for every commenter.
// ---------------------------------------------------------------------
async function fetchMediaComments({ mediaId, maxItems = Infinity }) {
  return paginate(
    `${BASE_URL}/${mediaId}/comments`,
    { fields: 'id,text,timestamp,username,like_count', limit: 50 },
    maxItems
  );
}

// ---------------------------------------------------------------------
// ACTIVE STORIES (24h window only — no history, no pagination needed at
// the scale of one account's currently-live stories)
// ---------------------------------------------------------------------
async function fetchActiveStories({ igUserId }) {
  const data = await get(`${BASE_URL}/${igUserId}/stories`, {
    fields: 'id,media_type,media_product_type,timestamp,permalink',
  });
  return data.data || [];
}

// Confirmed working: reach, replies, navigation, total_interactions.
const STORY_METRICS = ['reach', 'replies', 'navigation', 'total_interactions'];

async function fetchStoryInsights({ storyId }) {
  const data = await get(`${BASE_URL}/${storyId}/insights`, { metric: STORY_METRICS.join(',') });
  const out = {};
  for (const entry of data.data || []) {
    out[entry.name] = entry.values?.[0]?.value ?? 0;
  }
  return out;
}

// ---------------------------------------------------------------------
// FOLLOWER DEMOGRAPHICS
//
// Confirmed working: follower_demographics + metric_type=total_value +
// breakdown=city|country|age|gender. engaged_audience_demographics /
// reached_audience_demographics were rejected in the probe with "require
// timeframe parameter" — NOT implemented here since the exact accepted
// timeframe values weren't verified; follower_demographics alone covers
// the "who follows us" question you asked for. Revisit if you specifically
// need "who engaged with us" vs "who we reached" breakdowns later.
// ---------------------------------------------------------------------
const DEMOGRAPHIC_BREAKDOWNS = ['city', 'country', 'age', 'gender'];

async function fetchFollowerDemographics({ igUserId }) {
  const rows = [];
  for (const breakdown of DEMOGRAPHIC_BREAKDOWNS) {
    const data = await get(`${BASE_URL}/${igUserId}/insights`, {
      metric: 'follower_demographics',
      period: 'lifetime',
      metric_type: 'total_value',
      breakdown,
    });
    const breakdownBlock = data.data?.[0]?.total_value?.breakdowns?.[0];
    const results = breakdownBlock?.results || [];
    for (const r of results) {
      rows.push({
        breakdown_type: breakdown,
        breakdown_key: (r.dimension_values || []).join('|'),
        value: String(r.value),
      });
    }
  }
  return rows;
}

module.exports = {
  fetchAccountInsightsPeriod,
  fetchFollowersCountNow,
  fetchMediaList,
  fetchMediaInsights,
  fetchMediaComments,
  fetchActiveStories,
  fetchStoryInsights,
  fetchFollowerDemographics,
};
