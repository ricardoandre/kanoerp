require('dotenv').config();

const { fetchInsights } = require('./lib/facebook');
const { TRANSFORMERS } = require('./lib/transform');
const { upsertMany } = require('./lib/nocobase');
const { parseAccounts } = require('./lib/accounts');

// Fetches TODAY only (partial, still-settling data), so it can be run
// intraday to show up-to-the-hour numbers. This is intentionally separate
// from sync.js, which only pulls through yesterday (see its comment on
// LOOKBACK_DAYS) — we don't want today's partial numbers mixed into that
// "settled trailing window" logic. Same collections/filterKeys, so each
// run just upserts (refreshes) today's single row per entity per account.

const LEVELS = [
  { level: 'ad', collection: 'ads_insights', filterKeys: ['ad_id', 'date'] },
  { level: 'adset', collection: 'adsets_insights', filterKeys: ['adset_id', 'date'] },
  { level: 'campaign', collection: 'campaigns_insights', filterKeys: ['campaign_id', 'date'] },
];

// Compute "today" in Asia/Jakarta explicitly, independent of the server's
// OS timezone, so this is correct whether or not the box itself is set to WIB.
function todayJakarta() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // en-CA gives YYYY-MM-DD directly
}

async function run() {
  const accounts = parseAccounts();
  const today = todayJakarta();
  console.log(`Syncing Facebook Ads insights (today, partial) ${today} for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  for (const account of accounts) {
    console.log(`\n== ${account.label} (${account.id}) ==`);
    for (const { level, collection, filterKeys } of LEVELS) {
      try {
        const raw = await fetchInsights({ accountId: account.id, level, since: today, until: today });
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
