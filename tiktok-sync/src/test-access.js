/**
 * Run this after you've configured .env and connected your account via the
 * auth-server, to confirm every piece of access actually works before running
 * the full sync. Prints a clear pass/fail for each connection.
 *
 * Usage: node src/test-access.js
 */
import axios from "axios";
import { config } from "./config.js";
import { getAllAccounts } from "./nocobase/accounts.js";
import { ADS_API_BASE, adsAuthHeaders } from "./tiktok/adsAuth.js";
import { CONTENT_API_BASE } from "./tiktok/contentAuth.js";
import { SHOP_API_BASE, buildSignedParams } from "./tiktok/shopAuth.js";

const results = [];

function log(name, ok, detail) {
  results.push({ name, ok, detail });
  const icon = ok ? "PASS" : "FAIL";
  console.log(`[${icon}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function testNocoBase() {
  try {
    if (!config.nocobase.baseUrl || !config.nocobase.apiToken) {
      return log("NocoBase connection", false, "Missing NOCOBASE_BASE_URL or NOCOBASE_API_TOKEN in .env");
    }
    const accounts = await getAllAccounts();
    log("NocoBase connection", true, `Reached tiktok_account collection, found ${accounts.length} row(s)`);
    return accounts;
  } catch (err) {
    log("NocoBase connection", false, err.response?.data?.errors?.[0]?.message || err.message);
    return [];
  }
}

async function testAdsAccess(account) {
  const label = `TikTok Ads API (${account.name})`;
  if (!account.ads_access_token || !account.ads_advertiser_id) {
    return log(label, false, "No ads_access_token / ads_advertiser_id saved yet — run the ads OAuth flow");
  }
  try {
    const res = await axios.get(`${ADS_API_BASE}/advertiser/info/`, {
      headers: adsAuthHeaders(account.ads_access_token),
      params: { advertiser_ids: JSON.stringify([account.ads_advertiser_id]) },
    });
    if (res.data.code !== 0) {
      return log(label, false, res.data.message);
    }
    const info = res.data.data?.list?.[0];
    log(label, true, `Connected to advertiser "${info?.name || account.ads_advertiser_id}"`);
  } catch (err) {
    log(label, false, err.response?.data?.message || err.message);
  }
}

async function testContentAccess(account) {
  const label = `TikTok Content API (${account.name})`;
  if (!account.content_access_token) {
    return log(label, false, "No content_access_token saved yet — run the content OAuth flow");
  }
  try {
    const res = await axios.get(`${CONTENT_API_BASE}/user/info/`, {
      headers: { Authorization: `Bearer ${account.content_access_token}` },
      params: { fields: "open_id,display_name,follower_count" },
    });
    if (res.data.error?.code !== "ok") {
      return log(label, false, res.data.error?.message);
    }
    const u = res.data.data.user;
    log(label, true, `Connected as "${u.display_name}" (${u.follower_count} followers)`);
  } catch (err) {
    log(label, false, err.response?.data?.error?.message || err.message);
  }
}

async function testShopAccess(account) {
  const label = `TikTok Shop API (${account.name})`;
  if (!account.shop_access_token || !account.shop_id) {
    return log(label, false, "No shop_access_token / shop_id saved yet — run the shop OAuth flow");
  }
  try {
    const path = "/authorization/202309/shops";
    const params = buildSignedParams(path, {});
    const res = await axios.get(`${SHOP_API_BASE}${path}`, {
      params,
      headers: { "x-tts-access-token": account.shop_access_token },
    });
    if (res.data.code !== 0) {
      return log(label, false, res.data.message);
    }
    const shops = res.data.data?.shops || [];
    const names = shops.map((s) => s.name).join(", ") || "none returned";
    log(label, true, `Authorized shop(s): ${names}`);
  } catch (err) {
    log(label, false, err.response?.data?.message || err.message);
  }
}

async function main() {
  console.log("Checking access...\n");

  const accounts = await testNocoBase();

  if (accounts.length === 0) {
    console.log("\nNo rows found in tiktok_account — add at least one row first.");
    process.exit(1);
  }

  for (const account of accounts) {
    await testAdsAccess(account);
    await testContentAccess(account);
    await testShopAccess(account);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) {
    console.log("Fix the FAIL items above before running `npm run sync`.");
    process.exit(1);
  }
}

main();
