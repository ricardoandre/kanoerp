import axios from "axios";
import { SHOP_API_BASE, buildSignedParams } from "./shopAuth.js";

function dateNDaysAgoMs(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getTime();
}

/**
 * Pull creator-affiliate performance for a seller's TikTok Shop: which creators
 * are promoting which products, and the resulting orders/commission/GMV.
 * Uses the Affiliate Seller API's collaboration performance endpoint.
 */
export async function fetchAffiliatePerformance({ accessToken, shopId, lookbackDays = 7 }) {
  const path = "/affiliate/202405/orders/search";
  const baseParams = {
    shop_id: shopId,
    page_size: 100,
    create_time_from: Math.floor(dateNDaysAgoMs(lookbackDays) / 1000),
    create_time_to: Math.floor(Date.now() / 1000),
  };
  const signedParams = buildSignedParams(path, baseParams);

  const res = await axios.get(`${SHOP_API_BASE}${path}`, {
    params: signedParams,
    headers: { "x-tts-access-token": accessToken },
  });

  const orders = res.data?.data?.orders || [];
  return orders.map((o) => ({
    shop_id: shopId,
    order_id: o.order_id,
    creator_id: o.creator_id,
    creator_name: o.creator_name,
    product_id: o.product_id,
    product_name: o.product_name,
    quantity: o.quantity || 0,
    gmv: Number(o.gmv_amount || 0),
    commission: Number(o.commission_amount || 0),
    order_status: o.order_status,
    created_at: o.create_time ? new Date(o.create_time * 1000).toISOString() : null,
  }));
}
