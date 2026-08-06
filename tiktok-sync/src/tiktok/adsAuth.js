import axios from "axios";
import { config } from "../config.js";

const BASE = "https://business-api.tiktok.com/open_api/v1.3";

/**
 * Build the URL you send a client to, so they can authorize your app
 * against their TikTok Ads Manager account. Each client does this once.
 */
export function getAdsAuthorizationUrl(state) {
  const url = new URL("https://business-api.tiktok.com/portal/auth");
  url.searchParams.set("app_id", config.tiktokAds.appId);
  url.searchParams.set("state", state || "agency-onboarding");
  url.searchParams.set("redirect_uri", config.tiktokAds.redirectUri);
  return url.toString();
}

/**
 * Exchange the auth_code TikTok redirected back with for an access token.
 * Response also includes the list of advertiser_ids the client granted access to.
 */
export async function exchangeAdsAuthCode(authCode) {
  const res = await axios.post(`${BASE}/oauth2/access_token/`, {
    app_id: config.tiktokAds.appId,
    secret: config.tiktokAds.appSecret,
    auth_code: authCode,
  });
  const data = res.data.data;
  return {
    accessToken: data.access_token,
    advertiserIds: data.advertiser_ids,
    // TikTok's Marketing API access tokens are long-lived (no refresh flow needed
    // in the same way as user-level OAuth); re-auth if TikTok revokes access.
  };
}

export function adsAuthHeaders(accessToken) {
  return { "Access-Token": accessToken, "Content-Type": "application/json" };
}

export { BASE as ADS_API_BASE };
