# ASKA Label / Kano — code mirror

Canonical mirror of the inline React (`jblock`) and `source_code` components for the
Kano garment-production system on NocoBase. **NocoBase is the live source of truth**
(it executes the code); this repo is the history + context mirror **and the onboarding
doc for any new Claude session**.

> **For a new chat AI reading this first:** read this whole file before writing any
> code. It contains the schema, the hard sandbox constraints, the architecture rules,
> and the mistakes we've already made and fixed. Don't repeat them. Don't propose
> solutions that violate the "hard constraints" section — they have been tried and
> confirmed broken in this environment.

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
pipeline** (`~/fb-ads-sync`, Node.js) that syncs ad performance data in.

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
which files to commit to GitHub.

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
  compiled via `new Function('React','antd','dayjs','ctx', src)` and loaded through a
  `loadCode(ctx, name)` helper with a module-level `_codeCache`.

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
  conversion rollups.

---

## 5. Architecture principles (enforce going forward)

- **Extract-on-second-use.** Write inline first. Only promote something to a shared
  `source_code` row once it's genuinely needed a second time. Don't pre-abstract.
- **Downward-only dependencies:** `ui_` → `fn_` → `lib_`. Never sideways, never
  circular — circular deps are very hard to debug under `new Function` compilation.
- **Stable contracts per module.** One-line comment at the top of every shared module
  stating its input/output shape. Never bolt caller-specific props onto a shared
  component — if a caller needs something new, extend the contract deliberately.
- **Single canonical version.** Edit shared modules in place. All callers pick up the
  change together — no forked copies.
- **Rename in place, never delete-and-recreate jblocks.** Block UIDs feed filter
  controllers; recreating a jblock breaks those silently even if the new one looks
  identical.
- **Jblock names ≠ importable strings.** Only `source_code` rows are loadable by
  string via `loadCode(ctx, name)`. A jblock's name is just a label in NocoBase's UI.
- **Naming convention**, underscore-separated (slashes are invalid in flowSql UIDs):
  - `ui_` / `fn_` / `lib_` → `source_code` rows
  - `view_` → `jblock` rows
  - `act_` → `JSAction` rows
- **`ctx` is always threaded as a function parameter**, never captured at compile
  time — modules must stay reusable across hosts.
- **Change scope discipline:** full-file replacement for complex/widespread changes;
  targeted find/replace for small changes. When ambiguous, confirm direction before
  writing code.
- **Mockup before implementation** for any new UI layout — confirm the visual
  direction before writing the component.

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

### `jblock` rows (inline React pasted into the DB; thin domain shells)

| File | NocoBase row name | Purpose |
|---|---|---|
| `jblock/view_production.js` | `view_production` | Thin domain config → `ui_list_engine` (SQL, status colors, card layout, detail/edit loaders, mounts `ui_record_nav`). |
| `jblock/view_production_material.js` | `view_production_material` | Thin domain config → `ui_list_engine` for `production_material`. |
| `jblock/view_production_result.js` | `view_production_result` | Production result list. Full SQL layer, card/detail/form layouts, 7 secondary filters, 4 bulk actions (including Match Production). |

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

---

## 10. Facebook Ads → NocoBase pipeline

Separate Node.js project at `~/fb-ads-sync`, 4-file modular structure:
`sync.js`, `lib/facebook.js`, `lib/transform.js`, `lib/nocobase.js`.

- Always run scripts from the `~/fb-ads-sync` project root, not from inside `lib/`.
- NocoBase upsert uses the `:updateOrCreate` endpoint with `filterKeys[]` for
  idempotent upserts keyed on `(ad_id, date)`.
- Use the `pickConv` / `pickRevenue` fallback pattern: try CPAS arrays first, fall
  back to pixel arrays.
- Backfill: `BACKFILL_SINCE=2024-01-01 node backfill.js` run from the project root.
- See §4 above for the CPAS/Shopee conversion-data gotcha.

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
  the canonical source stays in sync with the live runtime.

---

## 12. Footer

Public repo: `github.com/ricardoandre/kanoerp`. Structure: `source_code/`, `jblock/`,
`jsaction/` folders, mirroring the NocoBase row types above.
