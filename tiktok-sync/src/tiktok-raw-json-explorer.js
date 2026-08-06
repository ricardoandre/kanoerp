/**
 * One-off explorer: pulls RAW responses straight from TikTok's GMV Max
 * Report API and saves them to disk. Two purposes:
 *   1. See real field names before designing tiktok_products/tiktok_creatives.
 *   2. Settle the Amary question directly: does campaign 1841842529997954's
 *      own product list include BOTH item_group_ids? If yes, the mismatch
 *      is TikTok legitimately reusing one creative across multiple products
 *      in the same campaign, not a bug in your sync.
 *
 * Reuses your real modules (adsAuth.js, gmvmax.js, accounts.js) instead of
 * guessed constants — the previous version of this script guessed
 * ACCESS_TOKEN_HEADER and STORE_ID_FIELD; both are now known to be wrong
 * ("Access-Token" was right by luck, but store id is NOT a fixed account
 * field — it's account.shop_id, falling back to a live API call).
 *
 * Not a sync job — doesn't write to NocoBase.
 *
 * Usage:
 *   node src/scripts/tiktok-raw-json-explorer.js [accountName] [campaignId] [itemId]
 *
 * Defaults to the in-kano account, the Amary campaign, and the Amary
 * creative from the investigation if you don't pass arguments.
 */
import fs from "fs/promises";
import axios from "axios";
import { ADS_API_BASE, adsAuthHeaders } from "../tiktok/adsAuth.js";
import { getFirstGmvMaxStoreId } from "../tiktok/gmvmax.js";
import { getAccountByName, getAccountsWithAdsAuth } from "../nocobase/accounts.js";

const DEFAULT_ACCOUNT_NAME = "in-kano";
const DEFAULT_CAMPAIGN_ID = "1841842529997954";
const DEFAULT_ITEM_ID = "7580388536822582545"; // the Amary creative from the investigation
const AMARY_ITEM_GROUP_ID = "1730858517842790265";
const OTHER_ITEM_GROUP_ID = "1733315519924766585";

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
const today = new Date();
const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
const START_DATE = fmtDate(monthAgo);
const END_DATE = fmtDate(today);

async function reportGet({ accessToken, storeId, advertiserId, dimensions, metrics, filtering, pageSize = 100 }) {
  const res = await axios.get(`${ADS_API_BASE}/gmv_max/report/get/`, {
    headers: adsAuthHeaders(accessToken),
    params: {
      advertiser_id: advertiserId,
      store_ids: JSON.stringify([storeId]),
      dimensions: JSON.stringify(dimensions),
      metrics: JSON.stringify(metrics),
      start_date: START_DATE,
      end_date: END_DATE,
      ...(filtering ? { filtering: JSON.stringify(filtering) } : {}),
      page: 1,
      page_size: pageSize,
    },
  });
  return res.data;
}

function summarize(label, json) {
  const rows = json?.data?.list || [];
  console.log(`\n--- ${label} ---`);
  console.log("code:", json?.code, json?.message || "");
  console.log("Row count:", rows.length);
  if (rows[0]) console.log("Shape of first row:", JSON.stringify(rows[0], null, 2));
}

async function saveJson(filename, data) {
  await fs.mkdir("./tiktok-raw-samples", { recursive: true });
  await fs.writeFile(`./tiktok-raw-samples/${filename}`, JSON.stringify(data, null, 2));
  console.log("Saved: ./tiktok-raw-samples/" + filename);
}

async function main() {
  const accountName = process.argv[2] || DEFAULT_ACCOUNT_NAME;
  const campaignId = process.argv[3] || DEFAULT_CAMPAIGN_ID;
  const itemId = process.argv[4] || DEFAULT_ITEM_ID;

  const account = await getAccountByName(accountName);
  if (!account || !account.ads_access_token || !account.ads_advertiser_id) {
    const available = (await getAccountsWithAdsAuth()).map((a) => a.name).join(", ");
    console.error(`Account "${accountName}" not found or missing ads auth. Accounts with ads auth: ${available}`);
    process.exit(1);
  }

  const storeId = account.shop_id || (await getFirstGmvMaxStoreId({
    accessToken: account.ads_access_token,
    advertiserId: account.ads_advertiser_id,
  }));
  if (!storeId) {
    console.error(`No GMV-Max-eligible store found for ${account.name}.`);
    process.exit(1);
  }
  console.log(`Account: ${account.name}  advertiser_id=${account.ads_advertiser_id}  store_id=${storeId}`);

  const ctx = { accessToken: account.ads_access_token, advertiserId: account.ads_advertiser_id, storeId };

  // 1) THE DECISIVE CHECK — does this campaign's own product list include
  //    both item_group_ids? If yes, the Amary mismatch is expected behavior
  //    (one campaign, multiple products, shared creative), not corruption.
  const products = await reportGet({
    ...ctx,
    dimensions: ["item_group_id", "stat_time_day"],
    metrics: ["product_name", "item_group_id", "product_image_url", "product_status", "cost"],
    filtering: { campaign_ids: [campaignId] },
  });
  summarize(`Campaign ${campaignId}'s product list`, products);
  await saveJson(`${account.name}-campaign-${campaignId}-products.json`, products);
  const productIds = new Set((products?.data?.list || []).map((r) => r.dimensions.item_group_id));
  console.log("\n>>> Does this campaign include Amary (" + AMARY_ITEM_GROUP_ID + ")?", productIds.has(AMARY_ITEM_GROUP_ID));
  console.log(">>> Does this campaign include the other product (" + OTHER_ITEM_GROUP_ID + ")?", productIds.has(OTHER_ITEM_GROUP_ID));
  console.log(">>> If both are true, TikTok is legitimately running this creative across multiple products in one campaign.\n");

  // 2) Same delivery/funnel call your real sync makes, scoped to this exact
  //    creative — see every item_group_id TikTok itself reports for it.
  const delivery = await reportGet({
    ...ctx,
    dimensions: ["campaign_id", "item_group_id", "item_id", "stat_time_day"],
    metrics: ["creative_delivery_status", "cost", "orders", "gross_revenue"],
    filtering: { campaign_ids: [campaignId], item_ids: [itemId] },
  });
  summarize(`Delivery rows for item_id=${itemId} in campaign ${campaignId}`, delivery);
  await saveJson(`${account.name}-creative-${itemId}-delivery.json`, delivery);

  // 3) The attribute call (title/account/etc.) exactly as your sync makes it.
  const attrs = await reportGet({
    ...ctx,
    dimensions: ["item_id"],
    metrics: ["title", "tt_account_name", "tt_account_profile_image_url", "tt_account_authorization_type", "shop_content_type"],
    filtering: { campaign_ids: [campaignId], item_group_ids: [AMARY_ITEM_GROUP_ID, OTHER_ITEM_GROUP_ID], creative_types: ["ADS_AND_ORGANIC"] },
  });
  summarize(`Attribute call for item_id=${itemId}`, attrs);
  await saveJson(`${account.name}-creative-${itemId}-attributes.json`, attrs);

  console.log("\nDone — see ./tiktok-raw-samples/ for full raw JSON.");
}

main().catch((err) => {
  console.error("Fatal error:", err.response?.data || err.message);
  process.exit(1);
});
