/**
 * One-off test: checks why a specific campaign has no product/creative data.
 * Checks whether it's classified correctly in the campaign list, and dumps
 * the raw product-level response for it directly.
 *
 * Usage: node src/test-gmvmax-campaign.js <campaign_id>
 */
import { getAllAccounts } from "./nocobase/accounts.js";
import { fetchGmvMaxCampaigns, fetchGmvMaxProducts, fetchGmvMaxCreatives, getFirstGmvMaxStoreId } from "./tiktok/gmvmax.js";

const targetCampaignId = process.argv[2];
if (!targetCampaignId) {
  console.log("Usage: node src/test-gmvmax-campaign.js <campaign_id>");
  process.exit(1);
}

async function main() {
  const accounts = await getAllAccounts();
  const account = accounts.find((a) => a.name === "askalabel");
  if (!account) {
    console.log("askalabel account not found.");
    return;
  }

  console.log("Fetching campaign list...");
  const campaignMap = await fetchGmvMaxCampaigns({
    accessToken: account.ads_access_token,
    advertiserId: account.ads_advertiser_id,
  });

  console.log(`Total campaigns found: ${Object.keys(campaignMap).length}`);
  console.log(`Target campaign ${targetCampaignId} in list?`, !!campaignMap[targetCampaignId]);
  if (campaignMap[targetCampaignId]) {
    console.log("Campaign info:", JSON.stringify(campaignMap[targetCampaignId], null, 2));
  }

  const storeId = account.shop_id || (await getFirstGmvMaxStoreId({
    accessToken: account.ads_access_token,
    advertiserId: account.ads_advertiser_id,
  }));
  console.log("Using store_id:", storeId);

  console.log("\nFetching products directly for this campaign...");
  let products = [];
  try {
    products = await fetchGmvMaxProducts({
      accessToken: account.ads_access_token,
      advertiserId: account.ads_advertiser_id,
      storeId,
      campaignId: targetCampaignId,
      lookbackDays: 29,
    });
    console.log(`Products found: ${products.length}`);
  } catch (err) {
    console.log("Products fetch FAILED:", JSON.stringify(err.response?.data || err.message, null, 2));
  }

  if (products.length > 0) {
    const topProduct = products.slice().sort((a, b) => b.cost - a.cost)[0];
    console.log(
      `\nTesting creatives for HIGHEST-spend product: ${topProduct.product_name} ` +
      `(item_group_id=${topProduct.item_group_id}, cost=${topProduct.cost}, orders=${topProduct.orders})`
    );
    try {
      const creatives = await fetchGmvMaxCreatives({
        accessToken: account.ads_access_token,
        advertiserId: account.ads_advertiser_id,
        storeId,
        campaignId: targetCampaignId,
        itemGroupId: topProduct.item_group_id,
        lookbackDays: 29,
      });
      console.log(`Creatives found: ${creatives.length}`);
      console.log(JSON.stringify(creatives, null, 2));
    } catch (err) {
      console.log("Creatives fetch FAILED:", JSON.stringify(err.response?.data || err.message, null, 2));
    }
  }
}

main();
