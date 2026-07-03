const axios = require('axios');

const API_VERSION = process.env.FB_API_VERSION || 'v23.0';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const AD_ACCOUNT_ID = process.env.AD_ACCOUNT_ID; // must include the act_ prefix, e.g. act_1234567890

// Metric fields requested at every level
const METRIC_FIELDS = [
  'impressions',
  'reach',
  'frequency',
  'clicks',
  'inline_link_clicks', // -> link_clicks
  'ctr',
  'cpc',
  'spend',
  'actions', // pixel conversion counts (kept for non-CPAS / engagement events)
  'action_values',
  'catalog_segment_actions', // CPAS (Shopee) conversion counts -> atc / purchase
  'catalog_segment_value', // CPAS (Shopee) revenue
  'date_start',
  'date_stop',
];

// Identity fields that differ per level
const LEVEL_FIELDS = {
  ad: ['ad_id', 'ad_name', 'adset_id', 'campaign_id'],
  adset: ['adset_id', 'adset_name', 'campaign_id'],
  campaign: ['campaign_id', 'campaign_name'],
  account: ['account_id'],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Facebook rate-limit errors: code 4 ("Application request limit reached"),
// code 17 ("User request limit reached"), code 32, or code 613. Detected by
// code first, falling back to a message match in case the code isn't present
// (some SDKs/proxies strip it).
function isRateLimitError(err) {
  const fbErr = err.response?.data?.error;
  if (!fbErr) return false;
  if ([4, 17, 32, 613].includes(fbErr.code)) return true;
  return /request limit/i.test(fbErr.message || '');
}

// Retries with exponential backoff (30s, 60s, 120s, 240s, 480s) on rate-limit
// errors specifically. Any other error is rethrown immediately, unretried —
// no point backing off on e.g. an invalid parameter, that won't fix itself.
async function withRetry(fn, { maxAttempts = 5, baseDelayMs = 30_000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`  Rate limited (attempt ${attempt}/${maxAttempts}), waiting ${delay / 1000}s...`);
      await sleep(delay);
    }
  }
}

// Fetch one breakdown level for a date range, following cursor pagination to the end.
// timeIncrement: 1 (default) -> one row PER DAY, used by the daily sync (sync.js/backfill.js).
//                null/false   -> one row for the WHOLE [since, until] range, used by the
//                                weekly/monthly reach sync (sync-periodic.js/backfill-periodic.js),
//                                since reach/frequency are not additive across days and must
//                                be requested pre-aggregated directly from the API.
async function fetchInsights({ level, since, until, timeIncrement = 1 }) {
  const baseUrl = `https://graph.facebook.com/${API_VERSION}/${AD_ACCOUNT_ID}/insights`;
  const params = {
    access_token: ACCESS_TOKEN,
    level,
    fields: [...LEVEL_FIELDS[level], ...METRIC_FIELDS].join(','),
    time_range: JSON.stringify({ since, until }),
    use_unified_attribution_setting: true, // use the ad set's configured attribution window
    limit: 200,
  };

  if (timeIncrement) {
    params.time_increment = timeIncrement; // one row PER DAY -> fills the `date` column
  }
  // else: omitted entirely -> API returns one aggregated row per entity for the whole range

  const rows = [];
  let url = baseUrl;
  let reqParams = params;

  while (url) {
    const resp = await withRetry(() => axios.get(url, { params: reqParams }));
    const { data, paging } = resp.data;
    if (Array.isArray(data)) rows.push(...data);

    // paging.next is a fully-formed URL that already carries every param + cursor
    url = paging && paging.next ? paging.next : null;
    reqParams = undefined;
  }

  return rows;
}

// Object endpoint per level — NOT /insights. effective_status is a property
// of the campaign/adset/ad object itself, not a date-range metric, so it's
// fetched from /{account}/campaigns /{account}/adsets /{account}/ads instead.
// No time_range/time_increment at all — this is always "right now."
const STATUS_EDGE = { campaign: 'campaigns', adset: 'adsets', ad: 'ads' };

// Fetches every entity's CURRENT effective_status at the given level. Used by
// fetch-status.js to populate fb_ads_status — a current-snapshot table
// (upserted, not period-keyed), deliberately separate from fb_ads_period_data.
// Historical "was it active in period X" is answered by delivery presence in
// the insights tables instead, not by this — see README §10.1 and chat for
// why a single current-status table is enough and a full history table isn't
// needed.
async function fetchEntityStatus(level) {
  const edge = STATUS_EDGE[level];
  const baseUrl = `https://graph.facebook.com/${API_VERSION}/${AD_ACCOUNT_ID}/${edge}`;
  const params = {
    access_token: ACCESS_TOKEN,
    fields: 'id,effective_status',
    limit: 500,
  };

  const rows = [];
  let url = baseUrl;
  let reqParams = params;

  while (url) {
    const resp = await withRetry(() => axios.get(url, { params: reqParams }));
    const { data, paging } = resp.data;
    if (Array.isArray(data)) rows.push(...data);
    url = paging && paging.next ? paging.next : null;
    reqParams = undefined;
  }

  return rows; // [{ id, effective_status }]
}

module.exports = { fetchInsights, fetchEntityStatus, LEVEL_FIELDS };
