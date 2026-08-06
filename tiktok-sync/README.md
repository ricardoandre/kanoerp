# TikTok → NocoBase Sync

Syncs TikTok data — **Ads** (Marketing API), **Organic Content** (Login Kit),
**Shop/Affiliate** (Partner Center), and **GMV Max** (campaign/product/creative
performance) — into NocoBase, for two brands: **in-kano** and **askalabel**.
Includes a rich reporting dashboard (NocoBase jblock) with drill-downs and live
creative thumbnails.

**Last updated:** 2026-08-05. If you're picking this up fresh (new chat session,
new team member), read this whole file before touching anything.

---

## 1. Infrastructure

- **Server:** Ubuntu VPS (`ubuntu-olin`), SSH as `root`
- **Project path:** `~/github-nocobase/kanoerp/tiktok-sync`
- **Process manager:** PM2, process name `tiktok-auth`, runs `src/auth-server.js`
  - `pm2 restart tiktok-auth` after any server-side file change
  - `pm2 logs tiktok-auth --lines 30 --nostream`
  - `pm2 list`
- **Domains:**
  - `app.kano.id` — NocoBase itself
  - `tiktoksync.kano.id` — this app: OAuth callbacks, legal pages, thumbnail proxy
- **Swap:** 2GB swap file (`/swapfile`) added after an OOM kill — server only has 3.8GB RAM
- **Server timezone:** UTC. **TikTok ad account timezone:** Jakarta (UTC+7) — handled via `TIKTOK_ADS_TIMEZONE_OFFSET_HOURS` in `.env` and `dateNDaysAgo()` in `gmvmax.js`. Don't remove that offset.
- **Database is NocoBase, not NocoDB** — different REST API entirely (`collection:action` URL pattern, `filterByTk`, Bearer API-key auth).

---

## 2. NocoBase collections

| Collection | Purpose | Key fields |
|---|---|---|
| `tiktok_account` | One row per brand, holds all OAuth tokens | `name` ("in-kano" / "askalabel"), `ads_access_token`, `ads_advertiser_id`, `content_access_token`, `content_open_id`, `shop_access_token`, `shop_id` |
| `tiktok_ads` | Daily ad performance | `ad_id`, `date`, `campaign_name`, `impressions`, `clicks`, `spend`, `conversions`, `ctr`, `cpc`, `cpm` |
| `tiktok_ads_creatives` | Ad creative details | primaryKey is `ad_id` (not an auto id!), `campaign_id`, `ad_name`, `ad_text`, `call_to_action`, `video_id`, `image_ids` |
| `tiktok_content` | Organic video performance | `video_id`, `views`, `likes`, `comments`, `shares` |
| `tiktok_affiliate` | Affiliate orders | `order_id`, `creator_id`, `commission`, `gmv` — not populated yet, see §6 |
| `tiktok_gmv_max` | Daily GMV Max campaign performance | `campaign_id`, `date`, `cost`, `orders`, `gross_revenue`, `roi`, `campaign_name`, `operation_status`, `promotion_type` |
| `tiktok_gmv_max_products` | Daily GMV Max product-level performance | `campaign_id`, `item_group_id`, `date`, `product_name`, `product_image_url`, `cost`, `orders`, `gross_revenue`, `roi` |
| `tiktok_gmv_max_creatives` | Daily GMV Max creative-level performance | `campaign_id`, `item_group_id`, `item_id`, `date`, `title`, `tiktok_account_name`, `cost`, `orders`, `gross_revenue`, `roi` + funnel metrics |

All GMV Max tables link to `tiktok_account` via `fk_tiktok_account_id`.

---

## 3. Register your TikTok apps

You need three separate app registrations — TikTok has no unified API/key.

### a) Marketing API (Ads)
1. https://business-api.tiktok.com/portal → create an app
2. Scopes: Ads Management, Reporting, Ad Account Management
3. Redirect URI: `https://tiktoksync.kano.id/oauth/ads/callback`
4. App name must not contain "Tik"/"Tok" anywhere (case-insensitive, even combined like "xyzTok")
5. Submit for review, copy App ID / App Secret into `.env`

### b) Login Kit (Content)
1. https://developers.tiktok.com → create app → add Login Kit product
2. Scopes: `user.info.basic`, `video.list`
3. Redirect URI (Web tab specifically — has separate tabs for Web/Desktop/Android/iOS): `https://tiktoksync.kano.id/oauth/content/callback`
4. Sandbox/Testers section lets you test with your own account before full approval
5. Copy Client Key / Client Secret into `.env`

