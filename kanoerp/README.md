# ASKA Label / Kano — code mirror

Canonical mirror of the inline React (`jblock`) and `source_code` components for the
Kano garment-production system on NocoBase. **NocoBase is the live source of truth**
(it executes the code); this repo is the history + context mirror **and the onboarding
doc for any new Claude session**.

> **For a new chat AI reading this first:** read this whole file before writing any
> code. It contains the schema, the hard sandbox constraints, the architecture rules,
> the mistakes we've already made and fixed, and a list of open questions from the
> last session (§13) — check that list before asking the person something that's
> already been asked and answered. Don't repeat mistakes. Don't propose solutions
> that violate the "hard constraints" section — they have been tried and confirmed
> broken in this environment.

---

## 1. What this project is

**ASKA Label / Kano** ("kanoerp") is a garment production management system built as
inline JavaScript pasted directly into **NocoBase** (self-hosted, Jakarta timezone,
`DD/MM/YYYY` date formatting). No filesystem deployment — every "file" in this repo
corresponds to one row in a NocoBase table (`source_code`, `jblock`, or `JSAction`).

It tracks productions across two brands — **Askalabel** and **Inkano** (identified by
product code prefix `A` vs `O`) — through statuses: `planning → cutting → production →
QC → permak → done`. Core entities: productions, konveksi (external production
partners), products/SKU variants, materials, samples, delivery/QC results, and
permakan (alteration/rework).

A second, unrelated component of this project is a **Facebook Ads → NocoBase data
pipeline** (`~/fb-ads-sync`, Node.js) plus **3 FB Ads reporting jblocks** — see §10.

---

## 2. Sync workflow (steady state)

1. Code is generated/edited in a Claude session.
2. Paste into the matching NocoBase row (it runs immediately — NocoBase is live).
3. Commit the same change here (the mirror) — paste-and-commit, no delete/reupload.
4. Next session: clone this repo fresh, or share the raw URL of the file(s) in play,
   so Claude reads current state before editing.

Clone command (components nested under `kanoerp/kanoerp/`):
```
git clone --depth 1 https://github.com/ricardoandre/kanoerp.git
```

You only need to keep current the files you're about to work on; the runtime is
always current regardless of mirror lag.

**Session close ritual:** every Claude session should end with an explicit
"changed this session" list, so it's clear which rows to paste into NocoBase and
which files to commit to GitHub. **Also update §13 (Open questions) so the next
session doesn't re-ask something already answered this session.**

---

## 3. Hard sandbox constraints — NEVER violate these

These have been stated and re-confirmed many times. Any new code must respect them.
If a solution requires one of the "blocked" items below, it is wrong — find another way.

- **`window.*` is fully blocked.** No `window.print`, `window.open`, `window.innerWidth`,
  `window.addEventListener`, `window.location`. Never propose a `window.*`-based fix.
- **`document` is not freely available in all contexts** — only use it where already
  proven to work. The one proven pattern: CSV/PDF download via
  `document.createElement('a')` + `Blob` + `.click()` (used in the working CSV export
  and in `ui_prepare_fabric`'s PDF download).
- **`setTimeout` is blocked** in jblock sandboxes.
- **PDF generation must not use `window.print`.** Bundle a pure JS PDF writer into a
  `source_code` row instead (see `ui_prepare_fabric`, which builds PDF bytes by hand,
  no external library, no CDN — validated with `qpdf` + `pdftoppm`).
- **Jblocks cannot import each other.** Shared logic must live in `source_code` rows,
  compiled via `new Function('React','antd','dayjs','ctx', src)`.
  - **UNVERIFIED THIS SESSION — see §13.** The exact export contract (does the
    compiled function body need to end with `return {...}`? is `loadCode`'s
    signature `loadCode(name)` or `loadCode(ctx, name)`?) was inferred, not
    confirmed against a real `source_code` row's raw content — GitHub blocked the
    guessed file path and web search didn't surface it. What we went with, based on
    `jblock/view_production.js`'s concrete usage (`Mod.DetailBody`,
    `PF.openFabricModal`, etc.): each `source_code` row's content is a function
    **body** (not a full function declaration) that ends with `return { ...named
    exports... };`, and each caller defines its own **local** `loadCode(name)`
    helper (not `loadCode(ctx, name)`) that closes over its own top-level `ctx` —
    see the working example below. This matches `view_production.js`'s actual
    code, which contradicts this section's own older wording
    (`loadCode(ctx, name)`) — that older wording was never actually implemented
    that way anywhere we've seen. Confirm this in the next session (§13) before
    trusting it fully.

  Working `loadCode` pattern (copy this verbatim into any jblock that needs a
  shared module — it is NOT itself shared, every jblock duplicates this small
  boilerplate):
  ```js
  const _codeCache = {};
  async function loadCode(name) {
    if (_codeCache[name]) return _codeCache[name];
    const uid = 'code_' + name;
    const rows = await ctx.sql.save({ uid, dataSourceKey: 'main', sql: "SELECT code FROM source_code WHERE name='" + name + "'" })
      .then(() => ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' }));
    const src = (rows && rows[0] && rows[0].code) || '';
    _codeCache[name] = new Function('React', 'antd', 'dayjs', 'ctx', src)(React, antd, dayjs, ctx);
    return _codeCache[name];
  }
  ```
  A `source_code` row's content (the `src` above) is written as if `React`, `antd`,
  `dayjs`, `ctx` are already in scope, ending with a `return { ... }` of whatever
  it wants to export, e.g.:
  ```js
  // entire row content — no wrapping function declaration, just the body
  function num(v) { return Number(v == null ? 0 : v); }
  // ...
  return { num, /* ...more exports... */ };
  ```
  A module that itself needs `ctx` for SQL should still take `ctx` **as an explicit
  parameter on its own exported functions** (e.g. `runSql(ctx, prefix, sql)`), not
  rely on the outer closure's `ctx` — the compiled module instance is cached by
  name and could in principle be invoked by a different caller/ctx later (see the
  "ctx always threaded as a parameter" rule in §5). `dayjs`/`React`/`antd` are
  stable library references, safe to close over directly without re-threading them
  through every function signature.

