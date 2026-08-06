/**
 * One-off test: calls TikTok's GMV Max Reporting API and prints the raw
 * response, so we can see the real metric field names (TikTok's Seller
 * Center display names like "Gross Revenue" / "ROI" don't necessarily
 * match the API's actual field keys) before building the full sync.
 *
 * Usage: node src/test-gmvmax-fields.js
 */
import axios from "axios";
import { getAllAccounts } from "./nocobase/accounts.js";
import { ADS_API_BASE, adsAuthHeaders } from "./tiktok/adsAuth.js";

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const accounts = await getAllAccounts();
  // Need an account with BOTH ads access (for advertiser_id) AND shop access (for store_id)
  const account = accounts.find((a) => a.ads_access_token && a.ads_advertiser_id && a.shop_id);
  if (!account) {
    console.log("No account found with both ads_access_token+ads_advertiser_id AND shop_id saved.");
    return;
  }

  const params = {
    advertiser_id: account.ads_advertiser_id,
    store_ids: JSON.stringify([account.shop_id]),
    dimensions: JSON.stringify(["item_id"]),
    metrics: JSON.stringify([
      "cost", "orders", "cost_per_order", "gross_revenue", "roi",
      "product_impressions", "product_clicks", "product_click_rate",
      "ad_click_rate", "ad_conversion_rate",
      "ad_video_view_rate_2s", "ad_video_view_rate_6s", "ad_video_view_rate_p25",
      "ad_video_view_rate_p50", "ad_video_view_rate_p75", "ad_video_view_rate_p100",
    ]),
    start_date: dateNDaysAgo(29),
    end_date: dateNDaysAgo(0),
    page_size: 20,
  };

  try {
    const res = await axios.get(`${ADS_API_BASE}/gmv_max/report/get/`, {
      headers: adsAuthHeaders(account.ads_access_token),
      params,
    });
    console.log("RAW RESPONSE:");
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.log("REQUEST FAILED:");
    console.log(JSON.stringify(err.response?.data || err.message, null, 2));
  }
}

main();
