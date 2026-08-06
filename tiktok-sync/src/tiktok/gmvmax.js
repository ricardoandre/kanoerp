import axios from "axios";
import { ADS_API_BASE, adsAuthHeaders } from "./adsAuth.js";

// A hung connection with no timeout can block the whole sequential backfill
// loop forever with zero error output — this affects all axios calls
// process-wide (a good thing; nothing here should legitimately take longer).
axios.defaults.timeout = 60000;

/**
 * Fetch full campaign detail including item_list, which has each video's
 * cover image + preview URL (SHORT-LIVED — cover ~24h, preview ~6h, per
 * TikTok's docs). This is why thumbnails are fetched live at display time
 * (via the /gmvmax/thumbnail proxy route) rather than stored — a stored
 * URL would go stale within a day regardless of how recently it was synced.
 */
export async function fetchGmvMaxCampaignInfo({ accessToken, advertiserId, campaignId }) {
  const res = await axios.get(`${ADS_API_BASE}/campaign/gmv_max/info/`, {
    headers: adsAuthHeaders(accessToken),
    params: { advertiser_id: advertiserId, campaign_id: campaignId },
  });
  if (res.data?.code !== 0) {
    const err = new Error(res.data?.message || "Unknown TikTok API error");
    err.tiktokResponse = res.data;
    throw err;
  }
  return res.data?.data || null;
}

/**
 * Look up GMV-Max-eligible stores using ONLY the ads access token — this is
 * a pure Marketing API endpoint, unrelated to Partner Center/Shop OAuth.
 * Returns the first available store's id, or null if none are eligible.
 */
export async function getFirstGmvMaxStoreId({ accessToken, advertiserId }) {
  const res = await axios.get(`${ADS_API_BASE}/gmv_max/store/list/`, {
    headers: adsAuthHeaders(accessToken),
    params: { advertiser_id: advertiserId },
  });
  const stores = res.data?.data?.store_list || res.data?.data?.list || [];
  const eligible = stores.find((s) => s.is_gmv_max_available);
  return (eligible || stores[0])?.store_id || (eligible || stores[0])?.id || null;
}

/**
 * Pull campaign name/status/creation-time metadata. NOT date-scoped — always
 * returns current info. gmv_max_promotion_types is a required filter, so we
 * call once per type (Product + LIVE) and merge into one campaign_id -> info map.
 * create_time is used to know how far back a full historical backfill needs to go.
 */
export async function fetchGmvMaxCampaigns({ accessToken, advertiserId }) {
  const map = {};

  for (const promotionType of ["PRODUCT_GMV_MAX", "LIVE_GMV_MAX"]) {
    const res = await axios.get(`${ADS_API_BASE}/gmv_max/campaign/get/`, {
      headers: adsAuthHeaders(accessToken),
      params: {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({ gmv_max_promotion_types: [promotionType] }),
        page_size: 100,
      },
    });
    const list = res.data?.data?.list || [];
    for (const c of list) {
      map[c.campaign_id] = {
        campaign_name: c.campaign_name || "",
        operation_status: c.operation_status || "",
        promotion_type: promotionType,
        objective_type: c.objective_type || "",
        secondary_status: c.secondary_status || "",
        create_time: c.create_time || null,
      };
    }
  }

  return map;
}

// Server runs on UTC, but TikTok's stat_time_day is scoped to the ad
// account's own timezone (Jakarta/WIB, UTC+7, no DST). If we compute "today"
// using the server's UTC clock, we're off by up to 7 hours around midnight
// UTC (which is 7am in Jakarta) — this shifts "today" to match the ad
// account's calendar date instead. Configurable via .env since a different
// account could someday be in a different timezone.
const ADS_TIMEZONE_OFFSET_HOURS = Number(process.env.TIKTOK_ADS_TIMEZONE_OFFSET_HOURS || 7);

export function dateNDaysAgo(n) {
  const offsetMs = ADS_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000;
  const d = new Date(Date.now() + offsetMs);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Split a [start, end] date range into chunks no longer than 29 days each,
 * since TikTok caps date ranges at 30 days whenever stat_time_day is used.
 * Returns oldest-first: [{start, end}, ...]
 */
export function chunkDateRange(startDate, endDate, maxDays = 29) {
  const chunks = [];
  let chunkStart = new Date(startDate);
  const finalEnd = new Date(endDate);

  while (chunkStart <= finalEnd) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1);
    const actualEnd = chunkEnd > finalEnd ? finalEnd : chunkEnd;
    chunks.push({
      start: chunkStart.toISOString().slice(0, 10),
      end: actualEnd.toISOString().slice(0, 10),
    });
    chunkStart = new Date(actualEnd);
    chunkStart.setDate(chunkStart.getDate() + 1);
  }

  return chunks;
}

