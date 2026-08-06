import dotenv from "dotenv";
dotenv.config();

function required(name) {
  return process.env[name] || "";
}

export const config = {
  nocobase: {
    // Should include /api, e.g. https://myapp.nocobase.com/api
    baseUrl: required("NOCOBASE_BASE_URL").replace(/\/+$/, ""),
    apiToken: required("NOCOBASE_API_TOKEN"),
    collections: {
      accounts: "tiktok_account",
      ads: "tiktok_ads",
      adCreatives: "tiktok_ads_creatives",
      gmvMax: "tiktok_gmv_max",
      gmvMaxProducts: "tiktok_gmv_max_products",
      gmvMaxCreatives: "tiktok_gmv_max_creatives",
      content: "tiktok_content",
      affiliate: "tiktok_affiliate",
    },
  },
  tiktokAds: {
    appId: required("TIKTOK_ADS_APP_ID"),
    appSecret: required("TIKTOK_ADS_APP_SECRET"),
    redirectUri: required("TIKTOK_ADS_REDIRECT_URI"),
  },
  tiktokContent: {
    appId: required("TIKTOK_CONTENT_APP_ID"),
    appSecret: required("TIKTOK_CONTENT_APP_SECRET"),
    redirectUri: required("TIKTOK_CONTENT_REDIRECT_URI"),
  },
  tiktokShop: {
    appKey: required("TIKTOK_SHOP_APP_KEY"),
    appSecret: required("TIKTOK_SHOP_APP_SECRET"),
    serviceId: required("TIKTOK_SHOP_SERVICE_ID"),
    redirectUri: required("TIKTOK_SHOP_REDIRECT_URI"),
  },
  sync: {
    lookbackDays: parseInt(process.env.SYNC_LOOKBACK_DAYS || "7", 10),
  },
  port: parseInt(process.env.PORT || "3000", 10),
};
