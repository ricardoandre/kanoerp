const axios = require('axios');
const ig = require('./instagram');
const { upsert, uploadAttachment, getOne } = require('./nocobase');

// >>> COST NOTE, read before running this at scale: unlike the earlier
// cover-only version, this downloads and re-uploads the ACTUAL VIDEO FILE
// for every Reel/video post and every video slide in a carousel — not just
// a thumbnail. Video files run tens of MB each. Across thousands of posts
// this is a real amount of bandwidth and disk space on your NocoBase
// server, and will run noticeably slower than the old cover-only backfill.
// That's the deliberate tradeoff for a genuine "survives Instagram deleting
// it" archive rather than just a browsing thumbnail.

function extFromContentType(contentType, fallback) {
  if (!contentType) return fallback;
  if (contentType.includes('mp4')) return 'mp4';
  if (contentType.includes('quicktime')) return 'mov';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  return fallback;
}

async function downloadAndUpload({ url, filenameBase, attachmentField, fallbackExt }) {
  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  const buffer = Buffer.from(resp.data);
  const contentType = resp.headers['content-type'] || (fallbackExt === 'mp4' ? 'video/mp4' : 'image/jpeg');
  const ext = extFromContentType(contentType, fallbackExt);
  const filename = `${filenameBase}.${ext}`;
  const attachment = await uploadAttachment(buffer, filename, contentType, attachmentField);
  return attachment;
}

// ---------------------------------------------------------------------
// Builds the list of every downloadable file for one media/story object.
// - IMAGE: just the image.
// - VIDEO / REELS: the full video file, PLUS the thumbnail as a separate
//   file (so you still get a fast-loading cover image without opening the
//   video, while also keeping the actual video archived).
// - Each item tagged with a `kind` (image/video/thumbnail) and `index`
//   (for multi-slide carousels) so filenames stay unique and identifiable.
// ---------------------------------------------------------------------
function buildTargets({ mediaType, mediaUrl, thumbnailUrl }) {
  const targets = [];
  if (mediaType === 'VIDEO') {
    if (mediaUrl) targets.push({ url: mediaUrl, kind: 'video', fallbackExt: 'mp4' });
    if (thumbnailUrl) targets.push({ url: thumbnailUrl, kind: 'thumbnail', fallbackExt: 'jpg' });
  } else if (mediaUrl) {
    // IMAGE (or anything else with a plain media_url)
    targets.push({ url: mediaUrl, kind: 'image', fallbackExt: 'jpg' });
  }
  return targets;
}

// ---------------------------------------------------------------------
// MEDIA (feed posts + Reels + carousel albums)
//
// Self-guarding: skips entirely if this media already has at least one
// linked attachment, so it's safe to call unconditionally from the daily
// sync without re-downloading/re-uploading everything on every run.
// ---------------------------------------------------------------------
async function archiveMediaFiles({ mediaId, mediaType, mediaProductType, mediaUrl, thumbnailUrl }) {
  const existing = await getOne('ig_media', { media_id: mediaId }, ['media_images']);
  if (existing && Array.isArray(existing.media_images) && existing.media_images.length > 0) {
    return { uploaded: 0, skipped: true };
  }

  let targets = [];
  let resolvedCoverUrl = null;

  if (mediaType === 'CAROUSEL_ALBUM') {
    const children = await ig.fetchAlbumChildren({ mediaId });
    children.forEach((child, idx) => {
      const childTargets = buildTargets({
        mediaType: child.media_type,
        mediaUrl: child.media_url,
        thumbnailUrl: child.thumbnail_url,
      });
      childTargets.forEach((t) => targets.push({ ...t, index: idx + 1 }));
    });
    // Backfill ig_media.media_url (column is null for album parents by
    // design) with the first slide's URL, for quick reference/preview.
    const firstImage = children.find((c) => c.media_url);
    if (firstImage) resolvedCoverUrl = firstImage.media_url;
  } else {
    buildTargets({ mediaType, mediaUrl, thumbnailUrl }).forEach((t) => targets.push({ ...t, index: 1 }));
  }

  if (!targets.length) return { uploaded: 0, skipped: false };

  const attachmentIds = [];
  for (const t of targets) {
    try {
      const filenameBase = `ig_${mediaId}_${t.kind}${t.index > 1 || targets.length > 1 ? t.index : ''}`;
      const attachment = await downloadAndUpload({
        url: t.url,
        filenameBase,
        attachmentField: 'media_images',
        fallbackExt: t.fallbackExt,
      });
      attachmentIds.push({ id: attachment.id });
    } catch (e) {
      console.error(`    media ${mediaId} ${t.kind}${t.index} download/upload failed: ${e.message}`);
    }
  }

  if (!attachmentIds.length) return { uploaded: 0, skipped: false };

  const updateRow = { media_id: mediaId, media_images: attachmentIds };
  if (resolvedCoverUrl) updateRow.media_url = resolvedCoverUrl;
  await upsert('ig_media', updateRow, ['media_id']);

  return { uploaded: attachmentIds.length, skipped: false };
}

// ---------------------------------------------------------------------
// STORIES — time-critical: a story that expires before this runs is gone
// for good, there is no backfill possible. Call this immediately when
// sync-stories.js detects an active story, not on a lazy/deferred pass.
//
// >>> REQUIRES SCHEMA ADDITIONS to ig_stories before this will work:
//   - media_type: string (input)
//   - story_images: belongsToMany (attachment) — same pattern as
//     ig_media.media_images (target=attachments, through a junction table
//     NocoBase creates for you when you add the field)
// Add those two fields in NocoBase first, then this will start working —
// it'll throw a clear "upsert failed" error pointing at story_images if
// the field doesn't exist yet.
// ---------------------------------------------------------------------
async function archiveStoryFiles({ storyId, mediaType, mediaUrl, thumbnailUrl }) {
  const existing = await getOne('ig_stories', { story_id: storyId }, ['story_images']);
  if (existing && Array.isArray(existing.story_images) && existing.story_images.length > 0) {
    return { uploaded: 0, skipped: true };
  }

  const targets = buildTargets({ mediaType, mediaUrl, thumbnailUrl });
  if (!targets.length) return { uploaded: 0, skipped: false };

  const attachmentIds = [];
  for (const t of targets) {
    try {
      const filenameBase = `story_${storyId}_${t.kind}`;
      const attachment = await downloadAndUpload({
        url: t.url,
        filenameBase,
        attachmentField: 'story_images',
        fallbackExt: t.fallbackExt,
      });
      attachmentIds.push({ id: attachment.id });
    } catch (e) {
      console.error(`    story ${storyId} ${t.kind} download/upload failed: ${e.message}`);
    }
  }

  if (!attachmentIds.length) return { uploaded: 0, skipped: false };

  await upsert(
    'ig_stories',
    { story_id: storyId, media_type: mediaType, story_images: attachmentIds },
    ['story_id']
  );

  return { uploaded: attachmentIds.length, skipped: false };
}

module.exports = { archiveMediaFiles, archiveStoryFiles };
