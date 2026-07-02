const axios = require('axios');
const FormData = require('form-data');

const BASE = (process.env.NOCOBASE_URL || '').replace(/\/$/, ''); // e.g. https://nocobase.example.com
const TOKEN = process.env.NOCOBASE_API_KEY;

const client = axios.create({
  baseURL: `${BASE}/api`,
  headers: { Authorization: `Bearer ${TOKEN}` },
});

// Upsert one record: matches on filterKeys, so a re-run updates the same row
// instead of inserting a duplicate. Endpoint: POST /api/<collection>:updateOrCreate
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

// Fetch a single record matching a filter (with optional relations appended).
async function getOne(collection, filter, appends = []) {
  const params = { filter: JSON.stringify(filter), pageSize: 1 };
  if (appends.length) params.appends = appends.join(',');
  const resp = await client.get(`/${collection}:list`, { params });
  return resp.data?.data?.[0] || null;
}

// Upload raw image bytes into a collection's attachment field's storage.
// Returns the created attachment object (use its .id to link to a row).
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

module.exports = { upsert, upsertMany, getOne, uploadAttachment };