/**
 * Pull daily GMV Max campaign performance (cost, orders, gross revenue, ROI).
 * Pass explicit startDate/endDate for historical backfill (max 29-day span —
 * use chunkDateRange() for anything longer), or omit them to default to the
 * last `lookbackDays` days for routine incremental syncs.
 */
export async function fetchGmvMaxReport({ accessToken, advertiserId, storeId, lookbackDays = 7, startDate, endDate }) {
  const finalStart = startDate || dateNDaysAgo(Math.min(lookbackDays, 29));
  const finalEnd = endDate || dateNDaysAgo(0);

  const results = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await axios.get(`${ADS_API_BASE}/gmv_max/report/get/`, {
      headers: adsAuthHeaders(accessToken),
      params: {
        advertiser_id: advertiserId,
        store_ids: JSON.stringify([storeId]),
        dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
        metrics: JSON.stringify(["cost", "orders", "cost_per_order", "gross_revenue", "roi"]),
        start_date: finalStart,
        end_date: finalEnd,
        page,
        page_size: 1000,
      },
    });

    const rows = res.data?.data?.list || [];
    for (const row of rows) {
      results.push({
        campaign_id: row.dimensions.campaign_id,
        date: row.dimensions.stat_time_day.slice(0, 10),
        cost: Number(row.metrics.cost || 0),
        orders: Number(row.metrics.orders || 0),
        cost_per_order: Number(row.metrics.cost_per_order || 0),
        gross_revenue: Number(row.metrics.gross_revenue || 0),
        roi: Number(row.metrics.roi || 0),
      });
    }

    totalPages = res.data?.data?.page_info?.total_page || 1;
    page++;
  } while (page <= totalPages);

  return results;
}

/**
 * Product-level DAILY metrics for one campaign — one call returns every
 * product's numbers for every day in the range (up to 29 days), not one
 * call per product. Pass explicit startDate/endDate for backfill chunks.
 */
export async function fetchGmvMaxProducts({ accessToken, advertiserId, storeId, campaignId, lookbackDays = 29, startDate, endDate }) {
  const finalStart = startDate || dateNDaysAgo(Math.min(lookbackDays, 29));
  const finalEnd = endDate || dateNDaysAgo(0);

  const results = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await axios.get(`${ADS_API_BASE}/gmv_max/report/get/`, {
      headers: adsAuthHeaders(accessToken),
      params: {
        advertiser_id: advertiserId,
        store_ids: JSON.stringify([storeId]),
        start_date: finalStart,
        end_date: finalEnd,
        dimensions: JSON.stringify(["item_group_id", "stat_time_day"]),
        metrics: JSON.stringify([
          "product_name", "item_group_id", "product_image_url", "product_status",
          "cost", "orders", "cost_per_order", "gross_revenue", "roi",
        ]),
        filtering: JSON.stringify({ campaign_ids: [campaignId] }),
        page,
        page_size: 1000,
      },
    });

    const rows = res.data?.data?.list || [];
    for (const row of rows) {
      results.push({
        campaign_id: campaignId,
        item_group_id: row.dimensions.item_group_id,
        date: row.dimensions.stat_time_day.slice(0, 10),
        product_name: row.metrics.product_name || "",
        product_image_url: row.metrics.product_image_url || "",
        product_status: row.metrics.product_status || "",
        cost: Number(row.metrics.cost || 0),
        orders: Number(row.metrics.orders || 0),
        cost_per_order: Number(row.metrics.cost_per_order || 0),
        gross_revenue: Number(row.metrics.gross_revenue || 0),
        roi: Number(row.metrics.roi || 0),
      });
    }

    totalPages = res.data?.data?.page_info?.total_page || 1;
    page++;
  } while (page <= totalPages);

  return results;
}

/**
 * Creative-level DAILY metrics for a BATCH of products (up to 100
 * item_group_ids) within one campaign, in a single pair of calls rather
 * than one pair per product — TikTok's filter allows up to 100 IDs at once.
 *
 * Same two-call split as before (delivery+funnel data needs 3 ID dimensions
 * which reject attribute fields; attribute data needs a single ID dimension
 * instead) — but now batched across products AND broken out by day.
 * Attribute data (title/account name) doesn't need daily granularity since
 * it barely changes, so that call stays as a single lookback total.
 */