### c) Partner Center (Shop/Affiliate)
1. https://partner.tiktokshop.com → register → App & Service → create app
2. Category chain: TikTok Shop Partner (TSP) → Outsourced Operation → Affiliate Management
3. Requires a company introduction PDF + service scope description
4. Redirect URI: `https://tiktoksync.kano.id/oauth/shop/callback`
5. Copy App Key, App Secret, AND Service ID (a different value from App Key, shown separately on the app details page — easy to confuse) into `.env`
6. "Custom" app type can only authorize the shop belonging to the same account that created the app. A second brand with a genuinely separate TikTok login (like askalabel) needs its own separate app registration, logged in as that account — it cannot use in-kano's app.

All three require a domain-verified Privacy Policy + Terms of Service URL, and a
demo video of the OAuth flow. Legal pages are served at:
```
https://tiktoksync.kano.id/terms
https://tiktoksync.kano.id/privacy
```

---

## 4. Configure

```bash
npm install
cp .env.example .env
```

```env
NOCOBASE_BASE_URL=https://app.kano.id/api
NOCOBASE_API_TOKEN=<real NocoBase API key - Settings -> API keys, NOT a session/login token>

TIKTOK_ADS_APP_ID=
TIKTOK_ADS_APP_SECRET=
TIKTOK_ADS_REDIRECT_URI=https://tiktoksync.kano.id/oauth/ads/callback

TIKTOK_CONTENT_APP_ID=
TIKTOK_CONTENT_APP_SECRET=
TIKTOK_CONTENT_REDIRECT_URI=https://tiktoksync.kano.id/oauth/content/callback

TIKTOK_SHOP_APP_KEY=
TIKTOK_SHOP_APP_SECRET=
TIKTOK_SHOP_SERVICE_ID=
TIKTOK_SHOP_REDIRECT_URI=https://tiktoksync.kano.id/oauth/shop/callback

SYNC_LOOKBACK_DAYS=7
TIKTOK_ADS_TIMEZONE_OFFSET_HOURS=7
PORT=3000
```

---

## 5. Add accounts & connect

In NocoBase, add one row per brand to `tiktok_account` with just `name` filled in
(`in-kano`, `askalabel`) — leave token fields blank, the OAuth flow fills them
automatically. You do not need the row's numeric id — the server resolves
accounts by `name`.

Start the server (PM2-managed in production, but for a fresh local test):
```bash
npm run auth-server
```

Visit each of these once per brand, logged in as that brand's TikTok account:
```
https://tiktoksync.kano.id/oauth/ads/start?name=in-kano
https://tiktoksync.kano.id/oauth/content/start?name=in-kano
https://tiktoksync.kano.id/oauth/shop/start?name=in-kano
```
(swap `in-kano` for `askalabel`, and skip Shop for askalabel until it has its own Partner Center app — see §3c)

---

## 6. Current status per API

| API | in-kano | askalabel | Notes |
|---|---|---|---|
| Ads | Working | Working | |
| Content | Working | Not connected yet | Run the OAuth link above if needed |
| Shop/Affiliate | Connected, blocked on scope | Blocked entirely | See §3c — askalabel needs its own app; in-kano's Affiliate Management category may still be pending TikTok review |
| GMV Max | Working | Working | Doesn't need Shop/Partner Center at all — pure Marketing API (see §8) |

---

## 7. Verify & run

```bash
npm run test-access      # checks NocoBase + all 3 TikTok APIs with one safe call each

npm run sync:ads
npm run sync:creatives
npm run sync:content
npm run sync:affiliate
npm run sync:gmvmax
```

Everything upserts (matched on natural keys like `ad_id`+`date`, `campaign_id`+`item_group_id`+`item_id`+`date`, etc.) — safe to re-run without creating duplicates.

Cron (only `sync:gmvmax` is currently scheduled — daily, at 6am Jakarta = 23:00 UTC):
```cron
0 23 * * * cd /root/github-nocobase/kanoerp/tiktok-sync && npm run sync:gmvmax >> daily.log 2>&1
```

One-time / occasional scripts (not cron jobs):
```bash
npm run backfill:gmvmax       # full historical backfill, checkpointed/resumable
node src/cache-thumbnails.js  # catch-up thumbnail download for pre-existing creatives
```

Both are resilient to crashes — the backfill via `backfill-checkpoint.json`, both via a global request timeout. If either dies, just re-run the same command; progress isn't lost. For the backfill specifically, wrap in a retry loop so it survives crashes unattended:
```bash
nohup bash -c 'until npm run backfill:gmvmax; do echo "Crashed, resuming in 10s..." >> backfill.log; sleep 10; done' > backfill.log 2>&1 &
```

---

## 8. Key technical discoveries

Hard-won through extensive debugging — don't re-learn these the hard way.

