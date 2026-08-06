import axios from "axios";
import { ADS_API_BASE, adsAuthHeaders } from "./adsAuth.js";

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Pull ad-level performance for one advertiser account over a date range.
 * Returns a flat array ready to write into NocoDB.
 */
export async function fetchAdPerformance({ accessToken, advertiserId, lookbackDays = 7 }) {
  const startDate = dateNDaysAgo(lookbackDays);
  const endDate = dateNDaysAgo(0);

  const params = {
    advertiser_id: advertiserId,
    report_type: "BASIC",
    data_level: "AUCTION_AD",
    dimensions: JSON.stringify(["ad_id", "stat_time_day"]),
    metrics: JSON.stringify([
      "campaign_name",
      "adgroup_name",
      "ad_name",
      "impressions",
      "clicks",
      "spend",
      "conversion",
      "ctr",
      "cpc",
      "cpm",
    ]),
    start_date: startDate,
    end_date: endDate,
    page_size: 1000,
  };

  const res = await axios.get(`${ADS_API_BASE}/report/integrated/get/`, {
    headers: adsAuthHeaders(accessToken),
    params,
  });

  const rows = res.data?.data?.list || [];
  return rows.map((row) => ({
    advertiser_id: advertiserId,
    date: row.dimensions.stat_time_day,
    ad_id: row.dimensions.ad_id,
    campaign_name: row.metrics.campaign_name,
    adgroup_name: row.metrics.adgroup_name,
    ad_name: row.metrics.ad_name,
    impressions: Number(row.metrics.impressions || 0),
    clicks: Number(row.metrics.clicks || 0),
    spend: Number(row.metrics.spend || 0),
    conversions: Number(row.metrics.conversion || 0),
    ctr: Number(row.metrics.ctr || 0),
    cpc: Number(row.metrics.cpc || 0),
    cpm: Number(row.metrics.cpm || 0),
  }));
}