export async function fetchGmvMaxCreativesBatch({
  accessToken, advertiserId, storeId, campaignId, itemGroupIds,
  lookbackDays = 29, startDate, endDate,
}) {
  const finalStart = startDate || dateNDaysAgo(Math.min(lookbackDays, 29));
  const finalEnd = endDate || dateNDaysAgo(0);

  // --- Delivery/funnel metrics, daily, batched across up to 100 products ---
  const deliveryRows = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await axios.get(`${ADS_API_BASE}/gmv_max/report/get/`, {
      headers: adsAuthHeaders(accessToken),
      params: {
        advertiser_id: advertiserId,
        store_ids: JSON.stringify([storeId]),
        start_date: finalStart,
        end_date: finalEnd,
        dimensions: JSON.stringify(["campaign_id", "item_group_id", "item_id", "stat_time_day"]),
        metrics: JSON.stringify([
          "creative_delivery_status",
          "cost", "orders", "cost_per_order", "gross_revenue", "roi",
          "product_impressions", "product_clicks", "product_click_rate",
          "ad_click_rate", "ad_conversion_rate",
          "ad_video_view_rate_2s", "ad_video_view_rate_6s", "ad_video_view_rate_p25",
          "ad_video_view_rate_p50", "ad_video_view_rate_p75", "ad_video_view_rate_p100",
        ]),
        filtering: JSON.stringify({ campaign_ids: [campaignId], item_group_ids: itemGroupIds }),
        page,
        page_size: 1000,
      },
    });
    deliveryRows.push(...(res.data?.data?.list || []));
    totalPages = res.data?.data?.page_info?.total_page || 1;
    page++;
  } while (page <= totalPages);

  // --- Attribute metrics (title/account/shop_content_type), not date-scoped ---
  const attributeMap = {};
  let attrPage = 1;
  let attrTotalPages = 1;
  do {
    const res = await axios.get(`${ADS_API_BASE}/gmv_max/report/get/`, {
      headers: adsAuthHeaders(accessToken),
      params: {
        advertiser_id: advertiserId,
        store_ids: JSON.stringify([storeId]),
        start_date: finalStart,
        end_date: finalEnd,
        dimensions: JSON.stringify(["item_id"]),
        metrics: JSON.stringify([
          "title", "tt_account_name", "tt_account_profile_image_url",
          "tt_account_authorization_type", "shop_content_type",
        ]),
        filtering: JSON.stringify({
          campaign_ids: [campaignId],
          item_group_ids: itemGroupIds,
          creative_types: ["ADS_AND_ORGANIC"],
        }),
        page: attrPage,
        page_size: 1000,
      },
    });
    for (const row of res.data?.data?.list || []) {
      attributeMap[row.dimensions.item_id] = {
        title: row.metrics.title || "",
        tiktok_account_name: row.metrics.tt_account_name || "",
        tiktok_account_profile_image_url: row.metrics.tt_account_profile_image_url || "",
        tiktok_account_authorization_type: row.metrics.tt_account_authorization_type || "",
        shop_content_type: row.metrics.shop_content_type || "",
      };
    }
    attrTotalPages = res.data?.data?.page_info?.total_page || 1;
    attrPage++;
  } while (attrPage <= attrTotalPages);

  return deliveryRows.map((row) => {
    const itemId = row.dimensions.item_id;
    const attrs = attributeMap[itemId] || {};
    return {
      campaign_id: campaignId,
      item_group_id: row.dimensions.item_group_id,
      item_id: itemId,
      date: row.dimensions.stat_time_day.slice(0, 10),
      title: attrs.title || "",
      tiktok_account_name: attrs.tiktok_account_name || "",
      tiktok_account_profile_image_url: attrs.tiktok_account_profile_image_url || "",
      tiktok_account_authorization_type: attrs.tiktok_account_authorization_type || "",
      shop_content_type: attrs.shop_content_type || "",
      creative_delivery_status: row.metrics.creative_delivery_status || "",
      cost: Number(row.metrics.cost || 0),
      orders: Number(row.metrics.orders || 0),
      cost_per_order: Number(row.metrics.cost_per_order || 0),
      gross_revenue: Number(row.metrics.gross_revenue || 0),
      roi: Number(row.metrics.roi || 0),
      product_impressions: Number(row.metrics.product_impressions || 0),
      product_clicks: Number(row.metrics.product_clicks || 0),
      product_click_rate: Number(row.metrics.product_click_rate || 0),
      ad_click_rate: Number(row.metrics.ad_click_rate || 0),
      ad_conversion_rate: Number(row.metrics.ad_conversion_rate || 0),
      ad_video_view_rate_2s: Number(row.metrics.ad_video_view_rate_2s || 0),
      ad_video_view_rate_6s: Number(row.metrics.ad_video_view_rate_6s || 0),
      ad_video_view_rate_p25: Number(row.metrics.ad_video_view_rate_p25 || 0),
      ad_video_view_rate_p50: Number(row.metrics.ad_video_view_rate_p50 || 0),
      ad_video_view_rate_p75: Number(row.metrics.ad_video_view_rate_p75 || 0),
      ad_video_view_rate_p100: Number(row.metrics.ad_video_view_rate_p100 || 0),
    };
  });
}

/** Split an array into chunks of at most `size` items each. */
export function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
