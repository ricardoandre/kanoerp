require('dotenv').config();

const { fetchEntityStatus } = require('./lib/facebook');
const { upsertMany } = require('./lib/nocobase');
const { parseAccounts, filterAccountsFromArgs } = require('./lib/accounts');

// Syncs CURRENT effective_status (ACTIVE/PAUSED/DISAPPROVED/etc.) for every
// campaign/adset/ad, across ALL configured ad accounts, into fb_ads_status.
// Deliberately NOT a period table — this is a snapshot, overwritten every
// run, keyed on (entity_type, entity_id) only. No date_range, no
// time_increment: /campaigns /adsets /ads are object endpoints, not
// /insights, so there's no "period" for status to belong to.
//
// This does NOT answer "was it active in a past period" — that's answered by
// delivery presence in the insights tables instead (see the Structure Report's
// hasActivity()). This table only ever answers "what is it right now."
//
// MULTI-ACCOUNT: this previously called fetchEntityStatus(level) with no
// account at all, which crashed (Graph API hit ".../undefined/campaigns")
// once the codebase moved to AD_ACCOUNTS + lib/accounts.js — fetchEntityStatus
// now requires { accountId, level } just like fetchInsights does, so this
// script loops parseAccounts() the same way backfill.js/sync.js do, and
// supports the same --account=Label1,Label2 CLI filter for a partial rerun.
// campaign_id/adset_id/ad_id are unique across Facebook regardless of which
// of our accounts they belong to, so rows from every account are merged into
// one flat list per level before upserting — no account column needed here.
//
// ALSO syncs real objective metadata onto campaign rows, to replace the
// report's name-based classifyObjective() guess — no new collection, just
// one new fb_ads_status column, `objective_key`, filled ONLY on
// entity_type='campaign' rows, format:
//
//     objective:optimization_goal:custom_event_type
//
// - objective            = campaign.objective straight from Facebook (single value)
// - optimization_goal    = distinct adset.optimization_goal values under this
//                          campaign, comma-joined if the adsets disagree
// - custom_event_type    = distinct adset.promoted_object.custom_event_type
//                          values under this campaign, comma-joined if mixed
//
// e.g. "OUTCOME_SALES:OFFSITE_CONVERSIONS:PURCHASE"            -> clean, full-funnel
//      "OUTCOME_SALES:OFFSITE_CONVERSIONS:ADD_TO_CART"          -> clean, ATC
//      "OUTCOME_SALES:OFFSITE_CONVERSIONS:ADD_TO_CART,PURCHASE" -> MIXED — a comma
//         inside the 3rd segment IS the inconsistency flag, no separate column
//         needed. The report parses this string and decides what to show.
//      "OUTCOME_SALES::"                                        -> sales campaign,
//         no adset event data yet (not synced, or adsets have no promoted_object)
//      "OUTCOME_AWARENESS::"                                    -> reach; adset
//         segments just aren't relevant for this objective
//
// Objective alone can't tell an ATC-optimized campaign from a full-funnel
// purchase campaign — both are typically OUTCOME_SALES at the campaign
// level. That split only shows up at the adset, in custom_event_type. Hence
// pulling adset data in below even though we don't persist per-adset rows
// with extra columns — adset rows keep their original shape (status only);
// their optimization_goal/custom_event_type only feed the campaign's key.
//
// ORDERING NOTE: adset rows (across all accounts) are reduced into
// per-campaign sets BEFORE campaign rows are built, even though campaign is
// upserted first for log readability — building objective_key requires the
// adset sets to already exist.
//
// KNOWN GAP TO VERIFY AGAINST REAL DATA: CPAS/catalog (Shopee) campaigns —
// see catalog_segment_actions in lib/facebook.js's METRIC_FIELDS — may not
// carry promoted_object.custom_event_type the same way standard conversion
// campaigns do. Those will likely land as "OUTCOME_SALES::" (empty 3rd
// segment) until we confirm what their adset payload actually looks like
// and add a dedicated rule.
//
// Usage: node fetch-status.js
//        node fetch-status.js --account=Shop1,Shop2

