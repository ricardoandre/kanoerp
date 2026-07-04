require('dotenv').config();

const axios = require('axios');
const { fetchAdsWithCreative, extractImageUrl } = require('./lib/creatives');
const { getOne, uploadAttachment, upsert } = require('./lib/nocobase');
const { parseAccounts, filterAccountsFromArgs } = require('./lib/accounts');

// Run occasionally (weekly cron or manually after launching new ads):
//   node creatives.js
//   node creatives.js --account=Shop1
// It skips ads whose image is already stored, so re-runs are cheap and won't
// pile up duplicate files in NocoBase storage.

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

async function run() {
  const accounts = filterAccountsFromArgs(parseAccounts());
  console.log(`Fetching creatives for ${accounts.length} account(s): ${accounts.map((a) => a.label).join(', ')}`);

  let uploaded = 0;
  let skipped = 0;
  let noImage = 0;

  for (const account of accounts) {
    console.log(`\n== ${account.label} (${account.id}) ==`);
    const ads = await fetchAdsWithCreative(account.id);
    console.log(`Found ${ads.length} ads`);

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
            account: account.label,
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
  }

  console.log(`\nDone. uploaded=${uploaded} skipped=${skipped} no-image=${noImage}`);
}

run();