1. GMV Max has 4 reporting levels (Campaign/Product/Creative/Duration), each with different valid dimensions/metrics/filters. Creative data requires walking campaign → products (`item_group_id`) → creatives (`item_id`).
2. Creative-level data needs 2 separate API calls, not 1 — TikTok rejects attribute fields (title, account name) when using 3+ ID dimensions; those only work with a single-ID (`item_id` alone) query instead. `fetchGmvMaxCreativesBatch` in `gmvmax.js` makes both and merges by `item_id`.
3. Creative queries batch up to 100 `item_group_id`s per call — loop per batch, not per product.
4. `net_cost` is not a valid queryable metric despite appearing in TikTok's sortable-fields docs.
5. GMV Max `item_list` (from `/campaign/gmv_max/info/`) is empty for AUTO_SELECTION campaigns — i.e., most of them. Useless for thumbnails in practice.
6. Thumbnails come from TikTok's PUBLIC oEmbed API instead (`https://www.tiktok.com/oembed?url=...`) — no ads token needed. The account handle in the URL doesn't need to be correct — TikTok's routing keys off the numeric video ID alone (confirmed via testing). We use placeholder `@_` for every lookup, sidestepping stored display names full of emojis/symbols that can't form valid handles.
7. Thumbnails are cached PERMANENTLY to local disk (`public/thumbnails/{item_id}.jpg`) via `ensureThumbnailCached()` in `thumbnails.js` — not just in-memory, since TikTok's URLs expire and videos get deleted. Caching now happens automatically during every sync (no separate cron needed).
8. `axios.defaults.timeout` must be set in every entry-point file that might run standalone — it's a global singleton, but only applies if the file setting it is actually imported in that process. `thumbnails.js` needed its own explicit timeout since `cache-thumbnails.js` doesn't import `gmvmax.js`.
9. Copy-pasting values out of NocoBase's UI can inject non-breaking spaces (`\u00A0`) — silently merges shell arguments and breaks ID parsing. All ID-handling code defensively strips `[\s\u00A0\u200B]+`.
10. Weekly/monthly aren't things TikTok's API offers — only daily. All rollups are computed client-side in the report from stored daily rows. Ratios (ROI, cost-per-order) are always recomputed from summed totals, never averaged.
11. Service ID is not the same as App Key for Partner Center — a completely separate value, easy to grab the wrong one.

---

## 9. The report (jblock)

`view_tiktok_gmv_max_report.js` is pasted directly into a NocoBase page as a
custom-code block — not deployed via the server/PM2 pipeline. To update: copy
the file, paste into the NocoBase page's code editor, replacing the old version.

Features:
- Brand selector, Period type (Daily/Weekly/Monthly/Custom) — Weekly defaults to last week (current week is incomplete)
- Previous-period comparison (up/down % on KPI cards)
- Trailing 8-period trend chart
- "By campaign" history table, ENABLE-only, sortable via clickable headers
- Top Products — sortable, click a row to open a Drawer with that product's creatives + live thumbnails
- Top Creatives — independent of product selection, includes thumbnails inline
- "Winning products" / "Winning creatives" — Top 5 by Spend/Revenue/ROI, big-card layout
- All thumbnails via `/gmvmax/thumbnail?item_id=...` — permanent, works for historical data too

---

## 10. Open items

1. Check whether `backfill:gmvmax` and `cache-thumbnails.js` are still running or finished:
   ```bash
   ps aux | grep -E 'backfill|cache-thumbnails' | grep -v grep
   ```
2. Verify `package.json` on the server has all npm script entries (some edits lagged behind deploys previously) — run scripts directly with `node src/whatever.js` if an alias is missing.
3. Connect askalabel's Content API (never run).
4. Register askalabel's own Partner Center app for Shop/Affiliate (§3c).
5. Check in-kano's Affiliate Management category approval status in Partner Center.
6. Confirm the daily cron job (§7) is actually installed (`crontab -l`).

---

## 11. Useful commands

```bash
# Syncs
npm run sync:ads
npm run sync:creatives
npm run sync:content
npm run sync:affiliate
npm run sync:gmvmax

# One-time
npm run backfill:gmvmax
node src/cache-thumbnails.js

# OAuth (re-run if a token expires or connecting a new account)
https://tiktoksync.kano.id/oauth/ads/start?name=<in-kano|askalabel>
https://tiktoksync.kano.id/oauth/content/start?name=<in-kano|askalabel>
https://tiktoksync.kano.id/oauth/shop/start?name=<in-kano|askalabel>

# Diagnostics
npm run test-access
pm2 logs tiktok-auth --lines 30 --nostream
pm2 flush tiktok-auth

# Server health
ps aux | grep -E 'backfill|cache-thumbnails' | grep -v grep
free -h
dmesg | grep -i "killed process" | tail -5
```

## Notes / gotchas

- Marketing API tokens don't expire on a fixed schedule but can be revoked from TikTok Ads Manager — re-run the ads OAuth link if sync starts failing.
- Content and Shop API tokens expire and issue a refresh token; this scaffold saves the refresh token but doesn't auto-refresh yet.
- TikTok Shop Affiliate APIs aren't available in UK/EU markets as of 2026.
- Date fields synced as `dateOnly` truncate any time-of-day precision — fine for daily analysis.
