// =====================================================
// lib/accounts.js
//
// Parses AD_ACCOUNTS into a list of { label, id } pairs, and optionally
// narrows that list to a subset via --account=Label1,Label2 on the CLI —
// used by backfill.js / backfill-periodic.js so you don't have to re-backfill
// every account just to add or fix one.
//
// Format: "Label:act_XXXXXXXXXX,Label2:act_YYYYYYYYYY". A bare id with no
// "Label:" prefix (just "act_ZZZZZZZZZZ") is allowed too — its label just
// becomes the id itself. Falls back to the old single-account AD_ACCOUNT_ID
// env var (labeled "default") if AD_ACCOUNTS isn't set, so existing
// deployments keep working without touching .env until you're ready to add
// a second account.
// =====================================================

function parseAccounts() {
  const raw = process.env.AD_ACCOUNTS;
  if (raw && raw.trim()) {
    const accounts = raw.split(',').map(function (entry) { return entry.trim(); }).filter(Boolean).map(function (entry) {
      const idx = entry.indexOf(':');
      if (idx === -1) return { label: entry, id: entry };
      return { label: entry.slice(0, idx).trim(), id: entry.slice(idx + 1).trim() };
    });
    if (!accounts.length) throw new Error('AD_ACCOUNTS is set but empty after parsing');
    const dupeLabels = accounts.map(function (a) { return a.label; }).filter(function (l, i, arr) { return arr.indexOf(l) !== i; });
    if (dupeLabels.length) throw new Error('AD_ACCOUNTS has duplicate label(s): ' + dupeLabels.join(', ') + ' — labels must be unique');
    return accounts;
  }
  // legacy fallback — single account, old env var name, so existing crontabs
  // that haven't been updated to AD_ACCOUNTS yet keep working unchanged.
  if (process.env.AD_ACCOUNT_ID) {
    return [{ label: 'default', id: process.env.AD_ACCOUNT_ID }];
  }
  throw new Error('Neither AD_ACCOUNTS nor (legacy) AD_ACCOUNT_ID is set');
}

// Narrows an accounts list to a --account=Label1,Label2 CLI filter, if
// present. Matches case-insensitively against either label or raw id, so
// `--account=shop1` and `--account=act_111` both work. Used by
// backfill.js / backfill-periodic.js so a specific account can be
// (re)backfilled without repeating ones already done.
function filterAccountsFromArgs(accounts, argv) {
  const args = argv || process.argv.slice(2);
  const flag = args.find(function (a) { return a.indexOf('--account=') === 0; });
  if (!flag) return accounts;
  const wanted = flag.slice('--account='.length).split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  if (!wanted.length) return accounts;
  const filtered = accounts.filter(function (a) {
    return wanted.indexOf(a.label.toLowerCase()) !== -1 || wanted.indexOf(a.id.toLowerCase()) !== -1;
  });
  const unknown = wanted.filter(function (w) {
    return !accounts.some(function (a) { return a.label.toLowerCase() === w || a.id.toLowerCase() === w; });
  });
  if (unknown.length) {
    console.warn('--account: no match for "' + unknown.join('", "') + '" — check spelling against AD_ACCOUNTS labels/ids. Available: ' + accounts.map(function (a) { return a.label; }).join(', '));
  }
  if (!filtered.length) {
    throw new Error('--account matched no configured accounts');
  }
  return filtered;
}

module.exports = { parseAccounts, filterAccountsFromArgs };
