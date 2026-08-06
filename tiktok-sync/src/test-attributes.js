/**
 * One-off test: calls the attribute-level report (title/account name/etc.)
 * for one specific item, to see exactly what TikTok returns — checking
 * whether the account handle is actually available via the API the way
 * it's shown in TikTok's own Ads Manager UI.
 *
 * Usage: node src/test-attributes.js <campaign_id> <item_group_id> <item_id>
 */
import axios from "axios";
import { getAccountByName } from "./nocobase/accounts.js";
import { ADS_API_BASE, adsAuthHeaders } from "./tiktok/adsAuth.js";

const rawParts = process.argv.slice(2).join(" ").split(/[\s\u00A0\u200B]+/).filter(Boolean);
const campaignId = rawParts[0];
const itemGroupId = rawParts[1];
const itemId = rawParts[2];

if (!campaignId || !itemGroupId || !itemId) {
  console.log("Usage: node src/test-attributes.js <campaign_id> <item_group_id> <item_id>");
  process.exit(1);
}

async function main() {
  const account = await getAccountByName("in-kano");
  if (!account) {
    console.log("Account not found.");
    return;
  }

  const res = await axios.get(`${ADS_API_BASE}/gmv_max/report/get/`, {
    headers: adsAuthHeaders(account.ads_access_token),
    params: {
      advertiser_id: account.ads_advertiser_id,
      store_ids: JSON.stringify([account.shop_id]),
      start_date: "2026-07-01",
      end_date: "2026-08-05",
      dimensions: JSON.stringify(["item_id"]),
      metrics: JSON.stringify([
        "title", "tt_account_name", "tt_account_profile_image_url",
        "tt_account_authorization_type", "shop_content_type",
      ]),
      filtering: JSON.stringify({
        campaign_ids: [campaignId],
        item_group_ids: [itemGroupId],
        creative_types: ["ADS_AND_ORGANIC"],
      }),
      page_size: 1000,
    },
  });

  console.log("Full raw response:");
  console.log(JSON.stringify(res.data, null, 2));

  const list = res.data?.data?.list || [];
  const match = list.find((r) => String(r.dimensions.item_id) === String(itemId));
  console.log(`\nMatch for item_id=${itemId}:`, match ? JSON.stringify(match, null, 2) : "NOT FOUND in this response");
}

main().catch((err) => {
  console.log("REQUEST FAILED:", JSON.stringify(err.response?.data || err.message, null, 2));
});
