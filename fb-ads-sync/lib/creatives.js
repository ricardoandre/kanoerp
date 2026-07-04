const axios = require('axios');

const API_VERSION = process.env.FB_API_VERSION || 'v23.0';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1000;
const MIN_LIMIT = 5;
const STARTING_LIMIT = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err) {
  return err.response?.data?.error?.message || err.message || '';
}

// "Please reduce the amount of data you're asking for" means the response
// (usually the nested creative{asset_feed_spec,...} expansion) is too large
// for the page size requested. Retrying with the same limit just fails again
// forever — the fix is to shrink the page size, not to wait and repeat.
function isReduceDataError(err) {
  return /reduce the amount of data/i.test(errorMessage(err));
}

// "There have been too many calls to this ad-account" (code 17) is an
// account-level sliding-window throttle, not a one-off blip. It typically
// needs minutes to clear — short exponential backoff (1-8s) just wastes
// calls and time before failing anyway. Fail fast instead so the caller can
// move on to the next account and this one can be re-run later.
function isAccountRateLimited(err) {
  const fbCode = err.response?.data?.error?.code;
  return fbCode === 17 || /too many calls to this ad-account/i.test(errorMessage(err));
}

// FB 5xx and error codes 1 (unknown) / 2 (temporary) are transient — safe to
// retry as-is. Codes 4/32/613 are app/user-level rate limiting and also
// benefit from backoff. Network-level failures (ECONNRESET etc., no response
// at all) are retried too. Anything else (bad token, invalid params, or the
// account-level throttle above) fails fast on purpose.
function isRetryable(err) {
  const status = err.response?.status;
  const fbCode = err.response?.data?.error?.code;
  if (isAccountRateLimited(err)) return false;
  if (status >= 500) return true;
  if ([1, 2, 4, 32, 613].includes(fbCode)) return true;
  if (!err.response && err.code) return true;
  return false;
}

// Fetches one page, transparently shrinking `params.limit` (in place) and
// retrying if FB complains the page is too large, and backing off/retrying
// on ordinary transient errors. Throws immediately on account-level rate
// limiting (no point retrying), and throws after MAX_RETRIES otherwise.
async function getWithRetry(url, params) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await axios.get(url, params ? { params } : undefined);
    } catch (err) {
      attempt++;

      if (isReduceDataError(err) && params?.limit > MIN_LIMIT) {
        const newLimit = Math.max(MIN_LIMIT, Math.floor(params.limit / 2));
        console.warn(`  page too large at limit=${params.limit}, shrinking to limit=${newLimit}`);
        params.limit = newLimit;
        await sleep(300);
        continue; // don't burn a retry attempt on this — it's not transient, it's a resize
      }

      if (isAccountRateLimited(err)) {
        console.warn('  ad-account rate limit hit — skipping this account, no point retrying quickly');
        throw err;
      }

      if (attempt > MAX_RETRIES || !isRetryable(err)) throw err;

      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      console.warn(`  retry ${attempt}/${MAX_RETRIES} after "${errorMessage(err)}" (waiting ${delay}ms)`);
      await sleep(delay);
    }

  }
}

// Pull every ad in the given account together with its creative. Creatives
// rarely change, so this is meant to run occasionally (weekly / after new
// launches), NOT on the daily insights cron.
//
// Pagination is done manually via the `after` cursor (rather than following
// paging.next directly) so that once the page size is shrunk for a heavy
// account, it stays shrunk for the rest of that account's pages instead of
// bouncing back to the default and re-triggering the same error.
async function fetchAdsWithCreative(accountId) {
  if (!accountId) throw new Error('fetchAdsWithCreative requires an accountId (e.g. act_123)');

  const url = `https://graph.facebook.com/${API_VERSION}/${accountId}/ads`;
  const fields = 'id,name,creative{id,name,image_url,thumbnail_url,object_story_spec,asset_feed_spec}';

  const ads = [];
  const params = {
    access_token: ACCESS_TOKEN,
    fields,
    limit: STARTING_LIMIT,
  };

  let after;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (after) params.after = after;

    const resp = await getWithRetry(url, params); // may mutate params.limit
    const { data, paging } = resp.data;
    if (Array.isArray(data)) ads.push(...data);

    after = paging?.cursors?.after;
    if (!after || !data || !data.length) break;
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
