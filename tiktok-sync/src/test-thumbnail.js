/**
 * One-off test: calls /campaign/gmv_max/info/ directly for a known
 * campaign+item, and prints exactly what TikTok returns for that item's
 * video_info — bypassing the browser and our HTTP proxy entirely, so we
 * can see the raw truth before debugging anything further up the chain.
 *
 * Usage: node src/test-thumbnail.js <campaign_id> <item_id>
 */
import { getAccountByName } from "./nocobase/accounts.js";
import { fetchGmvMaxCampaignInfo } from "./tiktok/gmvmax.js";

// Robust against copy-paste corruption: if the shell didn't split the args
// correctly (e.g. a non-breaking space \u00A0 from pasting out of a UI table
// isn't treated as a separator by bash), recover both values by splitting
// on ANY whitespace-like character ourselves.
const rawParts = process.argv.slice(2).join(" ").split(/[\s\u00A0\u200B]+/).filter(Boolean);
const campaignId = rawParts[0] || "1841842529997954";
const itemId = rawParts[1] || "7665917026195623189";

console.log("Raw argv received:", JSON.stringify(process.argv.slice(2)));
console.log("Recovered parts:", JSON.stringify(rawParts));
console.log("Using campaignId:", JSON.stringify(campaignId));
console.log("Using itemId:", JSON.stringify(itemId));

async function main() {
  const account = await getAccountByName("in-kano");
  if (!account) {
    console.log("Account 'in-kano' not found.");
    return;
  }
  console.log("Using account id:", account.id);

  console.log(`\nFetching campaign info for campaign_id=${campaignId}...`);
  try {
    const info = await fetchGmvMaxCampaignInfo({
      accessToken: account.ads_access_token,
      advertiserId: account.ads_advertiser_id,
      campaignId,
    });

    console.log("\nFull raw response:");
    console.log(JSON.stringify(info, null, 2));

    if (!info) {
      console.log("\nNo data returned at all.");
      return;
    }

    const items = info.item_list || [];
    console.log(`\nTotal items in this campaign: ${items.length}`);

    const match = items.find((it) => String(it.item_id) === String(itemId));
    if (!match) {
      console.log(`\nItem ${itemId} NOT found in this campaign's item_list.`);
      console.log("First few item_ids that ARE present:", items.slice(0, 5).map((it) => it.item_id));
      return;
    }

    console.log(`\nFound item ${itemId}:`);
    console.log(JSON.stringify(match, null, 2));
  } catch (err) {
    console.log("REQUEST FAILED:");
    console.log(JSON.stringify(err.tiktokResponse || err.response?.data || err.message, null, 2));
  }
}

main();
