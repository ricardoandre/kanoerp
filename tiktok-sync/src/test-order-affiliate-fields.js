/**
 * One-off test: pulls recent orders using the existing seller app's
 * Order Information scope, and prints the raw response so we can check
 * whether affiliate/creator/commission fields are already included
 * (which would mean we don't need a separate Affiliate Partner app).
 *
 * Usage: node src/test-order-affiliate-fields.js
 */
import axios from "axios";
import { config } from "./config.js";
import { getAllAccounts } from "./nocobase/accounts.js";
import { SHOP_API_BASE, buildSignedParams } from "./tiktok/shopAuth.js";

async function main() {
  const accounts = await getAllAccounts();
  const account = accounts.find((a) => a.shop_access_token && a.shop_id);
  if (!account) {
    console.log("No account with a saved shop_access_token found.");
    return;
  }

  const path = "/order/202309/orders/search";
  const baseParams = {
    shop_id: account.shop_id,
    page_size: 10,
    // last 90 days, wide enough to catch the affiliate order
    create_time_from: Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60,
    create_time_to: Math.floor(Date.now() / 1000),
  };
  const signedParams = buildSignedParams(path, baseParams);

  try {
    const res = await axios.post(
      `${SHOP_API_BASE}${path}`,
      {}, // empty body, order search commonly takes filters via query
      {
        params: signedParams,
        headers: {
          "x-tts-access-token": account.shop_access_token,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("RAW RESPONSE:");
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.log("REQUEST FAILED:");
    console.log(JSON.stringify(err.response?.data || err.message, null, 2));
  }
}

main();
