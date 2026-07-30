require('dotenv').config();

const ig = require('./lib/instagram');
const { upsert } = require('./lib/nocobase');
const { parseAccounts, filterAccountsFromArgs } = require('./lib/ig-accounts');

// Finds the earliest month Instagram will actually return account insights
// for, then backfills every month from there to now — you don't need to
// guess a start date or grep logs for the transition point yourself.
//
// How it works: starts from ANCHOR_START (a deliberately-too-early date —
// 2018 predates almost all Instagram Business/Creator account insights
// history) and walks FORWARD month by month. Calls that fail before we've
// found any real data are treated as "before this account's history began"
// and just skipped, not logged as errors. Once the first successful call
// happens, everything after is treated as real backfilling — if 3 calls in
// a row fail AFTER that point, that's a genuine problem (rate limit,
// token issue, etc.), not "no data yet," so it stops and flags it instead
// of silently skipping the rest of your history.
//
// Usage:
//   node backfill-earliest.js
//   node backfill-earliest.js --account=AskaLabel
//   BACKFILL_ANCHOR=2020-01-01 node backfill-earliest.js   (narrower search if you know roughly when the account started)

const ANCHOR_START = process.env.BACKFILL_ANCHOR || '2018-01-01';

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

const UNTIL = process.env.BACKFILL_UNTIL || ymd(yesterday());

// Calendar-month chunks covering [since, until] — identical to
// backfill-periodic.js's version.
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
  const accounts = filterAccountsFromArgs(parseAccounts());
  const chunks = monthChunks(ANCHOR_START, UNTIL);
  console.log(`Searching for earliest available data from ${ANCHOR_START} onward, testing ${chunks.length} month(s), for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  for (const account of accounts) {
    console.log(`\n#### ${account.label} (${account.id}) ####`);
    let foundStart = false;
    let consecutiveFailures = 0;
    let monthsWritten = 0;

    for (const { since, until, period_start, period_end } of chunks) {
      try {
        const metrics = await ig.fetchAccountInsightsPeriod({ igUserId: account.id, since, until });
        if (!foundStart) {
          foundStart = true;
          console.log(`  >>> earliest available data starts at ${period_start} <<<`);
        }
        consecutiveFailures = 0;

        const row = {
          account: account.label,
          ig_user_id: account.id,
          period_type: 'month',
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
          follower_count_end: null, // never backfill "current" followers onto a past period
        };
        await upsert('ig_account_insights_period', row, ['ig_user_id', 'period_type', 'period_start']);
        console.log(`  ${period_start} -> ${period_end}: reach=${row.reach}, engaged=${row.accounts_engaged}`);
        monthsWritten++;
      } catch (e) {
        if (!foundStart) {
          console.log(`  ${period_start}: no data yet (${e.message}) — before this account's history, skipping`);
          continue;
        }
        consecutiveFailures++;
        console.error(`  ${period_start} -> ${period_end} failed: ${e.message}`);
        if (consecutiveFailures >= 3) {
          console.warn(`  3 failures in a row after finding real data — stopping ${account.label} here, this looks like a real problem (rate limit / token / API change), not "no data." Check the error above and re-run once resolved; already-written months won't be re-processed.`);
          break;
        }
      }
    }

    if (!foundStart) {
      console.warn(`  No data found anywhere in ${ANCHOR_START} -> ${UNTIL} for ${account.label}. Either this account's insights genuinely don't go back that far (unlikely) or something else is wrong — check ANCHOR_START or run a single manual test with backfill-periodic.js.`);
    } else {
      console.log(`  ${account.label}: wrote ${monthsWritten} month(s) total.`);
    }
  }

  console.log('\nDone.');
}

run();
