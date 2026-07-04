require('dotenv').config();

const { fetchInsights } = require('./lib/facebook');
const { transformPeriodRow } = require('./lib/transform-period');
const { upsertMany } = require('./lib/nocobase');
const { parseAccounts, filterAccountsFromArgs } = require('./lib/accounts');

// One-time historical backfill for weekly/monthly reach & frequency.
//
// Usage:
//   BACKFILL_SINCE=2024-01-01 node backfill-periodic.js --period=week
//   BACKFILL_SINCE=2024-01-01 node backfill-periodic.js --period=month
//   BACKFILL_SINCE=2024-01-01 node backfill-periodic.js --period=week --account=Shop1
//
// Chunks are whole periods (a week or a month), since each chunk IS the
// row being stored — there's no daily data to aggregate afterward.
// Safe to re-run/resume: upsert means re-running a chunk just refreshes it —
// so --account is a convenience (skip accounts already backfilled), not a
// correctness requirement.

const COLLECTION = 'fb_ads_period_data';
const FILTER_KEYS = ['entity_type', 'entity_id', 'period_type', 'period_start'];
// 'adset' added here — previously omitted, which happened to paper over
// entityIdFor's missing 'adset' case in transform-period.js (now fixed).
// Since that bug meant adset rows never actually landed in
// fb_ads_period_data, run this once after deploying to backfill them
// retroactively (existing ad/campaign/account rows are unaffected — upsert
// just refreshes what's already there).
const LEVELS = ['ad', 'adset', 'campaign', 'account'];

const SINCE = process.env.BACKFILL_SINCE || '2024-01-01';

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function yesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function periodChunks(periodType, since, until) {
  const chunks = [];
  const end = new Date(`${until}T00:00:00Z`);

  if (periodType === 'week') {
    let cur = new Date(`${since}T00:00:00Z`);
    const diffToMonday = (cur.getUTCDay() + 6) % 7;
    cur.setUTCDate(cur.getUTCDate() - diffToMonday);

    while (true) {
      const chunkEnd = new Date(cur);
      chunkEnd.setUTCDate(cur.getUTCDate() + 6);
      if (chunkEnd > end) break; // only fully closed weeks
      chunks.push({ since: ymd(cur), until: ymd(chunkEnd), period_start: ymd(cur) });
      cur = new Date(cur);
      cur.setUTCDate(cur.getUTCDate() + 7);
    }
  } else if (periodType === 'month') {
    const sinceDate = new Date(`${since}T00:00:00Z`);
    let cur = new Date(Date.UTC(sinceDate.getUTCFullYear(), sinceDate.getUTCMonth(), 1));

    while (true) {
      const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
      if (monthEnd > end) break; // only fully closed months
      chunks.push({ since: ymd(cur), until: ymd(monthEnd), period_start: ymd(cur) });
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }
  } else {
    throw new Error(`Unknown periodType: ${periodType}`);
  }

  return chunks;
}

async function run() {
  const arg = process.argv.find((a) => a.startsWith('--period='));
  const periodType = arg ? arg.split('=')[1] : null;

  if (!['week', 'month'].includes(periodType)) {
    console.error('Usage: node backfill-periodic.js --period=week|month [--account=Label1,Label2]');
    process.exit(1);
  }

  const accounts = filterAccountsFromArgs(parseAccounts());
  const until = ymd(yesterday());
  const chunks = periodChunks(periodType, SINCE, until);
  console.log(`Backfilling ${periodType} reach/frequency: ${SINCE} -> ${until} in ${chunks.length} chunks for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  for (const account of accounts) {
    console.log(`\n#### ${account.label} (${account.id}) ####`);
    for (const { since, until: chunkUntil, period_start } of chunks) {
      console.log(`\n== ${since} -> ${chunkUntil} ==`);
      for (const level of LEVELS) {
        try {
          const raw = await fetchInsights({ accountId: account.id, level, since, until: chunkUntil, timeIncrement: null });
          const rows = raw.map((r) => transformPeriodRow(level, periodType, period_start, r, account.label));
          const ok = await upsertMany(COLLECTION, rows, FILTER_KEYS);
          console.log(`  ${level}: ${ok}/${rows.length} -> ${COLLECTION}`);
        } catch (e) {
          const msg = e.response?.data?.error?.message || e.message;
          console.error(`  ${level} failed: ${msg}`);
        }
      }
    }
  }

  console.log('\nBackfill done.');
}

run();
