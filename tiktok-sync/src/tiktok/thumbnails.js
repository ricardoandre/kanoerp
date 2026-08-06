import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// A hung connection with no timeout can block a long sequential loop
// forever with zero output — this script's process never imports gmvmax.js
// (which sets this elsewhere), so it needs its own timeout here.
axios.defaults.timeout = 30000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const THUMBNAIL_DIR = path.join(__dirname, "../../public/thumbnails");
fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

/**
 * Ensures a permanent local copy of this creative's thumbnail exists on
 * disk. If already cached, does nothing and returns immediately (cheap —
 * just a file-existence check). Otherwise fetches the cover image via
 * TikTok's public oEmbed API (works for any public video by numeric ID
 * alone — no ads token or account handle needed, confirmed via testing)
 * and saves it.
 *
 * Returns { cached: boolean, downloaded: boolean, reason?: string }
 */
export async function ensureThumbnailCached(itemId) {
  const clean = String(itemId || "").replace(/[\s\u00A0\u200B]+/g, "");
  if (!clean || clean === "-1") {
    return { cached: false, downloaded: false, reason: "invalid or product-card item_id" };
  }

  const localPath = path.join(THUMBNAIL_DIR, `${clean}.jpg`);
  if (fs.existsSync(localPath)) {
    return { cached: true, downloaded: false };
  }

  const videoUrl = `https://www.tiktok.com/@_/video/${clean}`;

  try {
    const oembedRes = await axios.get("https://www.tiktok.com/oembed", {
      params: { url: videoUrl },
    });
    const thumbUrl = oembedRes.data?.thumbnail_url;
    if (!thumbUrl) {
      return { cached: false, downloaded: false, reason: "no thumbnail_url in oEmbed response" };
    }

    const imageRes = await axios.get(thumbUrl, { responseType: "arraybuffer" });
    fs.writeFileSync(localPath, imageRes.data);
    return { cached: true, downloaded: true };
  } catch (err) {
    return { cached: false, downloaded: false, reason: err.response?.data?.error_description || err.message };
  }
}