---

## 4. NocoBase API patterns

- **SQL:** `ctx.sql.save(uid, sql)` (awaited) → `ctx.sql.runById(uid)`.
  - `uid` must be a **fixed string** in column/list contexts.
  - In **multi-row column code**, `uid` must be **dynamic per row**
    (`"prefix_" + record_id`) to prevent concurrent collisions between rows rendering
    at the same time.
- **Writes:** use `ctx.api.resource('collection').create({ values: {...} })` for
  inserts — this is reliable and avoids snowflake-ID issues that raw SQL `INSERT`
  runs into.
- **belongsTo associations** require nested payloads:
  `{ [relFieldName]: { [targetKey]: value } }` — never send a raw FK value alone,
  it fails required-field validation. (See `ui_production_edit`'s belongsTo
  resolution table for `product` and `konveksi`.)
- **Image/attachment fields** are relations through obfuscated junction tables
  (`t_xxx`), not plain SQL columns. Use the resource API with
  `appends: ['image']`, or JOIN junction → attachments table via SQL. Relative
  `/storage/uploads/…` URLs work directly in `<img src>`.
- **Enum / single-select options** resolve via
  `ctx.dataSourceManager.getDataSource('main').getCollection(...).getField(...).enum`
  — do not try to pull enum labels via SQL.
