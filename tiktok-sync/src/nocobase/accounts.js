import { config } from "../config.js";
import { listRecords, updateRecord, getRecord } from "./client.js";

const COLLECTION = config.nocobase.collections.accounts;

export async function getAllAccounts() {
  return listRecords(COLLECTION, { pageSize: 200 });
}

export async function getAccountById(id) {
  try {
    return await getRecord(COLLECTION, id);
  } catch {
    return null;
  }
}

export async function getAccountByName(name) {
  const matches = await listRecords(COLLECTION, {
    filter: { name: { $eq: name } },
    pageSize: 1,
  });
  return matches[0] || null;
}

export async function getAccountsWithAdsAuth() {
  const all = await getAllAccounts();
  return all.filter((a) => a.ads_access_token && a.ads_advertiser_id);
}

export async function getAccountsWithContentAuth() {
  const all = await getAllAccounts();
  return all.filter((a) => a.content_access_token && a.content_open_id);
}

export async function getAccountsWithShopAuth() {
  const all = await getAllAccounts();
  return all.filter((a) => a.shop_access_token && a.shop_id);
}

export async function getAccountsWithGmvMaxAuth() {
  const all = await getAllAccounts();
  return all.filter((a) => a.ads_access_token && a.ads_advertiser_id && a.shop_id);
}

export async function saveAdsTokens(accountId, { accessToken, refreshToken, advertiserId, expiresAt }) {
  return updateRecord(COLLECTION, accountId, {
    ads_access_token: accessToken,
    ads_refresh_token: refreshToken,
    ads_advertiser_id: advertiserId,
    ads_token_expires_at: expiresAt,
  });
}

export async function saveContentTokens(accountId, { accessToken, refreshToken, openId, expiresAt }) {
  return updateRecord(COLLECTION, accountId, {
    content_access_token: accessToken,
    content_refresh_token: refreshToken,
    content_open_id: openId,
    content_token_expires_at: expiresAt,
  });
}

export async function saveShopTokens(accountId, { accessToken, refreshToken, shopId, expiresAt }) {
  return updateRecord(COLLECTION, accountId, {
    shop_access_token: accessToken,
    shop_refresh_token: refreshToken,
    shop_id: shopId,
    shop_token_expires_at: expiresAt,
  });
}
