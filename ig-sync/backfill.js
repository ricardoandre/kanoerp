require('dotenv').config();

const ig = require('./lib/instagram');
const { upsert } = require('./lib/nocobase');
const { parseAccounts, filterAccountsFromArgs } = require('./lib/ig-accounts');

// >>> IMPORTANT DIFFERENCE FROM fb-ads-sync/backfill.js:
// Facebook's ad insights support time_increment=1 to get one row per day
// in a SINGLE request per month-chunk. Instagram's account-level
// metric_type=total_value metrics (likes/comments/engagement/etc — see
// lib/instagram.js) only return ONE aggregated total for whatever [since,
// until] window you give them — there's no per-day breakdown parameter
// confirmed working for these in the probe. So getting a genuine DAILY
// history means one API call PER DAY, not per month. For a long backfill
// window (e.g. a year = 365 calls per account) this is slow and eats into
// your rate limit — consider backfilling `--period=week` or `--period=month`
// via backfill-periodic.js instead if you don't need daily granularity for
// old history, and reserve this script for a shorter recent window.
//
// Usage:
//   node backfill.js
//   node backfill.js --account=AskaLabel
//   BACKFILL_SINCE=2026-06-01 BACKFILL_UNTIL=2026-07-21 node backfill.js

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

const SINCE = process.env.BACKFILL_SINCE || ymd(yesterday()); // <-- set earliest date
const UNTIL = process.env.BACKFILL_UNTIL || ymd(yesterday());

function eachDay(since, until) {
  const days = [];
  let cur = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (cur <= end) {
    days.push(ymd(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

async function run() {
  const accounts = filterAccountsFromArgs(parseAccounts());
  const days = eachDay(SINCE, UNTIL);
  console.log(`Backfilling Instagram daily account insights ${SINCE} -> ${UNTIL} (${days.length} day(s)) for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  for (const account of accounts) {
    console.log(`\n#### ${account.label} (${account.id}) ####`);
    for (const date of days) {
      try {
        const metrics = await ig.fetchAccountInsightsPeriod({ igUserId: account.id, since: date, until: date });
        const row = {
          account: account.label,
          ig_user_id: account.id,
          period_type: 'day',
          period_start: date,
          period_end: date,
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
          // No follower_count_end here on purpose — backfilling a historical
          // "current followers" value would be actively wrong (it'd stamp
          // TODAY's follower count onto a past date). Leave null; only the
          // live daily/periodic sync scripts populate this field.
          follower_count_end: null,
        };
        await upsert('ig_account_insights_period', row, ['ig_user_id', 'period_type', 'period_start']);
        console.log(`  ${date}: reach=${row.reach}, engaged=${row.accounts_engaged}`);
      } catch (e) {
        console.error(`  ${date} failed: ${e.message}`);
      }
    }
  }

  console.log('\nBackfill done.');
}

run();