- **CPAS / Shopee-integrated ad accounts:** conversions only appear in
  `catalog_segment_actions` / `catalog_segment_value`; the standard
  campaign/account-level `actions`/`action_values` API silently drops conversion data
  for these accounts. Ad-level (`ads_insights`) is the only reliable source for
  conversion rollups. **Update (this session):** despite this, CPAS/catalog
  campaigns' **objective metadata** (`campaign.objective`, `adset.promoted_object.
  custom_event_type`) comes through completely normally via `fetchEntityStatus` —
  real-world `PRODUCT_CATALOG_SALES` campaigns show a normal `custom_event_type`
  (e.g. `PURCHASE`) same as any other sales campaign. The CPAS gotcha is scoped to
  conversion **metrics**, not objective **classification**.

---

## 5. Architecture principles (enforce going forward)

- **Extract-on-second-use.** Write inline first. Only promote something to a shared
  `source_code` row once it's genuinely needed a second time. Don't pre-abstract.
  (This triggered this session: the 3 FB Ads jblocks had enough duplicated
  format/SQL/classification/UI logic — on their *third* shared use — to justify
  `fn_fbads_data` + `ui_fbads_controls`. See §10.)
- **Downward-only dependencies:** `ui_` → `fn_` → `lib_`. Never sideways, never
  circular — circular deps are very hard to debug under `new Function` compilation.
- **Stable contracts per module.** One-line comment at the top of every shared module
  stating its input/output shape. Never bolt caller-specific props onto a shared
  component — if a caller needs something new, extend the contract deliberately
  (e.g. `ui_fbads_controls`'s `TimeWindowPopover` grew an optional
  `granularityOptions` prop, defaulting to the original 3-option behavior, rather
  than forking a second component when the Overview report needed to drop Daily).
- **Single canonical version.** Edit shared modules in place. All callers pick up the
  change together — no forked copies.
- **Rename in place, never delete-and-recreate jblocks.** Block UIDs feed filter
  controllers; recreating a jblock breaks those silently even if the new one looks
  identical.
- **Jblock names ≠ importable strings.** Only `source_code` rows are loadable by
  string via `loadCode(name)`. A jblock's name is just a label in NocoBase's UI.
- **Naming convention**, underscore-separated (slashes are invalid in flowSql UIDs):
  - `ui_` / `fn_` / `lib_` → `source_code` rows
  - `view_` → `jblock` rows
  - `act_` → `JSAction` rows
- **`ctx` is always threaded as a function parameter**, never captured at compile
  time — modules must stay reusable across hosts. (See the `loadCode` note in §3
  for how this actually plays out in practice.)
- **Change scope discipline:** full-file replacement for complex/widespread changes;
  targeted find/replace for small changes. When ambiguous, confirm direction before
  writing code.
- **Mockup before implementation** for any new UI layout — confirm the visual
  direction before writing the component.
- **Don't guess at unseen files/schemas/env vars.** This session had two real
  incidents: (1) inventing plausible-but-wrong contents for `fetch-status.js` /
  `lib/facebook.js` / `lib/nocobase.js` before actually fetching them (a
  `web_fetch` tool quirk silently returned the URL instead of content on the first
  try — always sanity-check that fetched content looks like real file content, not
  an echo of the request); (2) guessing an `AD_ACCOUNT_ID` env var that didn't
  exist post-multi-account-migration, causing a live crash
  (`.../undefined/campaigns`). Always ask for/fetch the real file before editing it
  — this is already policy (see the top of this doc), but it's worth repeating
  because both incidents happened *despite* that policy already being stated.

---

## 6. UI conventions

- All components use `React.createElement` aliased as `ce` — **never JSX** (no
  transpiler in the sandbox).
- CSS via injected `<style>` tags with scoped class prefixes, to avoid leaking styles
  into the rest of the NocoBase page.
- Any scrollable popup/drawer/bottom sheet must end with a dummy spacer div
  (~80–120px) so the last item isn't clipped by the viewport or a sticky footer.
- **Mobile detail pattern:** single expandable bottom sheet with always-visible main
  details + single-open accordion sub-sections (history, comments, materials,
  variants). Detail actions live as `Edit` + `•••` top-right. No separate page on
  mobile. (Desktop adaptive branch with a full-screen detail page is deferred.)
- **Cross-record navigation** uses *replace*, never stack: close the current
  drawer, open the target. Implemented via `ui_record_nav`, a sibling-mounted host
  with a `navRef = { open: null }` channel that detail bodies call into.
- Clickable cross-links: `›` chevron in indigo (`#4338ca`), no underline.
- **Status colors** (consistent across the whole app):
  - planning → `#f97316`
  - cutting / production → `#d97706`
  - QC → `#84cc16`
  - permak → `#ef4444`
  - done → `#22c55e`
  - Orange = pending/not done · Green = done · Zero quantity = orange.
- **FB Ads reports specifically** (see §10 for full detail):
  - Objective badge colors: purchase `#16a34a` (green), atc `#f59e0b` (amber),
    reach `#3b82f6` (blue), other `#6b7280` (gray).
  - A dashed-border "guessed" badge marks a campaign with no synced
    `objective_key` yet (falling back to name-guessing). An amber "⚠ mixed" badge
    marks a campaign whose adsets disagree on `custom_event_type`. Both are
    informational only — never block rendering.
  - Missing real data (e.g. no `fb_ads_period_data` row for a period) renders as
    **"—" with a warning banner**, never a silently derived/approximated number,
    per this session's explicit direction (see §10).

### Two known component patterns — only one is correct

**DETAILS CODE pattern (correct — use for any detail/popup page context):**
`ctx.libs.React`, `async bootstrap()` inside `useEffect`, a `runSql()` helper
(`.save` + `.runById`), rendered through `ctx.render()`. Sections: highlight card,
qty summary (DO/Cut/Sent/QC + diffs, orange = not done / green = done), variant
table (same color logic), permakan (pending orange / done green), activity history
(grouped, variant tags, defect badges).

**COLUMN CODE pattern (broken — do not use for detail pages):**
`ctx.element.innerHTML` with chained `.then()` SQL queries, no React / `ctx.render`.
This pattern only belongs in simple list-column cell renderers, never in a detail
page context.

---

## 7. Canonical schema

Always reference this for table/FK structure before writing SQL — don't guess column
names.

