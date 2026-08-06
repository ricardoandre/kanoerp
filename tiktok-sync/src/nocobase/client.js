import axios from "axios";
import { config } from "../config.js";

const http = axios.create({
  baseURL: config.nocobase.baseUrl,
  headers: {
    Authorization: `Bearer ${config.nocobase.apiToken}`,
    "Content-Type": "application/json",
  },
});

/**
 * NocoBase's REST API uses "action" suffixes on the collection name rather than
 * separate paths, e.g. POST /tiktok_ads:create, GET /tiktok_ads:list,
 * POST /tiktok_ads:update?filterByTk=<id>
 */

export async function listRecords(collection, { filter, pageSize = 200, page = 1, appends } = {}) {
  const params = { pageSize, page };
  if (filter) params.filter = JSON.stringify(filter);
  if (appends) params.appends = appends.join(",");
  const res = await http.get(`/${collection}:list`, { params });
  return res.data.data || [];
}

export async function getRecord(collection, id) {
  const res = await http.get(`/${collection}:get`, { params: { filterByTk: id } });
  if (!res.data.data) {
    throw new Error(`No record found in ${collection} with id ${id}`);
  }
  return res.data.data;
}

export async function createRecord(collection, record) {
  const res = await http.post(`/${collection}:create`, record);
  return res.data.data;
}

export async function updateRecord(collection, id, patch) {
  const res = await http.post(`/${collection}:update`, patch, { params: { filterByTk: id } });
  return res.data.data;
}

export async function destroyRecord(collection, id) {
  const res = await http.post(`/${collection}:destroy`, {}, { params: { filterByTk: id } });
  return res.data.data;
}

/**
 * Upsert helper: finds a record matching an exact-match filter object
 * (e.g. { ad_id: "123", date: "2026-07-29" }), updates it if found, otherwise creates it.
 * Good for idempotent daily syncs so re-running doesn't create duplicate rows.
 */
export async function upsertByFilter(collection, filter, record) {
  const nocobaseFilter = {
    $and: Object.entries(filter).map(([field, value]) => ({ [field]: { $eq: value } })),
  };
  const existing = await listRecords(collection, { filter: nocobaseFilter, pageSize: 1 });
  if (existing.length > 0) {
    return updateRecord(collection, existing[0].id, record);
  }
  return createRecord(collection, record);
}

/**
 * Upsert helper for tables whose primary key IS the natural key (e.g. ad_id
 * as primaryKey, no separate auto-increment id). Tries to fetch by that key
 * directly; updates if found, creates otherwise.
 */
export async function upsertByPrimaryKey(collection, pkValue, record) {
  try {
    await getRecord(collection, pkValue);
    return updateRecord(collection, pkValue, record);
  } catch (err) {
    // Not found (or any fetch error) — attempt create instead.
    return createRecord(collection, record);
  }
}

export default { listRecords, getRecord, createRecord, updateRecord, destroyRecord, upsertByFilter, upsertByPrimaryKey };
