require('dotenv').config();

const { fetchInsights } = require('./lib/facebook');
const { TRANSFORMERS } = require('./lib/transform');
const { upsertMany } = require('./lib/nocobase');

// One-time historical backfill. Set the start date below (or via env), then run:
//   node backfill.js
// Facebook keeps insights for ~37 months, so don't go further back than that.
// Pulls month-by-month so each request stays small. Safe to re-run / resume:
// the upsert means re-running a chunk just refreshes those rows, no duplicates.

const SINCE = process.env.BACKFILL_SINCE || '2024-01-01'; // <-- earliest date to fetch
const UNTIL = process.env.BACKFILL_UNTIL || ymd(yesterday());

const LEVELS = [
  { level: 'ad', collection: 'ads_insights', filterKeys: ['ad_id', 'date'] },
  { level: 'adset', collection: 'adsets_insights', filterKeys: ['adset_id', 'date'] },
  { level: 'campaign', collection: 'campaigns_insights', filterKeys: ['campaign_id', 'date'] },
];

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

// Split [since, until] into one chunk per calendar month.
function monthChunks(since, until) {
  const chunks = [];
  const end = new Date(`${until}T00:00:00Z`);
  let cur = new Date(`${since}T00:00:00Z`);

  while (cur <= end) {
    const start = new Date(cur);
    const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    const chunkEnd = monthEnd < end ? monthEnd : end;
    chunks.push({ since: ymd(start), until: ymd(chunkEnd) });
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return chunks;
}

async function run() {
  const chunks = monthChunks(SINCE, UNTIL);
  console.log(`Backfilling ${SINCE} -> ${UNTIL} in ${chunks.length} monthly chunks`);

  for (const { since, until } of chunks) {
    console.log(`\n== ${since} -> ${until} ==`);
    for (const { level, collection, filterKeys } of LEVELS) {
      try {
        const raw = await fetchInsights({ level, since, until });
        const rows = raw.map(TRANSFORMERS[level]);
        const ok = await upsertMany(collection, rows, filterKeys);
        console.log(`  ${level}: ${ok}/${rows.length} -> ${collection}`);
      } catch (e) {
        const msg = e.response?.data?.error?.message || e.message;
        console.error(`  ${level} failed: ${msg}`);
      }
    }
  }

  console.log('\nBackfill done.');
}

run();
