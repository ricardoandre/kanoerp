require('dotenv').config();

const ig = require('./lib/instagram');
const { upsertMany, upsertManyRelational } = require('./lib/nocobase');
const { parseAccounts, filterAccountsFromArgs } = require('./lib/ig-accounts');

// Stories only exist for 24h and this endpoint only ever returns what's
// CURRENTLY live — there is no "give me stories from 3 days ago." So this
// script needs its own frequent cron entry (e.g. every 1-2 hours), separate
// from sync.js's once-daily cadence, or you'll miss stories that were
// posted and expired between runs.
async function run() {
  const accounts = filterAccountsFromArgs(parseAccounts());
  console.log(`Syncing Instagram active stories for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  for (const account of accounts) {
    console.log(`\n== ${account.label} (${account.id}) ==`);
    try {
      const stories = await ig.fetchActiveStories({ igUserId: account.id });
      console.log(`  ${stories.length} active stor${stories.length === 1 ? 'y' : 'ies'} right now`);
      if (!stories.length) continue;

      const storyRows = stories.map((s) => ({
        story_id: s.id,
        account: account.label,
        timestamp: s.timestamp,
        permalink: s.permalink || '',
      }));
      const storiesOk = await upsertMany('ig_stories', storyRows, ['story_id']);
      console.log(`  ig_stories: ${storiesOk}/${storyRows.length} upserted`);

      const syncedAt = new Date().toISOString();
      const insightRows = [];
      for (const s of stories) {
        try {
          const metrics = await ig.fetchStoryInsights({ storyId: s.id });
          insightRows.push({
            fk_ig_story_id: s.id,
            synced_at: syncedAt,
            reach: metrics.reach || 0,
            replies: metrics.replies || 0,
            navigation: metrics.navigation || 0,
            total_interactions: metrics.total_interactions || 0,
          });
        } catch (e) {
          console.error(`  story ${s.id} insights failed: ${e.message}`);
        }
      }

      const insightsOk = await upsertManyRelational(
        'ig_story_insights',
        insightRows,
        ['fk_ig_story_id', 'synced_at'],
        { fieldName: 'ig_story', targetKey: 'story_id', fkField: 'fk_ig_story_id' }
      );
      console.log(`  ig_story_insights: ${insightsOk}/${insightRows.length} upserted`);
    } catch (e) {
      console.error(`  stories fetch failed: ${e.message}`);
    }
  }

  console.log('\nDone.');
}

run();
