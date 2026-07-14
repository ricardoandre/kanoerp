require('dotenv').config();
const { fetchInsights } = require('./lib/facebook');
const { transformPeriodRow } = require('./lib/transform-period');
const { upsertMany } = require('./lib/nocobase');
const { parseAccounts } = require('./lib/accounts');

// Reach and frequency are NOT additive across days, so unlike sync.js
// (daily rows), this asks Facebook for the whole period in ONE request
// per entity and stores that as its own row. Only run for CLOSED periods
// — an in-progress day/week/month's reach is still changing.
const COLLECTION = 'fb_ads_period_data';
const FILTER_KEYS = ['entity_type', 'entity_id', 'period_type', 'period_start'];

// Daily reach is only synced at account level. Summing per-entity daily
// reach across ads/adsets/campaigns would double-count a user reached by
// multiple entities the same day — same dedup problem backfill-periodic.js
// avoids for its `day` period type.
const LEVELS_BY_PERIOD = {
  week: ['ad', 'adset', 'campaign', 'account'],
  month: ['ad', 'adset', 'campaign', 'account'],
  day: ['account'],
};

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function getClosedPeriod(periodType, ref = new Date()) {
  const today = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));

  if (periodType === 'day') {
    const yesterday = new Date(today);
    yesterday.setUTCDate(today.getUTCDate() - 1);
    return { since: ymd(yesterday), until: ymd(yesterday), period_start: ymd(yesterday) };
  }

  if (periodType === 'week') {
    const day = today.getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = (day + 6) % 7;
    const thisMonday = new Date(today);
    thisMonday.setUTCDate(today.getUTCDate() - diffToMonday);
    const lastMonday = new Date(thisMonday);
    lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setUTCDate(thisMonday.getUTCDate() - 1);
    return { since: ymd(lastMonday), until: ymd(lastSunday), period_start: ymd(lastMonday) };
  }

  if (periodType === 'month') {
    const firstOfThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const lastOfPrevMonth = new Date(firstOfThisMonth);
    lastOfPrevMonth.setUTCDate(0);
    const firstOfPrevMonth = new Date(Date.UTC(lastOfPrevMonth.getUTCFullYear(), lastOfPrevMonth.getUTCMonth(), 1));
    return { since: ymd(firstOfPrevMonth), until: ymd(lastOfPrevMonth), period_start: ymd(firstOfPrevMonth) };
  }

  throw new Error(`Unknown periodType: ${periodType}`);
}

async function syncPeriod(periodType) {
  const accounts = parseAccounts();
  const { since, until, period_start } = getClosedPeriod(periodType);
  const levels = LEVELS_BY_PERIOD[periodType];

  console.log(`Syncing FB Ads ${periodType} reach/frequency ${since} -> ${until} for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  for (const account of accounts) {
    console.log(`\n== ${account.label} (${account.id}) ==`);
    for (const level of levels) {
      try {
        // timeIncrement omitted -> one aggregated row per entity for [since, until]
        const raw = await fetchInsights({ accountId: account.id, level, since, until, timeIncrement: null });
        const rows = raw.map((r) => transformPeriodRow(level, periodType, period_start, r, account.label));
        const ok = await upsertMany(COLLECTION, rows, FILTER_KEYS);
        console.log(`  ${level}: ${ok}/${rows.length} rows upserted into ${COLLECTION}`);
      } catch (e) {
        const msg = e.response?.data?.error?.message || e.message;
        console.error(`  ${level} failed: ${msg}`);
      }
    }
  }
  console.log('\nDone.');
}

async function run() {
  const arg = process.argv.find((a) => a.startsWith('--period='));
  const periodType = arg ? arg.split('=')[1] : null;

  if (!['day', 'week', 'month'].includes(periodType)) {
    console.error('Usage: node sync-periodic.js --period=day|week|month');
    process.exit(1);
  }

  await syncPeriod(periodType);
}

run();
