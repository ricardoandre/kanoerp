// =====================================================
// lib/ig-accounts.js
//
// Parses IG_ACCOUNTS into a list of { label, id } pairs, and optionally
// narrows that list to a subset via --account=Label1,Label2 on the CLI.
// Deliberately mirrors fb-ads-sync/lib/accounts.js exactly (same format,
// same --account flag behavior) so the two pipelines stay familiar side by
// side — but kept as a separate file/module rather than a shared import,
// since ig-sync and fb-ads-sync are independent deployments (own
// node_modules, own .env) per the project's directory layout.
//
// Format: "Label:17841403040120984,Label2:1784140xxxxxxxx". A bare id with
// no "Label:" prefix is allowed too — its label becomes the id itself.
// Falls back to a single-account IG_USER_ID env var (labeled "default") if
// IG_ACCOUNTS isn't set — this is written multi-account-first (unlike
// fb-ads-sync's AD_ACCOUNTS, which had to be retrofitted later) since you
// already know you're running two brands.
// =====================================================

function parseAccounts() {
  const raw = process.env.IG_ACCOUNTS;
  if (raw && raw.trim()) {
    const accounts = raw
      .split(',')
      .map(function (entry) { return entry.trim(); })
      .filter(Boolean)
      .map(function (entry) {
        const idx = entry.indexOf(':');
        if (idx === -1) return { label: entry, id: entry };
        return { label: entry.slice(0, idx).trim(), id: entry.slice(idx + 1).trim() };
      });
    if (!accounts.length) throw new Error('IG_ACCOUNTS is set but empty after parsing');
    const dupeLabels = accounts
      .map(function (a) { return a.label; })
      .filter(function (l, i, arr) { return arr.indexOf(l) !== i; });
    if (dupeLabels.length) {
      throw new Error('IG_ACCOUNTS has duplicate label(s): ' + dupeLabels.join(', ') + ' — labels must be unique');
    }
    return accounts;
  }
  if (process.env.IG_USER_ID) {
    return [{ label: 'default', id: process.env.IG_USER_ID }];
  }
  throw new Error('Neither IG_ACCOUNTS nor IG_USER_ID is set');
}

// Narrows an accounts list to a --account=Label1,Label2 CLI filter, if
// present. Case-insensitive match against label or raw id.
function filterAccountsFromArgs(accounts, argv) {
  const args = argv || process.argv.slice(2);
  const flag = args.find(function (a) { return a.indexOf('--account=') === 0; });
  if (!flag) return accounts;
  const wanted = flag
    .slice('--account='.length)
    .split(',')
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);
  if (!wanted.length) return accounts;
  const filtered = accounts.filter(function (a) {
    return wanted.indexOf(a.label.toLowerCase()) !== -1 || wanted.indexOf(a.id.toLowerCase()) !== -1;
  });
  const unknown = wanted.filter(function (w) {
    return !accounts.some(function (a) { return a.label.toLowerCase() === w || a.id.toLowerCase() === w; });
  });
  if (unknown.length) {
    console.warn(
      '--account: no match for "' + unknown.join('", "') + '" — check spelling against IG_ACCOUNTS labels/ids. ' +
      'Available: ' + accounts.map(function (a) { return a.label; }).join(', ')
    );
  }
  if (!filtered.length) {
    throw new Error('--account matched no configured accounts');
  }
  return filtered;
}

module.exports = { parseAccounts, filterAccountsFromArgs };
