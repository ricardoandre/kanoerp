require('dotenv').config();

const { fetchInsights } = require('./lib/facebook');
const { TRANSFORMERS } = require('./lib/transform');
const { upsertMany } = require('./lib/nocobase');
const { parseAccounts } = require('./lib/accounts');

// Re-pull a trailing window each run. Facebook attributes conversions
// retroactively (up to the attribution window), so re-pulling recent days
// and upserting keeps yesterday's purchase/revenue numbers correct as they settle.
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 7);

const LEVELS = [
  { level: 'ad', collection: 'ads_insights', filterKeys: ['ad_id', 'date'] },
  { level: 'adset', collection: 'adsets_insights', filterKeys: ['adset_id', 'date'] },
  { level: 'campaign', collection: 'campaigns_insights', filterKeys: ['campaign_id', 'date'] },
];

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function dateRange(days) {
  const until = new Date();
  until.setDate(until.getDate() - 1); // through yesterday (today is still partial)
  const since = new Date(until);
  since.setDate(since.getDate() - (days - 1));
  return { since: ymd(since), until: ymd(until) };
}

async function run() {
  const accounts = parseAccounts();
  const { since, until } = dateRange(LOOKBACK_DAYS);
  console.log(`Syncing Facebook Ads insights ${since} -> ${until} for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  for (const account of accounts) {
    console.log(`\n== ${account.label} (${account.id}) ==`);
    for (const { level, collection, filterKeys } of LEVELS) {
      try {
        const raw = await fetchInsights({ accountId: account.id, level, since, until });
        // Entity ids (ad_id/adset_id/campaign_id) are globally unique on
        // Facebook — not scoped per account — so `account` doesn't need to
        // be part of filterKeys for upsert correctness. It's stored purely
        // as a label column for filtering/grouping in reports.
        const rows = raw.map(TRANSFORMERS[level]).map((r) => ({ ...r, account: account.label }));
        const ok = await upsertMany(collection, rows, filterKeys);
        console.log(`  ${level}: ${ok}/${rows.length} rows upserted into ${collection}`);
      } catch (e) {
        const msg = e.response?.data?.error?.message || e.message;
        console.error(`  ${level} failed: ${msg}`);
      }
    }
  }

  console.log('\nDone.');
}

run();
