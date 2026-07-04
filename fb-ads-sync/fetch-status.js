require('dotenv').config();

const { fetchEntityStatus } = require('./lib/facebook');
const { upsertMany } = require('./lib/nocobase');

// Syncs CURRENT effective_status (ACTIVE/PAUSED/DISAPPROVED/etc.) for every
// campaign/adset/ad into fb_ads_status. Deliberately NOT a period table —
// this is a snapshot, overwritten every run, keyed on (entity_type, entity_id)
// only. No date_range, no time_increment: /campaigns /adsets /ads are object
// endpoints, not /insights, so there's no "period" for status to belong to.
//
// This does NOT answer "was it active in a past period" — that's answered by
// delivery presence in the insights tables instead (see the Structure Report's
// hasActivity()). This table only ever answers "what is it right now."
//
// Usage: node fetch-status.js
// Cheap enough (no date range, small payload) to run every time sync.js runs,
// or on its own more frequent schedule if status changes matter faster than
// your daily sync cadence.

const COLLECTION = 'fb_ads_status';
const FILTER_KEYS = ['entity_type', 'entity_id'];
const LEVELS = ['campaign', 'adset', 'ad'];

async function run() {
  console.log('Syncing current FB ad status...');

  for (const level of LEVELS) {
    try {
      const rows = await fetchEntityStatus(level);
      const mapped = rows.map((r) => ({
        entity_type: level,
        entity_id: r.id,
        status: r.effective_status || 'UNKNOWN', // r.effective_status is Facebook's field name; fb_ads_status's column is just 'status'
        synced_at: new Date().toISOString(),
      }));
      const ok = await upsertMany(COLLECTION, mapped, FILTER_KEYS);
      console.log(`  ${level}: ${ok}/${mapped.length} -> ${COLLECTION}`);
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.message;
      console.error(`  ${level} failed: ${msg}`);
    }
  }

  console.log('Done.');
}

run();
