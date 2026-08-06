import { config } from "./config.js";
import {
  getAccountsWithAdsAuth,
  getAccountsWithContentAuth,
  getAccountsWithShopAuth,
} from "./nocobase/accounts.js";
import { fetchAdPerformance } from "./tiktok/ads.js";
import { fetchAdCreatives } from "./tiktok/creatives.js";
import { dateNDaysAgo } from "./tiktok/gmvmax.js";
import { syncGmvMaxWindow } from "./tiktok/gmvmax-sync-core.js";
import { fetchContentPerformance } from "./tiktok/content.js";
import { fetchAffiliatePerformance } from "./tiktok/affiliate.js";
import { upsertByFilter, upsertByPrimaryKey } from "./nocobase/client.js";
const cfg = config;

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

function toDateOnly(isoString) {
  return isoString ? isoString.slice(0, 10) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncAds() {
  const accounts = await getAccountsWithAdsAuth();
  console.log(`Syncing ads for ${accounts.length} account(s)...`);

  for (const account of accounts) {
    try {
      const rows = await fetchAdPerformance({
        accessToken: account.ads_access_token,
        advertiserId: account.ads_advertiser_id,
        lookbackDays: cfg.sync.lookbackDays,
      });

      for (const row of rows) {
        await upsertByFilter(
          cfg.nocobase.collections.ads,
          { ad_id: row.ad_id, date: row.date },
          { fk_tiktok_account_id: account.id, ...row }
        );
      }
      console.log(`  [${account.name}] wrote ${rows.length} ad performance rows`);
    } catch (err) {
      console.error(`  [${account.name}] ads sync failed:`, err.response?.data || err.message);
    }
  }
}

async function syncAdCreatives() {
  const accounts = await getAccountsWithAdsAuth();
  console.log(`Syncing ad creatives for ${accounts.length} account(s)...`);

  for (const account of accounts) {
    try {
      const rows = await fetchAdCreatives({
        accessToken: account.ads_access_token,
        advertiserId: account.ads_advertiser_id,
      });

      let written = 0;
      for (const row of rows) {
        try {
          await upsertByPrimaryKey(
            cfg.nocobase.collections.adCreatives,
            row.ad_id,
            { fk_tiktok_account_id: account.id, ...row }
          );
          written++;
        } catch (rowErr) {
          console.error(
            `    ad_id ${row.ad_id} failed:`,
            rowErr.response?.data || rowErr.message
          );
        }
      }
      console.log(`  [${account.name}] wrote ${written}/${rows.length} ad creative rows`);
    } catch (err) {
      console.error(`  [${account.name}] ad creatives sync failed:`, err.response?.data || err.message);
    }
  }
}

async function syncGmvMax() {
  const accounts = await getAccountsWithAdsAuth();
  console.log(`Syncing GMV Max data for ${accounts.length} account(s)...`);

  const endDate = dateNDaysAgo(0);
  const startDate = dateNDaysAgo(Math.min(cfg.sync.lookbackDays, 29));

  for (const account of accounts) {
    try {
      const { campaignRows, productRows, creativeRows } = await syncGmvMaxWindow({
        account,
        startDate,
        endDate,
      });
      console.log(
        `  [${account.name}] wrote ${campaignRows} campaign rows, ${productRows} product rows, ${creativeRows} creative rows`
      );
    } catch (err) {
      console.error(`  [${account.name}] GMV Max sync failed:`, err.response?.data || err.message);
    }
  }
}

async function syncContent() {
  const accounts = await getAccountsWithContentAuth();
  console.log(`Syncing content for ${accounts.length} account(s)...`);

  for (const account of accounts) {
    try {
      const rows = await fetchContentPerformance({
        accessToken: account.content_access_token,
        openId: account.content_open_id,
      });

      for (const row of rows) {
        row.posted_at = toDateOnly(row.posted_at);
        await upsertByFilter(
          cfg.nocobase.collections.content,
          { video_id: row.video_id },
          { fk_tiktok_account_id: account.id, ...row }
        );
      }
      console.log(`  [${account.name}] wrote ${rows.length} content rows`);
    } catch (err) {
      console.error(`  [${account.name}] content sync failed:`, err.response?.data || err.message);
    }
  }
}

async function syncAffiliate() {
  const accounts = await getAccountsWithShopAuth();
  console.log(`Syncing affiliate data for ${accounts.length} account(s)...`);

  for (const account of accounts) {
    try {
      const rows = await fetchAffiliatePerformance({
        accessToken: account.shop_access_token,
        shopId: account.shop_id,
        lookbackDays: cfg.sync.lookbackDays,
      });

      for (const row of rows) {
        row.created_at = toDateOnly(row.created_at);
        await upsertByFilter(
          cfg.nocobase.collections.affiliate,
          { order_id: row.order_id },
          { fk_tiktok_account_id: account.id, ...row }
        );
      }
      console.log(`  [${account.name}] wrote ${rows.length} affiliate rows`);
    } catch (err) {
      console.error(`  [${account.name}] affiliate sync failed:`, err.response?.data || err.message);
    }
  }
}

async function main() {
  if (!only || only === "ads") await syncAds();
  if (!only || only === "creatives") await syncAdCreatives();
  if (!only || only === "gmvmax") await syncGmvMax();
  if (!only || only === "content") await syncContent();
  if (!only || only === "affiliate") await syncAffiliate();
  console.log("Sync complete.");
}

main().catch((err) => {
  console.error("Fatal sync error:", err);
  process.exit(1);
});