```
production: id; fk_product_code→product.code; fk_konveksi_code→konveksi.code;
  planning_rol; status; production_ref; is_new; brand; est_production_start;
  est_production_finish; remarks;
  hasMany→production_quantity_details, production_result, qc_result,
          production_sample, production_material

product: image(relation); name; model; description; designer; display;
  hasMany product_material

product_material: id; fk_material_details_code→material_details.code;
  fk_product_code→product.code; quantity

material_details: code; fk_supplier_id→supplier.id; fk_material_code→raw_material.code;
  variant; supplier_variant_code; barcode; remarks

raw_material: code; type; price; price_per_unit; remarks; default_content

konveksi: code; name

production_quantity_details: id; fk_sku_option_id→sku_option.id;
  fk_production_id→production.id; ratio; quantity; cut_quantity

sku_option: id; value; display; sort

production_result: id; fk_production_id→production.id;
  fk_sku_option_id→sku_option.id; shipment_date; quantity; checking_pic;
  is_permakan; import_product_code; remarks

qc_result: id; fk_production_id→production.id; fk_sku_option_id→sku_option.id;
  qc_date; quantity; qc_person; is_defect; remarks; import_product_code

production_sample: id; fk_production_id→production.id;
  fk_sample_product_code→product.code; status; shipment_date; returned_date

production_material: id; fk_material_details_code→material_details.code;
  fk_production_id→production.id; status; shipment_date; quantity_need;
  hasMany material_ledger

material_ledger: id; fk_supplier_id→supplier.id; fk_material_code→material_details.code;
  fk_production_material_id→production_material.id; type; transaction_date; purpose;
  hasMany material_ledger_details

material_ledger_details: id; fk_material_ledger_id→material_ledger.id; details

users: id; nickname; username; email; phone; password; roles

supplier: id; name; address; phone_number; remarks

launch_plan: id; fk_product_code→product.code; fk_production_id→production.id;
  launch_date; is_launched; brand
```

Schema notes:
- All production FKs are standardized to `fk_production_id`.
- `material_ledger` captures supplier **per transaction** (a point-in-time snapshot),
  because the supplier for a given material can change over time — don't assume the
  current `material_details.fk_supplier_id` reflects historical transactions.

### FB Ads schema (see §10 for the full pipeline writeup)

```
campaigns_insights / adsets_insights / ads_insights: one row per entity per DAY
  (base grain is always daily — "weekly"/"monthly" everywhere else are SQL-side
  rollups of these tables, done carefully because reach/frequency don't sum
  validly across days — see §10).
  columns include: account; campaign_id/adset_id/ad_id; campaign_name/etc; date;
  spend; reach; impressions (a REAL column — don't derive it via
  SUM(reach*frequency), that was a bug fixed this session); clicks; link_clicks;
  landing_page_views; registration; atc; checkout; purchase; revenue;
  catalog_segment_actions; catalog_segment_value (CPAS/Shopee — see §4)

fb_ads_status: entity_type ('campaign'|'adset'|'ad'); entity_id; status
  (Facebook's own effective_status — snapshot, overwritten every fetch-status.js
  run); synced_at.
  objective_key: STRING, campaign rows ONLY — "objective:optimization_goal:
  custom_event_type", e.g. "OUTCOME_SALES:OFFSITE_CONVERSIONS:PURCHASE". Comma-
  joined 2nd/3rd segments mean the campaign's adsets disagree (mixed). NEW this
  session — confirm it's actually been added as a column in NocoBase (§13).

fb_ads_period_data: entity_type ('campaign'|'adset'|'ad'|'account'); entity_id;
  period_type ('week'|'month' ONLY — no daily rows exist, for any entity_type,
  confirmed this session); period_start; reach; impression. The ONLY source of
  real deduplicated reach at weekly/monthly grain. Populated by
  sync-periodic.js.

fb_ads_target: metric_key ('cost_atc'|'cost_reach'|'roas'|'cost_purchase');
  target_value; direction ('lt'|'gt'). Live-editable thresholds, shared across
  all 3 FB Ads reports as of this session (see §10). Missing table/rows degrade
  gracefully to hardcoded defaults.
```

---

## 8. Registry — current components

### `source_code` rows (shared logic, compiled via `new Function`, loaded with `loadCode`)

