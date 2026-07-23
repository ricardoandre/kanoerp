/**
 * test-ig-permissions.js
 *
 * Purpose: sanity-check whether the access token you're using (or plan to
 * use for ig-sync) actually has enough scope to read Instagram Business
 * Account data via the Instagram Graph API (which rides on top of the
 * Facebook Graph API — there is no separate "Instagram API" login flow
 * for business accounts).
 *
 * Run: node test-ig-permissions.js
 *
 * .env expected (same style as fb-ads-sync):
 *   FB_ACCESS_TOKEN=...    // long-lived User or System User token
 *   FB_API_VERSION=v21.0   // optional, defaults below
 *
 * If you don't have a token yet, or the checks below fail, see the
 * "WHAT YOU NEED" notes at the bottom of this file before re-running.
 */

require('dotenv').config();
const axios = require('axios');

const API_VERSION = process.env.FB_API_VERSION || 'v21.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;
const TOKEN = process.env.ACCESS_TOKEN;

if (!TOKEN) {
  console.error('✗ FB_ACCESS_TOKEN missing in .env — nothing to test.');
  process.exit(1);
}

async function get(path, params = {}) {
  try {
    const res = await axios.get(`${BASE_URL}${path}`, {
      params: { access_token: TOKEN, ...params },
    });
    return { ok: true, data: res.data };
  } catch (err) {
    return { ok: false, error: err.response ? err.response.data : err.message };
  }
}

async function main() {
  console.log(`\n=== IG/FB Graph API permission check (${API_VERSION}) ===\n`);

  // 1. Who is this token for, and is it even valid?
  const me = await get('/me', { fields: 'id,name' });
  if (!me.ok) {
    console.log('✗ Token is invalid or expired.');
    console.log(JSON.stringify(me.error, null, 2));
    return;
  }
  console.log(`✓ Token valid. Identity: ${me.data.name} (${me.data.id})`);

  // 2. What scopes does this token actually carry?
  const perms = await get('/me/permissions');
  if (perms.ok) {
    const granted = perms.data.data
      .filter((p) => p.status === 'granted')
      .map((p) => p.permission);
    const declined = perms.data.data
      .filter((p) => p.status !== 'granted')
      .map((p) => p.permission);

    console.log(`\nGranted permissions:\n  ${granted.join(', ') || '(none)'}`);
    if (declined.length) {
      console.log(`Declined/expired permissions:\n  ${declined.join(', ')}`);
    }

    const required = [
      'pages_show_list',
      'pages_read_engagement',
      'instagram_basic',
      'instagram_manage_insights',
    ];
    const missing = required.filter((p) => !granted.includes(p));
    if (missing.length) {
      console.log(`\n✗ Missing required scopes for ig-sync: ${missing.join(', ')}`);
    } else {
      console.log('\n✓ All required scopes for ig-sync are present.');
    }
  } else {
    console.log('✗ Could not fetch /me/permissions:', JSON.stringify(perms.error, null, 2));
  }

  // 3. Which Pages can this token manage? (Instagram Business accounts are
  //    only reachable *through* a connected Facebook Page.)
  const pages = await get('/me/accounts', { fields: 'id,name,instagram_business_account' });
  if (!pages.ok) {
    console.log('\n✗ Could not list Pages (/me/accounts):', JSON.stringify(pages.error, null, 2));
    return;
  }

  if (!pages.data.data.length) {
    console.log('\n✗ Token has no managed Pages. You need a Page admin token, not just a user token.');
    return;
  }

  console.log(`\nFound ${pages.data.data.length} managed Page(s):`);
  for (const page of pages.data.data) {
    console.log(`  - ${page.name} (${page.id})`);
    if (!page.instagram_business_account) {
      console.log('      ✗ No Instagram Business/Creator account linked to this Page.');
      continue;
    }
    const igId = page.instagram_business_account.id;
    console.log(`      ✓ Linked IG Business Account ID: ${igId}`);

    // 4. Can we actually read basic IG account fields?
    const igAccount = await get(`/${igId}`, {
      fields: 'id,username,name,media_count,followers_count',
    });
    if (igAccount.ok) {
      console.log(
        `      ✓ IG account readable: @${igAccount.data.username}, ` +
          `${igAccount.data.media_count} posts, ${igAccount.data.followers_count} followers`
      );
    } else {
      console.log('      ✗ Could not read IG account fields:', JSON.stringify(igAccount.error, null, 2));
      continue;
    }

    // 5. Can we hit the insights endpoint? (this is the one most likely to
    //    fail even when basic reads succeed — insights needs
    //    instagram_manage_insights specifically, plus the account being a
    //    Business/Creator type, not personal)
    const insights = await get(`/${igId}/insights`, {
      metric: 'reach',
      period: 'day',
    });
    if (insights.ok) {
      console.log('      ✓ Insights endpoint accessible.');
    } else {
      console.log('      ✗ Insights endpoint failed:', JSON.stringify(insights.error, null, 2));
    }
  }

  console.log('\n=== Done ===\n');
}

main();

/**
 * WHAT YOU NEED (if any check above fails)
 * -----------------------------------------
 * 1. The Instagram account MUST be a Business or Creator account (not
 *    personal), and it must be linked to a Facebook Page you administer.
 *    Check in Instagram app: Settings > Account type.
 *
 * 2. The token needs these scopes (request at login / in Graph API
 *    Explorer / in your app's permission request):
 *      - pages_show_list
 *      - pages_read_engagement
 *      - instagram_basic
 *      - instagram_manage_insights
 *
 * 3. If your existing FB_ACCESS_TOKEN was generated for the Marketing API
 *    only (ads_management / ads_read), it will very likely NOT have the
 *    instagram_* scopes above — Meta scopes tokens per the permissions
 *    actually requested during the OAuth flow, not per app. You'll need to
 *    re-auth (or generate a new token in Graph API Explorer) requesting the
 *    scopes in #2 explicitly, then swap it into .env.
 *
 * 4. Long-lived Page tokens don't expire on the usual 60-day user-token
 *    clock as long as the Page admin's user token stays valid — same
 *    pattern you already handled for fb-ads-sync.
 *
 * 5. If your app is still in Development mode in the Meta App Dashboard,
 *    instagram_manage_insights may require App Review before it works for
 *    any account other than ones added as Testers/Admins on the app. If
 *    the insights call above returns an OAuthException about missing
 *    permissions despite /me/permissions showing it granted, check the
 *    app's review status.
 */
