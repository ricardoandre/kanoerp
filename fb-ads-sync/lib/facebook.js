const axios = require('axios');
const API_VERSION = process.env.FB_API_VERSION || 'v23.0';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
// AD_ACCOUNT_ID is gone from here — accountId is now passed in per-call by
// the caller, which loops over accounts.parseAccounts(). See lib/accounts.js.
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
// Identity fields that differ per level. 'account' added here — this is the
// facebook.js.patch that sync-periodic.js/backfill-periodic.js's comments
// have been referencing but that was never actually applied (their
// `LEVELS` arrays include 'account', which was silently failing/returning
// nothing useful without this).
const LEVEL_FIELDS = {
  ad: ['ad_id', 'ad_name', 'adset_id', 'campaign_id'],
  adset: ['adset_id', 'adset_name', 'campaign_id'],
  campaign: ['campaign_id', 'campaign_name'],
  account: ['account_id'],
};

// Fields requested per level for fetchEntityStatus — these hit the OBJECT
// endpoints (/campaigns /adsets /ads), NOT /insights, so field names are
// Facebook's native object field names (id, not campaign_id/ad_id etc), and
// there's no 'account' level here — ad accounts don't have an
// effective_status of their own the way campaigns/adsets/ads do.
//
// campaign.objective: Facebook's real, un-guessed campaign objective
//   (OUTCOME_SALES / OUTCOME_AWARENESS / OUTCOME_TRAFFIC / OUTCOME_ENGAGEMENT /
//   OUTCOME_LEADS / OUTCOME_APP_PROMOTION, or older-API equivalents).
// adset.optimization_goal + adset.promoted_object: objective ALONE can't
//   distinguish an ATC-optimized campaign from a full-funnel purchase
//   campaign — both are typically OUTCOME_SALES. That distinction only
//   shows up at the adset, in promoted_object.custom_event_type
//   (ADD_TO_CART vs PURCHASE). See fetch-status.js for how these get rolled
//   up into a campaign-level objective_key.
const STATUS_LEVEL_FIELDS = {
  campaign: ['id', 'effective_status', 'objective'],
  adset: ['id', 'campaign_id', 'effective_status', 'optimization_goal', 'promoted_object'],
  ad: ['id', 'effective_status'],
};

// Object endpoints are the plural of the level: campaign -> campaigns, etc.
const STATUS_ENDPOINT = {
  campaign: 'campaigns',
  adset: 'adsets',
  ad: 'ads',
};

// Fetch one breakdown level for a date range, for ONE ad account, following
// cursor pagination to the end.
// accountId:     the act_XXXXXXXXXX id to query — required now that a single
//                process loops over several accounts (see lib/accounts.js).
// timeIncrement: 1 (default) -> one row PER DAY, used by sync.js/backfill.js.
//                null        -> one row for the WHOLE [since, until] range,
//                               used by sync-periodic.js/backfill-periodic.js,
//                               since reach/frequency are not additive across
//                               days and must come pre-aggregated from the API.
//                This is the other half of the facebook.js.patch mentioned
//                above — previously always hardcoded to 1, so passing
//                `timeIncrement: null` from the periodic scripts was a no-op:
//                they were fetching (and then mis-storing) daily rows the
//                whole time, not period-aggregated ones. See the comment in
//                lib/transform-period.js for the other half of the fallout.
async function fetchInsights({ accountId, level, since, until, timeIncrement = 1 }) {
  if (!accountId) throw new Error('fetchInsights: accountId is required');
  const baseUrl = `https://graph.facebook.com/${API_VERSION}/${accountId}/insights`;
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

// Fetch current object state for every entity at one level, for ONE ad
// account: status, plus — for campaign/adset — the real objective metadata
// used to replace the report's name-based classifyObjective() guess. Object
// endpoint, not /insights — no date_range, no time_increment, just "what is
// it right now."
//
// Same accountId-per-call shape as fetchInsights above, for the same
// reason: fetch-status.js must loop over parseAccounts() itself, this
// function has no notion of "the" account.
async function fetchEntityStatus({ accountId, level }) {
  if (!accountId) throw new Error('fetchEntityStatus: accountId is required');
  const endpoint = STATUS_ENDPOINT[level];
  if (!endpoint) throw new Error(`fetchEntityStatus: unsupported level "${level}"`);
  const baseUrl = `https://graph.facebook.com/${API_VERSION}/${accountId}/${endpoint}`;
  const params = {
    access_token: ACCESS_TOKEN,
    fields: STATUS_LEVEL_FIELDS[level].join(','),
    limit: 200,
  };
  const rows = [];
  let url = baseUrl;
  let reqParams = params;
  while (url) {
    const resp = await axios.get(url, { params: reqParams });
    const { data, paging } = resp.data;
    if (Array.isArray(data)) rows.push(...data);
    url = paging && paging.next ? paging.next : null;
    reqParams = undefined;
  }
  return rows;
}

module.exports = { fetchInsights, fetchEntityStatus, LEVEL_FIELDS, STATUS_LEVEL_FIELDS };