| File | NocoBase row name | Purpose |
|---|---|---|
| `source_code/ui_list_engine.js` | `ui_list_engine` | Generic list/card/drawer engine; views are thin configs on top of it (was `kano_listview`). Exposes a `banner(data)` hook for warning banners. |
| `source_code/ui_production_detail.js` | `ui_production_detail` | Canonical production detail. Self-contained: `{ productionId, onClose }`, fetches its own data. All entry points render this identical experience. Includes a Result History accordion section. |
| `source_code/ui_production_edit.js` | `ui_production_edit` | Production new/edit drawer. |
| `source_code/ui_production_material_detail.js` | `ui_production_material_detail` | Material detail + edit drawer (project mirror was previously misnamed `..._details` plural; the row name is singular). |
| `source_code/ui_record_nav.js` | `ui_record_nav` | Cross-record replace-navigation host. Mount one per view root; cross-links close current + open target (never stacks). Depends on both detail components + `ui_production_edit`. |
| `source_code/ui_prepare_fabric.js` | `ui_prepare_fabric` | Prepare-fabric modal + PDF (was `preparefabric`). `buildFabricPdf` is the future `lib_pdf` extraction candidate — split only once a second PDF consumer exists. |
| `source_code/ui_material_out.js` | `ui_material_out` | Material-out modal. Exports `openModal({ctx,pmId,onSaved})`, `fetchSummary(ctx,pmId)`, `renderSummary(data)`, `isAccType(type)`. |
| `source_code/ui_match_production.js` | `ui_match_production` | Reusable match-production module. Exports `openMatchModal`, `fetchMatchData`, `applyMatches`. |
| `source_code/fn_fbads_data.js` | `fn_fbads_data` | **NEW this session.** Shared FB Ads data/logic layer: format helpers (`num`/`fmtMoney`/`fmtNum`/`fmtPct`/`fmtRatio`/`safeDiv`), SQL helpers (`runSql(ctx,...)`/`sqlDate`/`sqlStr`/`sqlInList`), single-select `accountFilterSql`/`fetchAccountList`, `buildPeriods`/`periodKeyExpr` (with "Last date" anchor support), real objective classification (`resolveObjective`/`classifyObjective`/`REACH_OBJECTIVES`/`SALES_OBJECTIVES`), `fetchObjectiveMap`/`fetchStatusMap`, live targets (`DEFAULT_TARGET_RULES`/`fetchTargetRules`/`targetColorFromValue`/`growthColorFromValues`). No dependency on `ui_fbads_controls`. **Contract unverified — see §13.** |
| `source_code/ui_fbads_controls.js` | `ui_fbads_controls` | **NEW this session.** Shared FB Ads presentational layer: `Field`, `vDivider`, objective badge (`badge`/`OBJ_COLOR`/`OBJ_LABEL`/`OBJ_OPTIONS`), `objectiveMetaBadge` (guessed/mixed indicators), Facebook status badge (`statusBadge`/`STATUS_COLOR`), `TimeWindowPopover` (Group by / Periods back / Last date + Apply, with an optional `granularityOptions` prop to restrict which granularities are offered). Pure UI — no ctx/SQL, no dependency on `fn_fbads_data`. **Contract unverified — see §13.** |

### `jblock` rows (inline React pasted into the DB; thin domain shells)

| File | NocoBase row name | Purpose |
|---|---|---|
| `jblock/view_production.js` | `view_production` | Thin domain config → `ui_list_engine` (SQL, status colors, card layout, detail/edit loaders, mounts `ui_record_nav`). |
| `jblock/view_production_material.js` | `view_production_material` | Thin domain config → `ui_list_engine` for `production_material`. |
| `jblock/view_production_result.js` | `view_production_result` | Production result list. Full SQL layer, card/detail/form layouts, 7 secondary filters, 4 bulk actions (including Match Production). |
| `jblock/view_fb_ads_structure.js` | `view_fb_ads_structure` | **Refactored this session** to consume `fn_fbads_data`/`ui_fbads_controls`. Campaign → Adset → Ad drilldown, real objective classification, single-select Account, Time-window popover, sort-by-metric combo, live targets. |
| `jblock/view_fb_ads_report.js` | `view_fb_ads_report` | **Rewritten this session.** Single account-total Overview — no objective tabs anymore (see §10 for why). Weekly/Monthly only, no Daily. |
| `jblock/view_fb_ads_details.js` | `view_fb_ads_details` | **Refactored this session** to consume the shared modules. Campaign/Adset/Creative drilldown for ONE objective at a time, real objective classification, single-select Account, Time-window popover, existing sort-by-last-period dropdown, live targets. |

### `JSAction` rows (thin action shells)

| File | NocoBase row name | Purpose |
|---|---|---|
| `jsaction/act_material_out.js` | `act_material_out` | Thin shell → `ui_material_out`. |
| `jsaction/act_prepare_fabric.js` | `act_prepare_fabric` | Thin shell → `ui_prepare_fabric`. |
| `jsaction/act_match_production.js` | `act_match_production` | Thin shell → `ui_match_production`. |

---

## 9. What's next (pending / on the horizon)

**Immediately pending:**
- `ui_result_import` — module for importing production results.
- `ui_result_bulk_add` — module for bulk-adding production results.
- JSAction shells for both of the above (`act_result_import`, `act_result_bulk_add`
  or similar, following the `act_` thin-shell pattern).

**On the horizon:**
- Possible future split of `ui_prepare_fabric` into a logic layer + a `lib_pdf`
  layer — only once a second consumer needs the PDF builder (extract-on-second-use).
- Desktop adaptive branch for a full-screen detail page (currently deferred in favor
  of the single bottom-sheet mobile pattern everywhere).
- **FB Ads: daily account-level reach.** If a real per-day, per-account
  deduplicated reach source is ever added (today `fb_ads_period_data` is
  week/month only for every entity type, confirmed this session), Daily
  granularity can be reintroduced to `view_fb_ads_report` — it was deliberately
  removed rather than approximated. See §10 and §13.

---

## 10. Facebook Ads → NocoBase pipeline

### 10.1 Sync pipeline (`~/fb-ads-sync`)

