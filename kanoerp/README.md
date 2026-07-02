# Internal Production System — code mirror

Canonical mirror of the inline React (`jblock`) and `source_code` components for an
internal production-management system on NocoBase. **NocoBase is the live source of
truth**
(it executes the code); this repo is the history + context mirror **and the onboarding
doc for any new Claude session**.

> **For a new chat AI reading this first:** read this whole file before writing any
> code. It contains the sandbox constraints, the architecture rules, and the mistakes
> we've already made and fixed. Don't repeat them. Don't propose solutions that
> violate the "hard constraints" section — they have been tried and confirmed broken
> in this environment. The database schema is **not** in this file — see §7 for
> where to get it.

---

## 1. What this project is

This is an **internal garment production management system**, built as
inline JavaScript pasted directly into **NocoBase** (self-hosted, Jakarta timezone,
`DD/MM/YYYY` date formatting). No filesystem deployment — every "file" in this repo
corresponds to one row in a NocoBase table (`source_code`, `jblock`, or `JSAction`).

It tracks productions across two internal brands (identified by product code prefix
`A` vs `O`) — through statuses: `planning → cutting → production →
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

**Schema refresh ritual:** the schema lives in a separate file, not here (see §7).
Whenever the schema changes, run the `view_schema_dump` jblock (§8), copy the text
box, and paste it into a Claude chat with "update the schema file." Don't hand-edit
the schema file from memory — NocoBase's relation field names routinely differ from
what you'd guess (see §4.1), so the dump is the only reliable source.

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
- **Concurrent `ctx.sql.save`/`runById` pairs with different uids can collide.**
  *(Learned 2026-07-02.)* Firing several dynamic-uid SQL calls at once via
  `Promise.all` (e.g. one query per item in a loop) threw
  `"invalid sql schema uid used"`. Fix: combine the queries into one (e.g.
  `UNION ALL` for per-table row counts) under a single fixed uid, or serialize the
  calls (`.then()` chain / sequential execution) instead of running them in
  parallel. Multiple *fixed*, *different* uids fired concurrently (e.g.
  `ui_production_edit`'s `fetchOptions`, four parallel lookups) is a proven-safe
  pattern — the risk is specifically *dynamic/generated* uids run in parallel.

---

## 4. NocoBase API patterns

- **SQL:** `ctx.sql.save(uid, sql)` (awaited) → `ctx.sql.runById(uid)`.
  - `uid` must be a **fixed string** in column/list contexts.
  - In **multi-row column code**, `uid` must be **dynamic per row**
    (`"prefix_" + record_id`) to prevent concurrent collisions between rows rendering
    at the same time — but see §3: don't fire many dynamic uids in parallel from a
    single component (e.g. a loop + `Promise.all`); combine into one query or
    serialize instead.
- **Writes:** use `ctx.api.resource('collection').create({ values: {...} })` for
  inserts — this is reliable and avoids snowflake-ID issues that raw SQL `INSERT`
  runs into.
- **belongsTo associations** require nested payloads:
  `{ [relFieldName]: { [targetKey]: value } }` — never send a raw FK value alone,
  it fails required-field validation. **The relation field name is not always
  predictable — see §4.1, check the schema file.**
- **Image/attachment fields** are relations through obfuscated junction tables
  (`t_xxx`), not plain SQL columns. Use the resource API with
  `appends: ['image']`, or JOIN junction → attachments table via SQL. Relative
  `/storage/uploads/…` URLs work directly in `<img src>`.
- **Enum / single-select options** resolve via
  `ctx.dataSourceManager.getDataSource('main').getCollection(...).getField(...).enum`
  — do not try to pull enum labels via SQL.
- **Schema/field introspection: use NocoBase's own metadata API, not raw SQL.**
  *(Learned 2026-07-02.)* `ctx.dataSource || ctx.dataSourceManager.getDataSource('main')`
  → `.getCollections()` gives every collection synchronously (`.name`, `.title`,
  `.template`, `.filterTargetKey`, `.getFields()`). This is authoritative for
  relation types/targets/keys. Raw SQL `information_schema` FK introspection is
  **not reliable here** — most relations in this schema are enforced at the
  NocoBase application layer, not as real DB foreign key constraints, so a raw-SQL
  FK dump comes back mostly empty even though the relations very much exist and
  work. See the `view_schema_dump` jblock (§8).
- **CPAS / Shopee-integrated ad accounts:** conversions only appear in
  `catalog_segment_actions` / `catalog_segment_value`; the standard
  campaign/account-level `actions`/`action_values` API silently drops conversion data
  for these accounts. Ad-level (`ads_insights`) is the only reliable source for
  conversion rollups.

### 4.1 Relation field names are not predictable — always check the schema file

*(Learned 2026-07-02, from the first real `view_schema_dump` output.)* NocoBase's
`belongsTo`/`hasMany`/`belongsToMany` **relation accessor field name** is frequently
*different* from both the target collection's name and the raw FK column name.
Guessing it wrong will silently misbehave — wrong field written, or required-field
validation failures on create/update. Confirmed examples from the live schema:

- A `belongsTo` relation field's name doesn't have to match its target collection's
  name (e.g. a relation to `product` was named something other than `product`).
- A `hasMany` relation field's name doesn't have to match the related collection's
  name either.
- Some tables carry **legacy/duplicate raw audit columns** alongside the standard
  NocoBase `createdBy`/`updatedBy` belongsTo pair (plain `bigInt` columns with
  similar names) — prefer the belongsTo pair; treat the raw duplicates as legacy
  and don't build new logic on them without checking why they exist first.
- New, previously-undocumented relations can exist that aren't obvious from the
  collection's "primary" purpose (e.g. a product-level relation into materials
  beyond the expected `product_material` join table).

**Rule going forward:** before writing a `belongsTo` nested-payload create/update,
or before calling `appends: ['relationName']`, check the actual field name in the
schema file (§7) rather than assuming it matches the collection name. Never
hand-edit or hand-recall the schema from memory for this — regenerate the dump.

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

## 7. Database schema — see separate file, not here

The schema is **not** kept in this README. It's regenerated from NocoBase's own
collection/field metadata (see §4's introspection note) and lives here:

**https://raw.githubusercontent.com/ricardoandre/kanoerp/refs/heads/main/kanoerp/Schema%20Dump**

Fetch that file at the start of any session that will touch SQL, `belongsTo`
payloads, or `appends`. Regenerate it with the `view_schema_dump` jblock (§8)
whenever the schema changes — see the "Schema refresh ritual" in §2. Do not
reconstruct or guess schema details from memory; relation field names in
particular are not predictable from the collection name (§4.1).

Two schema-adjacent notes worth keeping here since they're about *behavior*, not
column names:
- All production FKs are standardized to `fk_production_id`.
- `material_ledger` captures supplier **per transaction** (a point-in-time
  snapshot), because the supplier for a given material can change over time —
  don't assume the current material's supplier FK reflects historical
  transactions.

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

### `jblock` rows — dev tools (not domain UI; used for project maintenance)

| File | NocoBase row name | Purpose |
|---|---|---|
| `jblock/view_source_code_updates.js` | `view_source_code_updates` | Lists `source_code` rows whose `updated_at` is newer than an editable timestamp (Jakarta local, converted to UTC for the query) — shows what's still pending paste-to-GitHub. |
| `jblock/view_schema_dump.js` | `view_schema_dump` | Produces a copy-pasteable text dump of every collection/field/relation via `ctx.dataSourceManager.getCollections()` (dynamic — no hardcoded table list). Used to regenerate the schema file (§7). |

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
- Before writing SQL or a `belongsTo` payload against a table you haven't touched
  recently, fetch the schema file (§7) — don't assume field/relation names match
  the collection name (§4.1).

---

## 12. Footer

Public repo: `github.com/ricardoandre/kanoerp`. Structure: `source_code/`, `jblock/`,
`jsaction/` folders, mirroring the NocoBase row types above. Schema lives in a
separate file — see §7.
