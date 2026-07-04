require('dotenv').config({quiet:true});

const axios = require('axios');
const { fetchAdsWithCreative, extractImageUrl } = require('./lib/creatives');
const { parseAccounts, filterAccountsFromArgs } = require('./lib/accounts');
const { getOne, uploadAttachment, upsert } = require('./lib/nocobase');

// Run occasionally (weekly cron or manually after launching new ads):
//   node creatives.js --account=ASKALABEL_WEB,INKANO_SHOPEE
//   node creatives.js                    (runs every account in AD_ACCOUNTS)
// It skips ads whose image is already stored, so re-runs are cheap and won't
// pile up duplicate files in NocoBase storage.
//
// Accounts come from lib/accounts.js (same source backfill.js uses):
//   AD_ACCOUNTS=ASKALABEL_SHOPEE:act_xxx,ASKALABEL_WEB:act_xxx,INKANO_SHOPEE:act_xxx

const COLLECTION = 'ads_creative';
const FIELD = 'image';
const ATTACHMENT_FIELD = `${COLLECTION}.${FIELD}`;

function extFromMime(mimetype) {
  if (!mimetype) return '.jpg';
  if (mimetype.includes('png')) return '.png';
  if (mimetype.includes('webp')) return '.webp';
  if (mimetype.includes('gif')) return '.gif';
  return '.jpg';
}

async function syncAccount(label, accountId) {
  console.log(`\n=== ${label} (${accountId}) ===`);
  const ads = await fetchAdsWithCreative(accountId);
  console.log(`Found ${ads.length} ads`);

  let uploaded = 0;
  let skipped = 0;
  let noImage = 0;

  for (const ad of ads) {
    const adId = ad.id;
    try {
      // Skip if this ad already has an image stored
      const existing = await getOne(COLLECTION, { ad_id: adId }, ['image']);
      if (existing && Array.isArray(existing.image) && existing.image.length) {
        skipped++;
        continue;
      }

      const imgUrl = extractImageUrl(ad.creative);
      if (!imgUrl) {
        noImage++;
        continue;
      }

      // Download bytes from Facebook's CDN
      const dl = await axios.get(imgUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(dl.data);
      const mimetype = dl.headers['content-type'] || 'image/jpeg';
      const filename = `${adId}${extFromMime(mimetype)}`;

      // Upload into NocoBase storage, then link the attachment to the row
      const att = await uploadAttachment(buffer, filename, mimetype, ATTACHMENT_FIELD);

      await upsert(
        COLLECTION,
        {
          ad_id: adId,
          ad_name: ad.name,
          creative_id: ad.creative?.id || null,
          source_url: imgUrl,
          image: [{ id: att.id }],
        },
        ['ad_id']
      );

      uploaded++;
      console.log(`  + ${adId} ${ad.name || ''}`);
    } catch (e) {
      const msg =
        e.response?.data?.error?.message ||
        e.response?.data?.errors?.[0]?.message ||
        e.message;
      console.error(`  x ${adId}: ${msg}`);
    }
  }

  console.log(`Done (${label}). uploaded=${uploaded} skipped=${skipped} no-image=${noImage}`);
  return { label, uploaded, skipped, noImage };
}

async function run() {
  const accounts = filterAccountsFromArgs(parseAccounts());
  const results = [];

  for (const { label, id } of accounts) {
    try {
      results.push(await syncAccount(label, id));
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.message;
      console.error(`\n=== ${label} FAILED: ${msg} ===`);
      results.push({ label, error: msg });
    }
  }

  console.log('\nSummary:');
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.label}: FAILED (${r.error})`);
    } else {
      console.log(
        `  ${r.label}: uploaded=${r.uploaded} skipped=${r.skipped} no-image=${r.noImage}`
      );
    }
  }

  if (results.some((r) => r.error)) process.exitCode = 1;
}

run();
