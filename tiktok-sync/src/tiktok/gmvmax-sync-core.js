import { config } from "../config.js";
import {
  fetchGmvMaxReport,
  fetchGmvMaxCampaigns,
  fetchGmvMaxProducts,
  fetchGmvMaxCreativesBatch,
  getFirstGmvMaxStoreId,
  chunkArray,
} from "./gmvmax.js";
import { upsertByFilter } from "../nocobase/client.js";
import { ensureThumbnailCached } from "./thumbnails.js";

const cfg = config;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sync campaign + product + creative level GMV Max data for one account,
 * for an explicit [startDate, endDate] window (both YYYY-MM-DD, max 29 days
 * apart — caller is responsible for chunking longer ranges via chunkDateRange()).
 * Used by both the daily incremental sync (last few days) and the historical
 * backfill script (looped across many chunks).
 */
export async function syncGmvMaxWindow({ account, startDate, endDate }) {
  const storeId = account.shop_id || (await getFirstGmvMaxStoreId({
    accessToken: account.ads_access_token,
    advertiserId: account.ads_advertiser_id,
  }));

  if (!storeId) {
    console.log(`  [${account.name}] no GMV-Max-eligible store found, skipping`);
    return { campaignRows: 0, productRows: 0, creativeRows: 0 };
  }

  const campaignMap = await fetchGmvMaxCampaigns({
    accessToken: account.ads_access_token,
    advertiserId: account.ads_advertiser_id,
  });

  // --- Campaign-level (daily) ---
  const rows = await fetchGmvMaxReport({
    accessToken: account.ads_access_token,
    advertiserId: account.ads_advertiser_id,
    storeId,
    startDate,
    endDate,
  });

  let campaignRows = 0;
  for (const row of rows) {
    try {
      const campaignInfo = campaignMap[row.campaign_id] || {};
      await upsertByFilter(
        cfg.nocobase.collections.gmvMax,
        { campaign_id: row.campaign_id, date: row.date },
        { fk_tiktok_account_id: account.id, ...row, ...campaignInfo }
      );
      campaignRows++;
    } catch (err) {
      console.error(`    campaign ${row.campaign_id}/${row.date} failed:`, err.response?.data || err.message);
    }
  }

  // --- Product + Creative level (daily), Product GMV Max campaigns only ---
  const productCampaignIds = Object.entries(campaignMap)
    .filter(([, info]) => info.promotion_type === "PRODUCT_GMV_MAX")
    .map(([campaignId]) => campaignId);

  let productRows = 0;
  let creativeRows = 0;

  console.log(`  [${account.name}] campaign-level: ${campaignRows} rows written. Now processing ${productCampaignIds.length} Product GMV Max campaigns for product/creative data...`);

  for (let ci = 0; ci < productCampaignIds.length; ci++) {
    const campaignId = productCampaignIds[ci];
    const campaignName = (campaignMap[campaignId] || {}).campaign_name || campaignId;
    console.log(`  [${account.name}] [${ci + 1}/${productCampaignIds.length}] ${campaignName}...`);
    try {
      await sleep(150);
      const products = await fetchGmvMaxProducts({
        accessToken: account.ads_access_token,
        advertiserId: account.ads_advertiser_id,
        storeId,
        campaignId,
        startDate,
        endDate,
      });

      const uniqueItemGroupIds = [...new Set(products.map((p) => p.item_group_id))];

      for (const product of products) {
        try {
          await upsertByFilter(
            cfg.nocobase.collections.gmvMaxProducts,
            { campaign_id: product.campaign_id, item_group_id: product.item_group_id, date: product.date },
            { fk_tiktok_account_id: account.id, ...product }
          );
          productRows++;
        } catch (err) {
          console.error(`      product ${product.item_group_id}/${product.date} failed:`, err.response?.data || err.message);
        }
      }

      // Batch up to 100 item_group_ids per creatives call instead of one call per product
      const batches = chunkArray(uniqueItemGroupIds, 100);
      for (const batch of batches) {
        try {
          await sleep(150);
          const creatives = await fetchGmvMaxCreativesBatch({
            accessToken: account.ads_access_token,
            advertiserId: account.ads_advertiser_id,
            storeId,
            campaignId,
            itemGroupIds: batch,
            startDate,
            endDate,
          });

          for (const creative of creatives) {
            try {
              await upsertByFilter(
                cfg.nocobase.collections.gmvMaxCreatives,
                {
                  campaign_id: creative.campaign_id,
                  item_group_id: creative.item_group_id,
                  item_id: creative.item_id,
                  date: creative.date,
                },
                { fk_tiktok_account_id: account.id, ...creative }
              );
              creativeRows++;

              // Fetch the thumbnail now, while the video is freshest — not
              // waiting for someone to open the report drawer. Already-cached
              // items return instantly (a file-existence check), so this is
              // cheap on every subsequent sync; only genuinely new creatives
              // trigger a real download + throttle.
              const thumbResult = await ensureThumbnailCached(creative.item_id);
              if (thumbResult.downloaded) await sleep(200);
            } catch (err) {
              console.error(`        creative ${creative.item_id}/${creative.date} failed:`, err.response?.data || err.message);
            }
          }
        } catch (err) {
          console.error(`      creatives batch for campaign ${campaignId} failed:`, err.response?.data || err.message);
        }
      }
    } catch (err) {
      console.error(`    products for campaign ${campaignId} failed:`, err.response?.data || err.message);
    }
  }

  return { campaignRows, productRows, creativeRows };
}
