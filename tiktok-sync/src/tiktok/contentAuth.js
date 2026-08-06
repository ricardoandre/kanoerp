import axios from "axios";
import { config } from "../config.js";

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const API_BASE = "https://open.tiktokapis.com/v2";

/**
 * Content/organic data uses TikTok's Login Kit v2 OAuth (different app + flow
 * from the Marketing API). Scopes needed: user.info.basic, video.list
 */
export function getContentAuthorizationUrl(state) {
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", config.tiktokContent.appId);
  url.searchParams.set("scope", "user.info.basic,video.list");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.tiktokContent.redirectUri);
  url.searchParams.set("state", state || "agency-onboarding");
  return url.toString();
}

export async function exchangeContentAuthCode(authCode) {
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      client_key: config.tiktokContent.appId,
      client_secret: config.tiktokContent.appSecret,
      code: authCode,
      grant_type: "authorization_code",
      redirect_uri: config.tiktokContent.redirectUri,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const data = res.data;
  console.log("DEBUG raw TikTok content token response:", JSON.stringify(data));
  
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    openId: data.open_id,
    expiresIn: data.expires_in,
  };
}

export async function refreshContentToken(refreshToken) {
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      client_key: config.tiktokContent.appId,
      client_secret: config.tiktokContent.appSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return res.data;
}

export { API_BASE as CONTENT_API_BASE };
