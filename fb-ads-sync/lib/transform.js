// Maps Facebook's `actions` / `action_values` arrays into your flat columns.
//
// IMPORTANT — read this before trusting the conversion numbers:
// Facebook returns SEVERAL action_type rows for what is conceptually the same
// event: a generic one (`purchase`), a pixel one (`offsite_conversion.fb_pixel_purchase`),
// a deduplicated cross-channel one (`omni_purchase`), sometimes an onsite one.
// Summing them double/triple counts. So for each metric we keep a PRIORITY LIST
// and take the FIRST action_type that is present — never the sum.
//
// >>> ACTION REQUIRED: run your existing test script once, look at the real
//     action_type strings inside the `actions` array, and trim each list below
//     to the ones your pixel/CAPI setup actually emits. The defaults cover a
//     standard ecommerce pixel but yours may differ.

const ACTION_PRIORITY = {
  // ~11,174 in your data, matches the Ads Manager "Landing Page Views" column.
  // Swap to 'omni_landing_page_view' for the broader cross-surface count (~70,278).
  landing_page_views: ['landing_page_view'],

  // 9 in your data; omni_* is Meta's deduplicated total, plain is the fallback.
  atc: ['omni_add_to_cart', 'add_to_cart'],

  // Not firing in your account yet -> stays 0 until InitiateCheckout is tracked.
  checkout: ['omni_initiated_checkout', 'initiate_checkout'],

  // 1 in your data.
  purchase: ['omni_purchase', 'purchase'],

  // Not firing in your account yet -> stays 0 until CompleteRegistration is tracked.
  registration: ['omni_complete_registration', 'complete_registration'],
};

// Revenue from the purchase action_values (332,795 in your data).
const REVENUE_PRIORITY = ACTION_PRIORITY.purchase;

function pickFirst(arr, priority) {
  if (!Array.isArray(arr)) return 0;
  for (const type of priority) {
    const hit = arr.find((a) => a.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function int(v) {
  return Math.round(num(v));
}

// Conversions: CPAS (Shopee) sales arrive in catalog_segment_actions /
// catalog_segment_value, while pixel/engagement events arrive in actions /
// action_values. Prefer the CPAS array, fall back to the pixel array, so this
// works for both CPAS and any non-CPAS campaigns. `value` already reflects the
// account's attribution setting (matches Ads Manager).
function pickConv(r, priority) {
  const fromCpas = pickFirst(r.catalog_segment_actions, priority);
  return fromCpas || pickFirst(r.actions, priority);
}

function pickRevenue(r, priority) {
  const fromCpas = pickFirst(r.catalog_segment_value, priority);
  return fromCpas || pickFirst(r.action_values, priority);
}

// Metric columns shared by all three levels
function baseMetrics(r) {
  return {
    date: r.date_start, // dateOnly, "YYYY-MM-DD"
    reach: int(r.reach),
    frequency: num(r.frequency),
    impressions: int(r.impressions),
    clicks: int(r.clicks), // all clicks
    link_clicks: int(r.inline_link_clicks), // link clicks only
    ctr: num(r.ctr),
    cpc: num(r.cpc),
    spend: num(r.spend),
    landing_page_views: pickConv(r, ACTION_PRIORITY.landing_page_views),
    atc: pickConv(r, ACTION_PRIORITY.atc),
    checkout: pickConv(r, ACTION_PRIORITY.checkout),
    purchase: pickConv(r, ACTION_PRIORITY.purchase),
    registration: pickConv(r, ACTION_PRIORITY.registration),
    revenue: pickRevenue(r, REVENUE_PRIORITY),
  };
}

const TRANSFORMERS = {
  ad: (r) => ({
    ad_id: r.ad_id,
    ad_name: r.ad_name,
    adset_id: r.adset_id,
    campaign_id: r.campaign_id,
    ...baseMetrics(r),
  }),
  adset: (r) => ({
    adset_id: r.adset_id,
    adset_name: r.adset_name,
    campaign_id: r.campaign_id,
    ...baseMetrics(r),
  }),
  campaign: (r) => ({
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    ...baseMetrics(r),
  }),
};

module.exports = { TRANSFORMERS, ACTION_PRIORITY };
