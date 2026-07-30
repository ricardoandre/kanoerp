const axios = require('axios');
const FormData = require('form-data');

const BASE = (process.env.NOCOBASE_URL || '').replace(/\/$/, '');
const TOKEN = process.env.NOCOBASE_API_KEY;

const client = axios.create({
  baseURL: `${BASE}/api`,
  headers: { Authorization: `Bearer ${TOKEN}` },
});

// Without this, every failure just says "Request failed with status code
// 400" — useless for debugging which field/param NocoBase actually
// rejected. This rewrites err.message to include NocoBase's real error
// body (it typically returns { errors: [{ message: "..." }] }) so every
// function below (listAll, getOne, upsert, etc.) surfaces the real cause
// automatically, without each call site needing its own try/catch parsing.
client.interceptors.response.use(
  (res) => res,
  (err) => {
    const detail = err.response?.data?.errors?.map((e) => e.message).join('; ')
      || (err.response?.data ? JSON.stringify(err.response.data) : null);
    if (detail) err.message = `${err.message} — ${detail}`;
    return Promise.reject(err);
  }
);

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

// Loops .list() by page until a page returns fewer rows than pageSize —
// same safety pattern as the fetchAllPages helper used elsewhere in this
// project, avoids silent truncation past ~2000 rows on large collections
// (ig_media will grow well past that).
async function listAll(collection, params = {}, pageSize = 200) {
  const rows = [];
  let page = 1;
  for (;;) {
    const resp = await client.get(`/${collection}:list`, { params: { ...params, pageSize, page } });
    const data = resp.data?.data || [];
    rows.push(...data);
    if (data.length < pageSize) break;
    page++;
  }
  return rows;
}

// Upload raw image bytes into a collection's attachment field's storage.
// Returns the created attachment object (use its .id to link to a row).
// Identical to fb-ads-sync's version.
async function uploadAttachment(buffer, filename, mimetype, attachmentField) {
  const form = new FormData();
  form.append('file', buffer, { filename, contentType: mimetype });
  const url = `${BASE}/api/attachments:create?attachmentField=${encodeURIComponent(attachmentField)}`;
  const resp = await axios.post(url, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${TOKEN}` },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return resp.data?.data;
}

module.exports = { upsert, upsertMany, upsertRelational, upsertManyRelational, getOne, listAll, uploadAttachment };