const STATUS_COLLECTION = 'fb_ads_status';
const FILTER_KEYS = ['entity_type', 'entity_id'];
const LEVELS = ['campaign', 'adset', 'ad'];

function joinDistinct(set) {
  return Array.from(set).filter(Boolean).join(',');
}

function buildObjectiveKey(objective, optimizationGoals, eventTypes) {
  return `${objective || ''}:${joinDistinct(optimizationGoals)}:${joinDistinct(eventTypes)}`;
}

async function run() {
  const accounts = filterAccountsFromArgs(parseAccounts());
  console.log(`Syncing current FB ad status for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  // Raw rows merged across ALL accounts, per level.
  const rawByLevel = { campaign: [], adset: [], ad: [] };

  for (const account of accounts) {
    for (const level of LEVELS) {
      try {
        const rows = await fetchEntityStatus({ accountId: account.id, level });
        rawByLevel[level].push(...rows);
        console.log(`  ${account.label} ${level}: fetched ${rows.length}`);
      } catch (e) {
        const msg = e.response?.data?.error?.message || e.message;
        console.error(`  ${account.label} ${level} fetch failed: ${msg}`);
      }
    }
  }

  // Reduce adset rows into per-campaign sets FIRST — campaign rows need this
  // to build objective_key.
  const optGoalsByCampaignId = {};  // campaign_id -> Set of optimization_goal
  const eventTypesByCampaignId = {}; // campaign_id -> Set of custom_event_type

  rawByLevel.adset.forEach((r) => {
    if (!r.campaign_id) return;
    if (!optGoalsByCampaignId[r.campaign_id]) optGoalsByCampaignId[r.campaign_id] = new Set();
    if (!eventTypesByCampaignId[r.campaign_id]) eventTypesByCampaignId[r.campaign_id] = new Set();
    if (r.optimization_goal) optGoalsByCampaignId[r.campaign_id].add(r.optimization_goal);
    const eventType = r.promoted_object && r.promoted_object.custom_event_type;
    if (eventType) eventTypesByCampaignId[r.campaign_id].add(eventType);
  });

  // Now build + upsert each level, campaign first for log readability.
  for (const level of LEVELS) {
    const mapped = rawByLevel[level].map((r) => {
      const base = {
        entity_type: level,
        entity_id: r.id,
        status: r.effective_status || 'UNKNOWN', // r.effective_status is Facebook's field name; fb_ads_status's column is just 'status'
        synced_at: new Date().toISOString(),
      };

      if (level === 'campaign') {
        base.objective_key = buildObjectiveKey(
          r.objective,
          optGoalsByCampaignId[r.id] || new Set(),
          eventTypesByCampaignId[r.id] || new Set(),
        );
      }

      return base;
    });

    try {
      const ok = await upsertMany(STATUS_COLLECTION, mapped, FILTER_KEYS);
      console.log(`  ${level}: ${ok}/${mapped.length} -> ${STATUS_COLLECTION}`);
    } catch (e) {
      console.error(`  ${level} upsert failed: ${e.message}`);
    }
  }

  // Quick visibility into data quality, without needing to open the DB —
  // just re-parses the strings we just wrote.
  const campaignKeys = rawByLevel.campaign.map((r) => buildObjectiveKey(
    r.objective,
    optGoalsByCampaignId[r.id] || new Set(),
    eventTypesByCampaignId[r.id] || new Set(),
  ));
  const mixedCount = campaignKeys.filter((key) => key.split(':')[2].includes(',')).length;
  const noEventDataCount = campaignKeys.filter((key) => {
    const [objective, , events] = key.split(':');
    return objective === 'OUTCOME_SALES' && events === '';
  }).length;
  console.log(`Done. ${mixedCount} campaign(s) have mixed adset event types, ${noEventDataCount} sales campaign(s) have no adset event data yet.`);
}

run();