4-file-plus modular structure: `sync.js`, `lib/facebook.js`, `lib/transform.js`,
`lib/nocobase.js`, `lib/accounts.js`, `fetch-status.js` (+ periodic variants:
`sync-periodic.js`, `backfill.js`, `backfill-periodic.js`).

- Always run scripts from the `~/fb-ads-sync` project root, not from inside `lib/`.
- **Multi-account.** `lib/accounts.js` exports `parseAccounts()` (reads
  `AD_ACCOUNTS`, format `"Label:act_XXXXXXXXXX,Label2:act_YYYYYYYYYY"`, falls back
  to legacy single `AD_ACCOUNT_ID` env var labeled `"default"` if `AD_ACCOUNTS`
  isn't set) and `filterAccountsFromArgs(accounts, argv)` (supports
  `--account=Label1,Label2` CLI narrowing, used by backfill scripts). **Every
  script that talks to the Graph API must loop over `parseAccounts()` itself** —
  `lib/facebook.js`'s `fetchInsights`/`fetchEntityStatus` take `accountId` as an
  explicit parameter per call, they do NOT loop internally. (`fetch-status.js`
  crashed in production this session — `.../undefined/campaigns` — because it
  hadn't been updated for this after the codebase migrated off a single global
  `AD_ACCOUNT_ID`; fixed by looping `parseAccounts()`/`filterAccountsFromArgs()`
  the same way `backfill.js`/`sync.js` do.)
