import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { getAdsAuthorizationUrl, exchangeAdsAuthCode } from "./tiktok/adsAuth.js";
import { getContentAuthorizationUrl, exchangeContentAuthCode } from "./tiktok/contentAuth.js";
import { ensureThumbnailCached, THUMBNAIL_DIR } from "./tiktok/thumbnails.js";
import { getShopAuthorizationUrl, exchangeShopAuthCode, getFirstAuthorizedShopId } from "./tiktok/shopAuth.js";
import { saveAdsTokens, saveContentTokens, saveShopTokens, getAccountByName } from "./nocobase/accounts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use("/thumbnails", express.static(THUMBNAIL_DIR, { maxAge: "365d", immutable: true }));

// Serve legal pages required for TikTok app review, e.g.
// https://tiktoksync.kano.id/terms and https://tiktoksync.kano.id/privacy
app.get("/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/terms.html"));
});
app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/privacy.html"));
});

function toDateOnly(isoString) {
  return isoString ? isoString.slice(0, 10) : null;
}

// --- Step 1: kick off authorization using the account's `name` field, e.g.
// /oauth/shop/start?name=in-kano
// The server looks up that row, resolves its real id, and uses the id as
// TikTok's `state` param so the callback knows which row to write into. ---

app.get("/oauth/ads/start", async (req, res) => {
  const account = await getAccountByName(req.query.name);
  if (!account) return res.status(404).send(`No tiktok_account row found with name "${req.query.name}"`);
  res.redirect(getAdsAuthorizationUrl(account.id));
});

app.get("/oauth/content/start", async (req, res) => {
  const account = await getAccountByName(req.query.name);
  if (!account) return res.status(404).send(`No tiktok_account row found with name "${req.query.name}"`);
  res.redirect(getContentAuthorizationUrl(account.id));
});

app.get("/oauth/shop/start", async (req, res) => {
  const account = await getAccountByName(req.query.name);
  if (!account) return res.status(404).send(`No tiktok_account row found with name "${req.query.name}"`);
  res.redirect(getShopAuthorizationUrl(account.id));
});

// --- Step 2: TikTok redirects back here after approval ---

app.get("/oauth/ads/callback", async (req, res) => {
  try {
    const { auth_code, state } = req.query;
    const accountId = state;
    const { accessToken, advertiserIds } = await exchangeAdsAuthCode(auth_code);
    await saveAdsTokens(accountId, {
      accessToken,
      advertiserId: advertiserIds?.[0],
      expiresAt: null,
    });
    res.send(`Ads account connected. Advertiser IDs: ${advertiserIds?.join(", ")}. You can close this tab.`);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Failed to connect ads account. Check server logs.");
  }
});

app.get("/oauth/content/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const accountId = state;
    const { accessToken, refreshToken, openId, expiresIn } = await exchangeContentAuthCode(code);
    await saveContentTokens(accountId, {
      accessToken,
      refreshToken,
      openId,
      expiresAt: toDateOnly(new Date(Date.now() + expiresIn * 1000).toISOString()),
    });
    res.send("Content/organic account connected. You can close this tab.");
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Failed to connect content account. Check server logs.");
  }
});

app.get("/oauth/shop/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const accountId = state;
    const { accessToken, refreshToken, shopId: exchangeShopId, expiresIn } = await exchangeShopAuthCode(code);

    let realShopId = exchangeShopId;
    if (!realShopId) {
      try {
        realShopId = await getFirstAuthorizedShopId(accessToken);
      } catch (lookupErr) {
        console.error(
          "Shop ID lookup failed (likely a pending scope/permission review) — saving tokens anyway:",
          lookupErr.response?.data || lookupErr.message
        );
      }
    }

    await saveShopTokens(accountId, {
      accessToken,
      refreshToken,
      shopId: realShopId,
      expiresAt: toDateOnly(new Date(Date.now() + expiresIn * 1000).toISOString()),
    });

    if (realShopId) {
      res.send("TikTok Shop / affiliate account connected. You can close this tab.");
    } else {
      res.send(
        "Tokens saved, but the shop ID couldn't be looked up yet (likely a pending permission review). " +
        "Once approved, re-run this same link, or manually set the shop_id field in NocoBase."
      );
    }
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Failed to connect shop account. Check server logs.");
  }
});

// --- Thumbnail proxy, via TikTok's PUBLIC oEmbed API, cached permanently to disk ---
// The GMV Max campaign-info endpoint's item_list is only populated for
// manually-curated (CUSTOM_SELECTION) videos — most campaigns use
// AUTO_SELECTION, where item_list is always empty (confirmed via direct
// testing), making that endpoint useless for thumbnails in practice.
// oEmbed is public, needs no ads token, and works for ANY public TikTok
// video by URL regardless of campaign type. The first request for a given
// item_id downloads and saves the actual image to disk — every request
// after that (even after a video is deleted or its cover URL expires)
// serves our own permanent local copy instead of hitting TikTok again.

app.get("/gmvmax/thumbnail", async (req, res) => {
  try {
    let { item_id } = req.query;
    const clean = (v) => (v || "").replace(/[\s\u00A0\u200B]+/g, "");
    item_id = clean(item_id);
    if (!item_id) {
      return res.status(400).send("item_id is required");
    }

    const result = await ensureThumbnailCached(item_id);
    if (!result.cached) {
      return res.status(404).send(result.reason || "No thumbnail available for this video");
    }

    res.redirect(`/thumbnails/${item_id}.jpg`);
  } catch (err) {
    console.error("Thumbnail proxy failed:", err.response?.data || err.message);
    res.status(500).send("Failed to load thumbnail");
  }
});

app.listen(config.port, () => {
  console.log(`OAuth server running on http://localhost:${config.port}`);
  console.log(`Send yourself to /oauth/ads/start?name=<tiktok_account row name>, etc.`);
});
