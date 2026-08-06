import axios from "axios";
import crypto from "crypto";
import { config } from "../config.js";

const AUTH_BASE = "https://services.tiktokshop.com/open/authorize";
const TOKEN_URL = "https://auth.tiktok-shops.com/api/v2/token/get";
const API_BASE = "https://open-api.tiktokglobalshop.com";

export function getShopAuthorizationUrl(state) {
  const url = new URL(AUTH_BASE);
  url.searchParams.set("service_id", config.tiktokShop.serviceId);
  //url.searchParams.set("service_id", config.tiktokShop.appKey);
  url.searchParams.set("state", state || "agency-onboarding");
  return url.toString();
}

export async function exchangeShopAuthCode(authCode) {
  const res = await axios.get(TOKEN_URL, {
    params: {
      app_key: config.tiktokShop.appKey,
      app_secret: config.tiktokShop.appSecret,
      auth_code: authCode,
      grant_type: "authorized_code",
    },
  });
  const data = res.data.data;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    shopId: data.seller_id || data.shop_id,
    expiresIn: data.access_token_expire_in,
  };
}

export async function refreshShopToken(refreshToken) {
  const res = await axios.get(TOKEN_URL, {
    params: {
      app_key: config.tiktokShop.appKey,
      app_secret: config.tiktokShop.appSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
  });
  return res.data.data;
}

export async function getFirstAuthorizedShopId(accessToken) {
  const path = "/authorization/202309/shops";
  const params = buildSignedParams(path, {});
  const res = await axios.get(`${API_BASE}${path}`, {
    params,
    headers: { "x-tts-access-token": accessToken },
  });
  const shops = res.data?.data?.shops || [];
  return shops[0]?.id || shops[0]?.shop_id || null;
}

/**
 * TikTok Shop signs every API call (beyond the OAuth token exchange itself).
 * Algorithm: sort all query params (excluding sign/access_token/files) alphabetically,
 * concatenate key+value pairs, wrap with path and app_secret, then HMAC-SHA256.
 * Docs: https://partner.tiktokshop.com/docv2/page/signature
 */
export function signRequest(path, params) {
  const sorted = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort();

  let base = path;
  for (const key of sorted) {
    base += `${key}${params[key]}`;
  }
  base = config.tiktokShop.appSecret + base + config.tiktokShop.appSecret;

  return crypto.createHmac("sha256", config.tiktokShop.appSecret).update(base).digest("hex");
}

export function buildSignedParams(path, baseParams) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    app_key: config.tiktokShop.appKey,
    timestamp,
    ...baseParams,
  };
  const sign = signRequest(path, params);
  return { ...params, sign };
}

export { API_BASE as SHOP_API_BASE };