- `lib/facebook.js` exports `fetchInsights({ accountId, level, since, until,
  timeIncrement })` (`timeIncrement: 1` default = one row per day;
  `timeIncrement: null` = one aggregated row for the whole range, used by the
  periodic scripts since reach/frequency must come pre-aggregated from the API,
  not derived) and `fetchEntityStatus({ accountId, level })` (object endpoints
  `/campaigns` `/adsets` `/ads`, NOT `/insights` — no date range, "what is it
  right now"). `LEVEL_FIELDS` includes an `'account'` level for `fetchInsights`
  (used by `sync-periodic.js`/`backfill-periodic.js`'s account-level rollups).
- NocoBase upsert uses the `:updateOrCreate` endpoint with `filterKeys[]` for
  idempotent upserts — `(ad_id, date)` for insights tables, `(entity_type,
  entity_id)` for `fb_ads_status`.
- Use the `pickConv` / `pickRevenue` fallback pattern: try CPAS arrays first, fall
  back to pixel arrays.
- Backfill: `BACKFILL_SINCE=2024-01-01 node backfill.js` run from the project root.
- See §4 above for the CPAS/Shopee conversion-data gotcha (metrics only — CPAS
  objective metadata is fine).

### 10.2 Real objective classification (this session's main deliverable)

**Problem this replaced:** all 3 FB Ads reports used to guess a campaign's
objective (reach/atc/purchase) from its **name** (`classifyObjective`/
`CLASSIFY_SQL`/`classifyCampaignName` — string matching on "remarketing",
"retargeting", "atc"). Fragile — breaks silently on any campaign not following the
naming convention.

**Replacement:** `fetch-status.js` now also syncs real Facebook objective
metadata onto campaign rows in `fb_ads_status.objective_key`, format:

```
objective:optimization_goal:custom_event_type
```

- `objective` = raw `campaign.objective` from Facebook (single value).
- `optimization_goal` / `custom_event_type` = **distinct** values from the
  campaign's **adsets** (`adset.optimization_goal` /
  `adset.promoted_object.custom_event_type`), comma-joined if the adsets
  disagree. Needed because `objective` ALONE can't distinguish an ATC-optimized
  campaign from a full-funnel purchase campaign — both are typically
  `OUTCOME_SALES` at the campaign level; that split only shows up at the adset.

The read side lives in `fn_fbads_data.resolveObjective(objectiveKey,
campaignName)`, used identically by all 3 reports:

- `REACH_OBJECTIVES = ['OUTCOME_AWARENESS', 'REACH', 'BRAND_AWARENESS',
  'OUTCOME_TRAFFIC', 'LINK_CLICKS']` → bucket `'reach'`. Traffic objectives
  (current `OUTCOME_TRAFFIC` and legacy `LINK_CLICKS`) were deliberately merged
  into the same bucket/goal as Reach — both are top-of-funnel, no purchase
  intent — per explicit direction this session.
- `SALES_OBJECTIVES = ['OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES']`
  → look at the adsets' `custom_event_type`: all `ADD_TO_CART` → `'atc'`, all
  `PURCHASE` → `'purchase'`, mixed → best-effort pick (prefers `PURCHASE`, then
  `ADD_TO_CART`, else `'other'` if neither is in the mix — a real data case
  turned up `COMPLETE_REGISTRATION`+`LEAD` mixes that must NOT be forced into
  `'atc'`), no event data yet → falls back to the name guess.
- Anything else (currently observed: `OUTCOME_ENGAGEMENT`, legacy
  `POST_ENGAGEMENT`) → bucket `'other'`. Confirmed against real production data
  this session — after the traffic merge above, these two are the only
  objectives left unclassified. If new objective strings show up later
  (`OUTCOME_LEADS`, `OUTCOME_APP_PROMOTION`, etc. are plausible but unconfirmed
  against real data), they'll also land in `'other'` automatically — safe
  default, not an error.
- `isGuessed: true` — no `objective_key` synced yet, using the old name-guess.
- `isConsistent: false` — the campaign's adsets disagreed (comma in a segment).
  Both are surfaced as small non-blocking badges (`ui_fbads_controls.
  objectiveMetaBadge`) — informational, never block rendering.

Note on legacy (pre-ODAX) objective strings: real data confirmed `REACH`,
`CONVERSIONS`, `LINK_CLICKS`, `POST_ENGAGEMENT`, `PRODUCT_CATALOG_SALES` all
still show up as raw `objective` values on older campaigns — the classification
lists above intentionally include both current (`OUTCOME_*`) and legacy forms.

### 10.3 Live targets

All 3 reports share one `fb_ads_target`-backed schema now
(`fn_fbads_data.DEFAULT_TARGET_RULES`/`fetchTargetRules`):
`cost_atc` (default <1200, guards on `atc` count), `cost_reach` (default <16,
guards on `reach` count), `roas` (default >15, guards on `spend`),
`cost_purchase` (default <20000, guards on `purchase` — used by the Structure/
Details Purchase views' Cost/Purchase row; Structure's own PeriodTable doesn't
display Cost/Purchase so it never references this key, which is fine, it's just
additive). `countField` exists specifically to stop a 0-from-no-data value
(e.g. `spend/0 atc = 0`) from reading as if it "beat" a `< target` threshold —
it's not itself overridable from `fb_ads_target`, only `target`/`direction` are.

### 10.4 Reach/frequency non-additivity — the recurring constraint

`campaigns_insights`/`adsets_insights`/`ads_insights` are daily-grain tables
(one row per entity per day) with a REAL `impressions` column (don't derive it
via `SUM(reach*frequency)` — that was a bug in the old Overview report, fixed
this session; `impressions` sums validly, `reach`/`frequency` do not).

Reach cannot be validly summed:
- **Across days** (weekly/monthly rollups) — a person reached on Monday and
  Wednesday isn't reached twice.
- **Across entities** (e.g. multiple campaigns bucketed into one "objective"
  group) — a person reached by two campaigns in the same bucket isn't reached
  twice either.

`fb_ads_period_data` is the only source of genuine deduplicated reach, and only
at `period_type IN ('week','month')` — **confirmed this session there is no
daily row for ANY `entity_type`, including `'account'`.** This directly drove
the Overview report redesign below.

### 10.5 Overview report redesign (`view_fb_ads_report`)

Originally had 4 tabs (Overview/Reach/ATC/Purchase) built by bucketing
campaign-level data via `CLASSIFY_SQL`. Rebuilt this session as **one single
account-total view, no tabs, no objective classification at all**:

- Rationale: a "bucket" (Reach/ATC/Purchase) isn't a real Facebook entity, so
  bucket-level reach could never be more than a sum of per-campaign numbers —
  never truly deduplicated, structurally, no matter how the query is written.
  Objective-level drill-down with real per-entity numbers already exists in
  Structure and Details. Overview now answers exactly one question well: how is
  the whole account doing.
- Spend/Link Clicks/ATC/Purchase/Revenue: exact `SUM(...)` across every campaign
  under the (single, required) selected account — genuinely additive, real, no
  approximation needed regardless of granularity.
- Reach/Impressions/Frequency: **only** from `fb_ads_period_data`
  (`entity_type='account'`), Weekly/Monthly only. A period with no row there
  shows **"—" with an orange warning banner** — never a derived/approximated
  substitute. This is a deliberate policy change from the old approximate-
  fallback behavior (which is still in place for Structure/Details' inherently-
  unavoidable bucket/adset/ad-level reach approximations — see §13 for the one
  open question this left).
- **Daily removed from Group by entirely** (§10.4 — no daily account-level real
  reach source exists). Add back once one does.

### 10.6 Shared code extraction

3rd-use trigger (extract-on-second-use, §5): `fn_fbads_data` (data/logic) +
`ui_fbads_controls` (presentational) — see §8 for contracts. All 3 FB Ads
jblocks now `loadCode('fn_fbads_data')` / `loadCode('ui_fbads_controls')`
instead of duplicating format/SQL/classification/UI logic. Structure/Details
keep their own SQL fetchers inline (genuinely different tables/shapes per
report level) — only the truly-identical-across-all-3 pieces were extracted.

### 10.7 Account filtering

All 3 reports are single-select Account now (previously Structure was
single-select but Overview/Details were multi-select "compare several
accounts"). Empty selection = no filter = every account combined.

---

## 11. Working style / how Claude should operate on this project

- Deliver code in modular structure: shared helpers → data-fetching layer → small
  presentational sub-components (called via `createElement`, not plain functions)
  → thin composition root.
- On iteration, provide a **complete drop-in replacement of the specific named
  component**, not a full-file rewrite of unrelated things.
- One concrete step at a time, with confirmation before moving to the next —
  don't jump ahead of unconfirmed prerequisites.
- Always remind Andre, at the end of a session, to (a) paste the finalized code into
  the matching NocoBase row and (b) commit the same change to this GitHub mirror, so
  the canonical source stays in sync with the live runtime, and (c) update §13 below.
- **Before fetching or trusting any file content, sanity-check it's actually the
  file** — this session had a `web_fetch` call silently return the request URL
  instead of real content on a first attempt, which led to inventing plausible-
  but-wrong file contents. Re-fetch and eyeball the result before building
  anything on top of it.

---

## 12. Footer

Public repo: `github.com/ricardoandre/kanoerp`. Structure: `source_code/`, `jblock/`,
`jsaction/` folders, mirroring the NocoBase row types above.

---

## 13. Open questions for next session

Check this list before asking the person something already asked/answered.

1. **`source_code` export contract — never directly verified.** Built
   `fn_fbads_data`/`ui_fbads_controls` against the `return {...}`-ending-function-
   body pattern inferred from `view_production.js`'s *usage* (`Mod.DetailBody`
   etc.), not from seeing a real `source_code` row's raw content — GitHub
   returned a permissions error for the guessed path
   (`source_code/ui_material_out.js`) and web search didn't surface an
   alternative. **First thing to confirm next session:** paste `fn_fbads_data`
   into NocoBase and verify `loadCode('fn_fbads_data')` actually resolves and
   returns the expected object, ideally by pasting/showing Claude one real
   existing `source_code` row's raw content for a firsthand check.
2. **`loadCode` signature mismatch.** This doc (§3, pre-this-session wording)
   said `loadCode(ctx, name)`; `view_production.js`'s actual implementation is
   `loadCode(name)` (closes over its own top-level `ctx`). The new FB Ads files
   followed the concrete example (`loadCode(name)`). Is the concrete example
   right and this doc's older description just stale, or is there a reason
   `loadCode(ctx, name)` exists elsewhere that we haven't seen? If the former,
   no action needed (already corrected in this version of the doc); if the
   latter, the 3 FB Ads jblocks' `loadCode` needs revisiting.
3. **Has `fb_ads_status.objective_key` actually been added as a column in
   NocoBase yet?** This session designed and shipped the code for it
   (`fetch-status.js`, `fn_fbads_data.resolveObjective`, all 3 reports) but the
   schema change itself (add one nullable string column to the existing
   `fb_ads_status` collection) is a manual NocoBase-admin-UI step that was
   never confirmed done. If `node fetch-status.js` hasn't been successfully
   re-run end-to-end since the multi-account crash fix, do that first and
   sanity-check a sample of `objective_key` values before trusting the reports'
   classification in production.
4. **Only ~30 sample `objective_key` rows were manually reviewed** for
   classification correctness (via a raw `SELECT objective_key FROM
   fb_ads_status` dump). That's enough to have caught and fixed one real bug
   (mixed `COMPLETE_REGISTRATION`+`LEAD` wrongly defaulting to `'atc'`) but is
   not exhaustive — worth spot-checking a larger/fresher sample once
   `fetch-status.js` has run against the full, multi-account campaign set,
   especially watching for any objective string not yet in
   `REACH_OBJECTIVES`/`SALES_OBJECTIVES` (would currently land in `'other'`,
   safe but worth knowing about).
5. **Daily account-level reach** — confirmed this session that
   `fb_ads_period_data` has no daily rows for any `entity_type`, and there's no
   separate `accounts_insights`-style daily table either (only the shared daily
   `campaigns_insights`/`adsets_insights`/`ads_insights` tables exist, none at
   account grain). If a daily account-level real-reach source is ever added
   (e.g. a new sync script hitting `fetchInsights({ level: 'account',
   timeIncrement: 1 })` and writing to a new daily account table), Daily
   granularity can be reintroduced to `view_fb_ads_report` — until then it's
   correctly absent, not a bug.
6. **Structure/Details still approximate reach at the adset/ad level** (sum of
   raw daily reach when `fb_ads_period_data` isn't backfilled yet for that
   entity/period), marked with the existing "~ approx reach" blue-dot
   convention — this was explicitly kept (not moved to the Overview report's
   stricter "warn, never approximate" policy) because per-entity real reach
   genuinely does exist and does eventually backfill, unlike Overview's old
   per-bucket numbers which could never become fully real no matter what. Worth
   confirming this distinction still makes sense once more real usage happens.
