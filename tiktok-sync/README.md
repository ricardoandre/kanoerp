# TikTok → NocoBase Sync

Pulls **ads** (Marketing API), **organic content** (Login Kit / Content API), and
**affiliate** (TikTok Shop Partner Center) data and syncs it into your NocoBase
collections for analysis.

Built against the collections you already created:
- `tiktok_account` — one row per TikTok account, holding OAuth tokens for each API
- `tiktok_ads`, `tiktok_content`, `tiktok_affiliate` — data rows, each linked back
  to `tiktok_account` via `fk_tiktok_account_id`

## 1. Register your three TikTok apps

### a) Marketing API (ads)
1. https://business-api.tiktok.com/portal → create an app
2. Add **Ads Management** and **Reporting** scopes
3. Redirect URI matching `TIKTOK_ADS_REDIRECT_URI` in `.env`
4. Submit for review (usually 2-3 days), then copy `app_id` / `secret` into `.env`

### b) Content/Organic API
1. https://developers.tiktok.com → create an app, add **Login Kit**
2. Request scopes `user.info.basic`, `video.list`
3. Redirect URI matching `TIKTOK_CONTENT_REDIRECT_URI`
4. Copy `client_key` / `client_secret` into `.env`

### c) TikTok Shop Partner Center (affiliate)
1. https://partner.tiktokshop.com → register, create an app
2. Request the **Affiliate Seller API**
3. Redirect URI matching `TIKTOK_SHOP_REDIRECT_URI`
4. Copy `app_key` / `app_secret` into `.env`

All three require a Privacy Policy + Terms of Service URL (domain-verified) and a
demo video of the OAuth flow for review — see prior guidance if you need this again.

## 2. Configure

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `NOCOBASE_BASE_URL` — your NocoBase API base, e.g. `https://your-app.nocobase.com/api`
- `NOCOBASE_API_TOKEN` — an API key from NocoBase (Settings → API keys)
- The three TikTok app credential sets

## 3. Add your account row

In NocoBase, add one row to `tiktok_account` with just `name` filled in (e.g. "My Brand").
Leave every token field blank — the auth flow fills those in automatically. Note the row's
`id` (visible in the record view/URL) — you'll need it for the next step.

## 4. Connect each API

Start the auth server:

```bash
npm run auth-server
```

Then visit each of these once, replacing `<ID>` with your `tiktok_account` row's id:

```
http://localhost:3000/oauth/ads/start?account_id=<ID>
http://localhost:3000/oauth/content/start?account_id=<ID>
http://localhost:3000/oauth/shop/start?account_id=<ID>
```

Log in with your own TikTok account at each, approve access. Tokens land automatically
in that `tiktok_account` row.

## 5. Verify access

```bash
npm run test-access
```

This checks NocoBase connectivity and makes one safe read-only call against each of the
three TikTok APIs so you know before running the full sync whether something's missing
or a token is bad.

## 6. Run the sync

```bash
npm run sync            # all three data types
npm run sync:ads
npm run sync:content
npm run sync:affiliate
```

Looks back `SYNC_LOOKBACK_DAYS` (default 7) each run and upserts rows — matched on
ad_id+date, video_id, or order_id, so reruns don't create duplicates. Wire into a cron job
to keep it current:

```
0 6 * * * cd /path/to/tiktok-nocodb-sync && npm run sync >> sync.log 2>&1
```

## Notes / gotchas

- Date fields in your NocoBase schema are `dateOnly` — the sync code truncates
  timestamps to `YYYY-MM-DD` before writing (you lose time-of-day precision on
  `posted_at` / `created_at`; fine for daily analysis, but flag it if you need finer granularity).
- **Marketing API tokens** don't expire on a fixed schedule but can be revoked from
  TikTok Ads Manager — re-run the ads OAuth link if sync starts failing.
- **Content and Shop API tokens** expire and issue a refresh token; this scaffold saves
  the refresh token but doesn't auto-refresh yet — add a scheduled call to
  `refreshContentToken()` / `refreshShopToken()` before expiry for a hands-off setup.
- TikTok Shop Affiliate APIs aren't available in UK/EU markets as of 2026.
