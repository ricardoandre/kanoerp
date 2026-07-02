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
    const resp = await axios.get(url, { params: reqParams });
    const { data, paging } = resp.data;
    if (Array.isArray(data)) rows.push(...data);

    // paging.next is a fully-formed URL that already carries every param + cursor
    url = paging && paging.next ? paging.next : null;
    reqParams = undefined;
  }

  return rows;
}

module.exports = { fetchInsights, LEVEL_FIELDS };
