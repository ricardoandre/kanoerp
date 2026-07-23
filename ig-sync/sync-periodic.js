require('dotenv').config();

const ig = require('./lib/instagram');
const { upsert } = require('./lib/nocobase');
const { parseAccounts, filterAccountsFromArgs } = require('./lib/ig-accounts');

const FILTER_KEYS = ['ig_user_id', 'period_type', 'period_start'];

// Identical closed-period math to fb-ads-sync/sync-periodic.js — only run
// for periods that have FULLY ended (an in-progress week/month's reach is
// still changing), one aggregated API call per account per period.
function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function getClosedPeriod(periodType, ref = new Date()) {
  const today = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));

  if (periodType === 'week') {
    const day = today.getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = (day + 6) % 7;
    const thisMonday = new Date(today);
    thisMonday.setUTCDate(today.getUTCDate() - diffToMonday);
    const lastMonday = new Date(thisMonday);
    lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setUTCDate(thisMonday.getUTCDate() - 1);
    return { since: ymd(lastMonday), until: ymd(lastSunday), period_start: ymd(lastMonday), period_end: ymd(lastSunday) };
  }

  if (periodType === 'month') {
    const firstOfThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const lastOfPrevMonth = new Date(firstOfThisMonth);
    lastOfPrevMonth.setUTCDate(0);
    const firstOfPrevMonth = new Date(Date.UTC(lastOfPrevMonth.getUTCFullYear(), lastOfPrevMonth.getUTCMonth(), 1));
    return {
      since: ymd(firstOfPrevMonth),
      until: ymd(lastOfPrevMonth),
      period_start: ymd(firstOfPrevMonth),
      period_end: ymd(lastOfPrevMonth),
    };
  }

  throw new Error(`Unknown periodType: ${periodType}`);
}

async function syncPeriod(periodType) {
  const accounts = filterAccountsFromArgs(parseAccounts());
  const { since, until, period_start, period_end } = getClosedPeriod(periodType);

  console.log(`Syncing Instagram ${periodType} insights ${since} -> ${until} for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  for (const account of accounts) {
    console.log(`\n== ${account.label} (${account.id}) ==`);
    try {
      const metrics = await ig.fetchAccountInsightsPeriod({ igUserId: account.id, since, until });
      // See caveat in lib/instagram.js: follower_count_end is "current
      // followers as of now," not "as of period_end" — accurate for the
      // most-recently-closed period, increasingly stale for backfilled
      // older periods.
      const followerCountEnd = await ig.fetchFollowersCountNow(account.id);

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
        follower_count_end: followerCountEnd,
      };

      await upsert('ig_account_insights_period', row, FILTER_KEYS);
      console.log(`  reach=${row.reach}, engaged=${row.accounts_engaged}, interactions=${row.total_interactions}`);
    } catch (e) {
      console.error(`  failed: ${e.message}`);
    }
  }
  console.log('\nDone.');
}

async function run() {
  const arg = process.argv.find((a) => a.startsWith('--period='));
  const periodType = arg ? arg.split('=')[1] : null;

  if (!['week', 'month'].includes(periodType)) {
    console.error('Usage: node sync-periodic.js --period=week|month [--account=Label1,Label2]');
    process.exit(1);
  }

  await syncPeriod(periodType);
}

run();
