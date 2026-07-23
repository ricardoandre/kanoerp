require('dotenv').config();

const ig = require('./lib/instagram');
const { upsert } = require('./lib/nocobase');
const { parseAccounts, filterAccountsFromArgs } = require('./lib/ig-accounts');

// Usage:
//   node backfill-periodic.js --period=week
//   node backfill-periodic.js --period=month --account=AskaLabel
//   BACKFILL_SINCE=2026-01-01 node backfill-periodic.js --period=month

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

const SINCE = process.env.BACKFILL_SINCE || '2026-01-01'; // <-- set earliest date
const UNTIL = process.env.BACKFILL_UNTIL || ymd(yesterday());

// Monday-aligned weekly chunks covering [since, until].
function weekChunks(since, until) {
  const chunks = [];
  const end = new Date(`${until}T00:00:00Z`);
  let cur = new Date(`${since}T00:00:00Z`);
  // Snap start back to that week's Monday so chunks align with sync-periodic.js's math.
  const day = cur.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  cur.setUTCDate(cur.getUTCDate() - diffToMonday);

  while (cur <= end) {
    const weekStart = new Date(cur);
    const weekEnd = new Date(cur);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    chunks.push({ since: ymd(weekStart), until: ymd(weekEnd), period_start: ymd(weekStart), period_end: ymd(weekEnd) });
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return chunks;
}

// Calendar-month chunks covering [since, until].
function monthChunks(since, until) {
  const chunks = [];
  const end = new Date(`${until}T00:00:00Z`);
  let cur = new Date(Date.UTC(new Date(`${since}T00:00:00Z`).getUTCFullYear(), new Date(`${since}T00:00:00Z`).getUTCMonth(), 1));

  while (cur <= end) {
    const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    const chunkEnd = monthEnd < end ? monthEnd : end;
    chunks.push({ since: ymd(cur), until: ymd(chunkEnd), period_start: ymd(cur), period_end: ymd(monthEnd) });
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
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
  const chunks = periodType === 'week' ? weekChunks(SINCE, UNTIL) : monthChunks(SINCE, UNTIL);
  console.log(`Backfilling Instagram ${periodType} insights ${SINCE} -> ${UNTIL} in ${chunks.length} chunk(s) for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  for (const account of accounts) {
    console.log(`\n#### ${account.label} (${account.id}) ####`);
    for (const { since, until, period_start, period_end } of chunks) {
      try {
        const metrics = await ig.fetchAccountInsightsPeriod({ igUserId: account.id, since, until });
        const row = {
          account: account.label,
          ig_user_id: account.id,
          period_type: periodType,
          period_start,
          period_end,
          reach: metrics.reach || 0,
          accounts_engaged: metrics.accounts_engaged || 0,
          total_interactions: metrics.total_interactions || 0,
          likes: metrics.likes || 0,
          comments: metrics.comments || 0,
          shares: metrics.shares || 0,
          saves: metrics.saves || 0,
          replies: metrics.replies || 0,
          profile_views: metrics.profile_views || 0,
          website_clicks: metrics.website_clicks || 0,
          profile_link_taps: metrics.profile_links_taps || 0,
          views: metrics.views || 0,
          follower_count_end: null, // see backfill.js comment — never backfill "current" followers onto a past period
        };
        await upsert('ig_account_insights_period', row, ['ig_user_id', 'period_type', 'period_start']);
        console.log(`  ${period_start} -> ${period_end}: reach=${row.reach}, engaged=${row.accounts_engaged}`);
      } catch (e) {
        console.error(`  ${period_start} -> ${period_end} failed: ${e.message}`);
      }
    }
  }

  console.log('\nBackfill done.');
}

run();
