const axios = require('axios');

const API_VERSION = process.env.FB_API_VERSION || 'v23.0';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
// AD_ACCOUNT_ID is gone from here too — accountId is now passed in per-call
// by creatives.js, which loops over accounts.parseAccounts(). See lib/accounts.js.

// Pull every ad in ONE account together with its creative. Creatives rarely
// change, so this is meant to run occasionally (weekly / after new launches),
// NOT on the daily insights cron.
async function fetchAdsWithCreative(accountId) {
  if (!accountId) throw new Error('fetchAdsWithCreative: accountId is required');
  const baseUrl = `https://graph.facebook.com/${API_VERSION}/${accountId}/ads`;
  const params = {
    access_token: ACCESS_TOKEN,
    fields: 'id,name,creative{id,name,image_url,thumbnail_url,object_story_spec,asset_feed_spec}',
    limit: 100,
  };

  const ads = [];
  let url = baseUrl;
  let reqParams = params;

  while (url) {
    const resp = await axios.get(url, { params: reqParams });
    const { data, paging } = resp.data;
    if (Array.isArray(data)) ads.push(...data);
    url = paging && paging.next ? paging.next : null;
    reqParams = undefined;
  }

  return ads;
}

// Best-effort image URL extraction across ad types (single image, link, video,
// carousel, Advantage+). Returns a direct URL or null. thumbnail_url is the
// low-res last resort that almost every ad has.
function extractImageUrl(creative) {
  if (!creative) return null;
  const oss = creative.object_story_spec || {};
  const feed = creative.asset_feed_spec || {};
  return (
    creative.image_url ||
    oss.link_data?.picture ||
    oss.video_data?.image_url ||
    oss.link_data?.child_attachments?.[0]?.picture ||
    feed.images?.[0]?.url ||
    creative.thumbnail_url ||
    null
  );
}

module.exports = { fetchAdsWithCreative, extractImageUrl };
