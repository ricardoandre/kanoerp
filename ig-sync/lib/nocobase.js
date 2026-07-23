const axios = require('axios');

const BASE = (process.env.NOCOBASE_URL || '').replace(/\/$/, '');
const TOKEN = process.env.NOCOBASE_API_KEY;

const client = axios.create({
  baseURL: `${BASE}/api`,
  headers: { Authorization: `Bearer ${TOKEN}` },
});

// Upsert one record: matches on filterKeys, so a re-run updates the same
// row instead of inserting a duplicate. Identical to fb-ads-sync's version
// — copied rather than shared-imported since ig-sync is a separate
// deployment (own node_modules/.env), per project convention.
async function upsert(collection, values, filterKeys) {
  const qs = filterKeys.map((k) => `filterKeys[]=${encodeURIComponent(k)}`).join('&');
  return client.post(`/${collection}:updateOrCreate?${qs}`, values);
}

async function upsertMany(collection, rows, filterKeys) {
  let ok = 0;
  for (const row of rows) {
    try {
      await upsert(collection, row, filterKeys);
      ok++;
    } catch (e) {
      const msg = e.response?.data?.errors?.[0]?.message || e.message;
      console.error(`  x ${collection} ${filterKeys.map((k) => row[k]).join('/')}: ${msg}`);
    }
  }
  return ok;
}

// ---------------------------------------------------------------------
// RELATIONAL VARIANT — for child tables that reference a parent via
// belongsTo (ig_media_insights -> ig_media, ig_media_comments -> ig_media,
// ig_story_insights -> ig_stories).
//
// Per the project's established NocoBase lesson: belongsTo writes need a
// NESTED payload — { ig_media: { media_id: X } } — not a flat
// { fk_ig_media_id: X }. This helper builds that nested shape for the
// CREATE/UPDATE body.
//
// >>> UNVERIFIED ASSUMPTION, please check on first real run: filterKeys
//     for upsert matching is passed as the flat fk column name (e.g.
//     'fk_ig_media_id'), and this helper ALSO includes that flat field
//     in the request body (alongside the nested relation object) so
//     NocoBase's updateOrCreate can build its WHERE-matching filter from
//     it. If the first sync run either (a) throws on the extra flat fk
//     field, or (b) silently creates duplicate rows instead of updating,
//     that means NocoBase's filterKeys lookup needs the nested dot-path
//     form instead (e.g. 'ig_media.media_id') — ping me and I'll adjust
//     this one function, nothing else needs to change.
// ---------------------------------------------------------------------
async function upsertRelational(collection, row, filterKeys, relation) {
  const { fieldName, targetKey, fkField } = relation;
  const value = row[fkField];
  if (value === undefined || value === null) {
    throw new Error(`upsertRelational: row missing ${fkField} for ${collection}`);
  }
  const payload = { ...row, [fieldName]: { [targetKey]: value } };
  return upsert(collection, payload, filterKeys);
}

async function upsertManyRelational(collection, rows, filterKeys, relation) {
  let ok = 0;
  for (const row of rows) {
    try {
      await upsertRelational(collection, row, filterKeys, relation);
      ok++;
    } catch (e) {
      const msg = e.response?.data?.errors?.[0]?.message || e.message;
      console.error(`  x ${collection} ${filterKeys.map((k) => row[k]).join('/')}: ${msg}`);
    }
  }
  return ok;
}

async function getOne(collection, filter, appends = []) {
  const params = { filter: JSON.stringify(filter), pageSize: 1 };
  if (appends.length) params.appends = appends.join(',');
  const resp = await client.get(`/${collection}:list`, { params });
  return resp.data?.data?.[0] || null;
}

module.exports = { upsert, upsertMany, upsertRelational, upsertManyRelational, getOne };
