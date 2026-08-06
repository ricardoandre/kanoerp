import axios from "axios";
import { ADS_API_BASE, adsAuthHeaders } from "./adsAuth.js";

/**
 * Pull creative-level detail for ads (video/image assets, ad copy, CTA,
 * landing page) — separate from performance reporting, which only has IDs
 * and metrics, not the actual creative content.
 */
export async function fetchAdCreatives({ accessToken, advertiserId, adIds }) {
  const params = {
    advertiser_id: advertiserId,
    page_size: 100,
  };
  if (adIds && adIds.length > 0) {
    params.filtering = JSON.stringify({ ad_ids: adIds });
  }

  const res = await axios.get(`${ADS_API_BASE}/ad/get/`, {
    headers: adsAuthHeaders(accessToken),
    params,
  });

  const rows = res.data?.data?.list || [];
  return rows.map((ad) => {
    let createTime = null;
    if (ad.create_time) {
      const parsed = new Date(
        // TikTok sometimes returns unix seconds as a number/string, sometimes an ISO string
        typeof ad.create_time === "number" || /^\d+$/.test(ad.create_time)
          ? Number(ad.create_time) * 1000
          : ad.create_time
      );
      if (!isNaN(parsed.getTime())) {
        createTime = parsed.toISOString();
      }
    }
    return {
      advertiser_id: advertiserId,
      ad_id: ad.ad_id,
      ad_name: ad.ad_name,
      ad_text: ad.ad_text || "",
      call_to_action: ad.call_to_action || "",
      landing_page_url: ad.landing_page_url || "",
      video_id: ad.video_id || "",
      image_ids: Array.isArray(ad.image_ids) ? ad.image_ids.join(",") : "",
      thumbnail_url: ad.image_url || ad.video_cover_url || "",
      ad_format: ad.ad_format || "",
      create_time: createTime,
    };
  });
}
