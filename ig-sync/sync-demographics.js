require('dotenv').config();

const ig = require('./lib/instagram');
const { upsertMany } = require('./lib/nocobase');
const { parseAccounts, filterAccountsFromArgs } = require('./lib/ig-accounts');

// Demographics shift slowly (unlike daily reach/engagement) — a
// weekly or monthly cron is plenty. Each run is a fresh snapshot
// (synced_at), so history builds up naturally for trend queries rather
// than overwriting the same row.
async function run() {
  const accounts = filterAccountsFromArgs(parseAccounts());
  console.log(`Syncing Instagram follower demographics for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  const syncedAt = new Date().toISOString();

  for (const account of accounts) {
    console.log(`\n== ${account.label} (${account.id}) ==`);
    try {
      const rows = await ig.fetchFollowerDemographics({ igUserId: account.id });
      const mapped = rows.map((r) => ({
        ig_user_id: account.id,
        account: account.label,
        breakdown_type: r.breakdown_type,
        breakdown_key: r.breakdown_key,
        value: r.value,
        synced_at: syncedAt,
      }));
      const ok = await upsertMany(
        'ig_follower_demographics',
        mapped,
        ['ig_user_id', 'breakdown_type', 'breakdown_key', 'synced_at']
      );
      console.log(`  ig_follower_demographics: ${ok}/${mapped.length} upserted`);
    } catch (e) {
      console.error(`  failed: ${e.message}`);
    }
  }

  console.log('\nDone.');
}

run();
