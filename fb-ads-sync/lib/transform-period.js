// Transforms for fb_ads_period_data (weekly/monthly reach & frequency).
// Separate from TRANSFORMERS in transform.js because that table only
// stores reach/frequency/impression — no conversions, no revenue — and
// the row shape (entity_type/entity_id/period_type/period_start) doesn't
// match the ad/adset/campaign-keyed daily tables.

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function int(v) {
  return Math.round(num(v));
}

function entityIdFor(level, r) {
  if (level === 'ad') return r.ad_id;
  // BUGFIX: this was missing an 'adset' case, so every adset-level row hit
  // the `throw` below and was silently dropped — caught per-level in
  // sync-periodic.js's try/catch and logged as "adset failed: fb_ads_period_data
  // does not support level: adset" (easy to miss in cron logs). sync-periodic.js's
  // LEVELS array has included 'adset' this whole time, so fb_ads_period_data
  // has never actually had adset rows in it until this fix. After deploying,
  // run `node backfill-periodic.js --period=week` and `--period=month`
  // (optionally with --account=... to target one account) to backfill the
  // adset data retroactively — see the LEVELS note in backfill-periodic.js.
  if (level === 'adset') return r.adset_id;
  if (level === 'campaign') return r.campaign_id;
  if (level === 'account') return r.account_id;
  throw new Error(`fb_ads_period_data does not support level: ${level}`);
}

// periodType: 'week' | 'month' | 'day'
// periodStart: for week/month, the caller-precomputed key (Monday / 1st-of-month) —
// one API call = one row = one period, so a single fixed value is correct.
// For 'day', one API call (time_increment: 1) returns MANY rows, one per day —
// each row's own date_start IS its period_start, the caller's periodStart arg
// is meaningless here and ignored.
function transformPeriodRow(level, periodType, periodStart, r, accountLabel) {
  const resolvedPeriodStart = periodType === 'day' ? r.date_start : periodStart;
  return {
    entity_type: level,
    entity_id: entityIdFor(level, r),
    period_type: periodType,
    period_start: resolvedPeriodStart,
    reach: int(r.reach),
    frequency: num(r.frequency),
    impression: int(r.impressions),
    synced_at: new Date().toISOString(),
    account: accountLabel,
  };
}

module.exports = { transformPeriodRow };
