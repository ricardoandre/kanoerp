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
>
> **On getting files without asking Andre:** if you have bash/code-execution
> access, `git clone` the repo yourself (§2) — don't ask him for file contents you
> can get directly. If you only have a web-fetch tool, note that most such tools
> can only fetch a URL that already appears *literally* in the conversation —
> **a URL you construct by editing another URL's path will be rejected**, even if
> the pattern is obvious. That's why §8.1 below lists the exact, literal raw URL
> for every file: fetching this README puts all of them into the conversation
> verbatim, so you can fetch any of them directly with zero construction. Use
> those, don't build your own.
>
> **A second, separate fetch-reliability problem (learned 2026-07-02):** even a
> literal, correctly-typed URL from §8.1 can come back from a `web_fetch`-style
> tool as just the URL text itself, with no error — indistinguishable from a
> successful fetch unless you actually look at what came back. This happened
> repeatedly in one session, including on this exact README's own URL fetched
> twice in a row. **Before treating a fetch as successful, or writing anything
> about a file based on it, confirm the returned content actually looks like the
> file** (real code / real prose), not the URL string echoed back. If it's not
> real content, say so and retry rather than proceeding on a guess — a wrong
> guess stated with confidence is worse than an honest "I couldn't read this."

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

**How code actually goes live in NocoBase (deployment mechanics):**
- **`jblock`** → create a new **Page** in NocoBase, add one big custom-code block
  to that page, paste the code in. One page = one jblock, almost always (e.g.
  `view_production` is its own page). This is the pattern for anything that's a
  full custom view (production list, material list, dev tools like the schema
  dump).
- **`JSAction`** → used *alongside a native NocoBase table block* (the built-in
  table UI, not a custom jblock), to extend what that table can do. Workflow:
  start from an existing native table → add a button action on it → point that
  button at the JSAction row → paste the shell code in. This is how the
  `act_import_*` and `act_material_out`/`act_prepare_fabric` actions attach to
  their respective native tables.
- A `source_code` row by itself is never placed on a page directly — it's only
  ever loaded via `loadCode(ctx, name)` from a `jblock` or `JSAction`.

**Session close ritual:** every Claude session should end with an explicit
"changed this session" list, so it's clear which rows to paste into NocoBase and
which files to commit to GitHub.

**Schema refresh ritual:** the schema lives in a separate file, not here (see §7).
Whenever the schema changes, run the `view_database_schema_dump` jblock (§8), copy
the text box, and paste it into a Claude chat with "update the schema file." Don't
hand-edit the schema file from memory — NocoBase's relation field names routinely
differ from what you'd guess (see §4.1), so the dump is the only reliable source.

**Getting the current file list:** GitHub's web "tree" page (`/tree/main/...`)
blocks automated fetching (`robots.txt` disallows it), so a new Claude session
can't just browse the repo in a browser-like way. The clone command above always
works though — after cloning, list files with:
```
find kanoerp -type f -not -path '*/.git/*'
```
Ask for this at the start of a session if you want Claude to reconcile the
registry (§8) against what's actually in the repo, rather than trusting the
table below blindly.

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
- **`fetch()` is blocked**, and **writing to any global** (e.g. `window.XLSX = ...`)
  throws — this is SES lockdown, confirmed while building the CSV importers
  (`ui_import_*`). Rules out loading external libraries (e.g. a binary `.xlsx`
  parser like SheetJS) entirely: no way to fetch one in, no way to attach it to a
  global even if you had the bytes. Users must convert `.xlsx`/`.xls` to CSV before
  uploading.
- **`new FileReader()` is blocked** (constructing this specific global throws), but
  **`Blob.prototype.text()` on an existing `File` object is allowed** — it's an
  instance method on an object you already have (e.g. from antd's `Upload`
  component), not a global being instantiated. This is the proven pattern for
  reading uploaded file contents in this sandbox: get the `File` from antd
  `Upload`, call `.text()` on it, parse as delimited text (comma/semicolon/tab,
  auto-detect). See `ui_import_material_details` / `ui_import_product_material` /
  `ui_import_product_main_material`.
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

- **Database engine: MySQL** (confirmed). Write SQL accordingly — backtick-quote
  reserved words, `LIMIT n` (not `LIMIT n OFFSET m` reversed), no `information_schema`
  reliance for relation semantics (§4's schema-introspection note below), standard
  MySQL date functions if needed. This matters most for anyone writing raw SQL
  directly rather than using `ctx.api.resource(...)`.
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
  work. See the `view_database_schema_dump` jblock (§8).
- **CPAS / Shopee-integrated ad accounts:** conversions only appear in
  `catalog_segment_actions` / `catalog_segment_value`; the standard
  campaign/account-level `actions`/`action_values` API silently drops conversion data
  for these accounts. Ad-level (`ads_insights`) is the only reliable source for
  conversion rollups.
- **Reach and frequency are NOT additive across days.** *(Learned 2026-07-02, from
  the FB Ads weekly/monthly reporting work — see §10.1.)* Summing daily `reach`
  values, or averaging daily `frequency` values, over a week or month double-counts
  anyone reached more than once in that window and produces a wrong number — not
  an approximation, an actually incorrect one. The Marketing API only returns a
  correct reach/frequency figure when queried with `time_range` set to the exact
  period wanted and **no `time_increment`** (or one matching the period length).
  This applies at every level (ad/campaign/account) — account-level reach also
  dedupes across ads within the account, so it isn't derivable from campaign- or
  ad-level numbers either. Any other additive metric (spend, impressions, clicks,
  conversions) is fine to sum from daily rows as before; only reach/frequency need
  a separate, period-scoped fetch.

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

### 4.2 Canonical `runSql` / `execSql` template — use this, not the older simpler version

The most defensive version found in the codebase, independently present in two
files (`ui_match_production`, `ui_material_out.js`) — treat this as the default
template for any new component's SQL helper, in preference to the simpler
`.save().then(() => .runById())` pattern still visible in older files
(`view_production.js`, `ui_production_edit.js`):

```js
async function runSql(ctx, uid, sql) {
  if (ctx.flowSettingsEnabled) {
    await ctx.sql.save({ uid, sql, dataSourceKey: 'main' }).catch(() => {});
  }
  return ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' })
    .then(r => r || []).catch(() => []);
}
async function execSql(ctx, uid, sql) {
  if (ctx.flowSettingsEnabled) {
    await ctx.sql.save({ uid, sql, dataSourceKey: 'main' }).catch(() => {});
  }
  return ctx.sql.runById(uid, { type: 'exec', dataSourceKey: 'main' }).catch(() => null);
}
```

Two differences from the simpler pattern: `.save()` only runs when
`ctx.flowSettingsEnabled` is true, and both `.save()` and `.runById()` swallow
errors via `.catch()` rather than letting them propagate.

⚠️ **Semantics not fully understood — copy the pattern anyway.** `ctx.flowSettingsEnabled`
appears to gate whether `.save()` runs, likely tied to whether the code is
currently inside NocoBase's flow-configuration/edit UI versus the live rendered
page — but nobody currently remembers exactly why this guard was added. It shows
up independently in two separate files, which is strong enough evidence it's a
deliberate, working pattern worth copying as-is for new SQL helpers, even without
a full explanation of the underlying mechanism. If a future session ever needs to
actually understand *why* (not just copy it), that would mean digging into
NocoBase's own source/docs — this repo's history doesn't have the answer.

### 4.3 `ctx` surface — confirmed members only

Pulled directly from actual usage across the codebase, not assumed. If a new
session needs something not on this list, search existing files for it before
assuming it exists.

| Member | Use |
|---|---|
| `ctx.libs` | `{ React, antd, dayjs }` — the three libraries available inside `new Function('React','antd','dayjs','ctx', src)`. **`dayjs` has no plugins loaded** (confirmed: zero uses of `.utc()`/`.tz()`/`.extend()` anywhere in the codebase) — do timezone math by hand (see `view_source_code_updates`'s manual UTC+7 conversion), don't assume a plugin is available. |
| `ctx.sql` | `.save({uid, sql, dataSourceKey})` / `.runById(uid, {type, dataSourceKey})` — use the §4.2 wrapper, not raw calls. |
| `ctx.api` | `.resource('collection').create({values})` / `.update(...)` — the reliable write path (§4). |
| `ctx.dataSource` / `ctx.dataSourceManager` | `.getDataSource('main').getCollections()` / `.getCollection(name).getField(name)` — schema/enum introspection (§4, §7). |
| `ctx.render` | Mounts the component tree — required at the end of every jblock. |
| `ctx.record` | The current row, in record-scoped contexts (JSAction on a record, column code). |
| `ctx.resource` | `.getSelectedRows()`, `.refresh()` — list/table resource; used from bulk actions and JSActions to refresh after a write. |
| `ctx.message` | Inline feedback, e.g. `ctx.message.warning('...')`. |
| `ctx.notification` | Toast-style feedback (`.success({...})`, `.warning({...})`) — more prominent than `ctx.message`. The convention for when to use which isn't formalized yet; currently mixed across files. |
| `ctx.flowSettingsEnabled` | Gates `ctx.sql.save()` in the §4.2 template — see that section's caveat. |
| `ctx.t` | i18n translation function, e.g. `ctx.t('No data source available')`. Used sparingly; unclear if translation is actually configured — treat as optional decoration unless told otherwise. |

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
- **Preview before writing, opt-in before overwriting.** Any bulk-write/import
  feature must classify rows and show a preview before committing anything —
  new / no-op / conflict — and require explicit opt-in (e.g. a checkbox) before
  overwriting existing non-empty data. Never auto-apply a bulk write silently.
  All three `ui_import_*` modules (§8) independently converged on this pattern —
  treat it as a hard rule for anything new in this category, not just something
  those three happened to do.

---

## 6. UI conventions

**What is antd?** It's [Ant Design](https://ant.design), the React UI component
library NocoBase bundles and exposes via `ctx.libs.antd` — this is where `Modal`,
`Table`, `Select`, `DatePicker`, etc. come from. The exact antd major version in
this environment isn't confirmed (v4 vs v5 differ on some APIs, e.g. `Modal`'s
static methods and how `message` is invoked), so the safest approach is to mirror
components/props already proven to work in this codebase rather than assume a
version. **Confirmed-working components/APIs**, pulled directly from actual files:
`Modal` (incl. `.confirm()`, `.destroyAll()`), `Drawer`, `Dropdown`, `Select`,
`DatePicker`, `InputNumber`, `Switch`, `Spin`, `message`, `Pagination`, `Upload`,
`Button`, `Table`, `Alert`, `Progress`, `Input`, `Tag`. If a new component or prop
is needed that isn't on this list, it's not necessarily broken — just unverified;
say so explicitly rather than presenting it with full confidence.

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
payloads, or `appends`. Regenerate it with the `view_database_schema_dump` jblock
(§8) whenever the schema changes — see the "Schema refresh ritual" in §2. Do not
reconstruct or guess schema details from memory; relation field names in
particular are not predictable from the collection name (§4.1).

Two schema-adjacent notes worth keeping here since they're about *behavior*, not
column names:
- All production FKs are standardized to `fk_production_id`.
- `material_ledger` captures supplier **per transaction** (a point-in-time
  snapshot), because the supplier for a given material can change over time —
  don't assume the current material's supplier FK reflects historical
  transactions.

`fb_ads_period_data` (a `fb-ads-sync`-related NocoBase table, not part of the main
production schema) is documented in §10.1 instead of the schema dump file, since
it's small and specific to that pipeline.

---

## 8. Registry — current components

> File names below match the repo exactly, including inconsistent `.js` extensions
> (some rows have one, some don't — harmless, not worth normalizing yet; see §9 if
> you want to clean it up).

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
| `source_code/ui_match_production` | `ui_match_production` | Reusable match-production module. Exports `openMatchModal`, `fetchMatchData`, `applyMatches`. **Not deployed/tested yet — no `act_match_production` shell exists. Deliberately for later stage; see §9.** |
| `source_code/ui_import_material_details` | `ui_import_material_details` | Bulk-CREATE `material_details` rows from an uploaded CSV (`code`, `fk_material_code`, `variant`, `supplier_variant_code`). Create-only — existing `code` is skipped and reported, no overwrite path. |
| `source_code/ui_import_product_main_material` | `ui_import_product_main_material` | Bulk-import `product.fk_main_fabric_code` from an uploaded CSV (`code`, `material_code`). Classifies each row: blank → ignored, `code` not found → new `product` row created, already matches → no-op, currently empty → auto-updates, differs (non-empty) → conflict table with opt-in checkboxes before overwrite. |
| `source_code/ui_import_product_material` | `ui_import_product_material` | Bulk-CREATE `product_material` rows from an uploaded CSV (`product_code`, `material_code`, `quantity`). |

All three importers share one pattern (see §3 for the underlying SES-lockdown
constraints that forced it): `antd Modal.confirm()` with default OK/Cancel hidden
and custom buttons in `content`, `Modal.destroyAll()` to close; file contents read
via `Blob.prototype.text()` on the `File` object from antd `Upload`, parsed as
delimited text (comma/semicolon/tab auto-detected) — `.xlsx`/`.xls` must be
converted to CSV before uploading, since no binary parser can be loaded in this
sandbox.

### `jblock` rows (inline React pasted into the DB; thin domain shells)

| File | NocoBase row name | Purpose |
|---|---|---|
| `jblock/view_production.js` | `view_production` | Thin domain config → `ui_list_engine` (SQL, status colors, card layout, detail/edit loaders, mounts `ui_record_nav`). |
| `jblock/view_production_material.js` | `view_production_material` | Thin domain config → `ui_list_engine` for `production_material`. |
| `jblock/view_production_result` | `view_production_result` | Production result list. Full SQL layer, card/detail/form layouts, 7 secondary filters, 4 bulk actions (including Match Production). |

### `jblock` rows — dev tools (not domain UI; used for project maintenance)

| File | NocoBase row name | Purpose |
|---|---|---|
| `jblock/view_source_code_updates` | `view_source_code_updates` | Lists `source_code` rows whose `updated_at` is newer than an editable timestamp (Jakarta local, converted to UTC for the query) — shows what's still pending paste-to-GitHub. |
| `jblock/view_database_schema_dump` | `view_database_schema_dump` | Produces a copy-pasteable text dump of every collection/field/relation via `ctx.dataSourceManager.getCollections()` (dynamic — no hardcoded table list). Used to regenerate the schema file (§7). |
| `jblock/view_database_table_list` | `view_database_table_list` | Lighter-weight companion: an antd `Table` view of collections (name, title, template, primary key, field count) via the same `dataSourceManager` API — a quick visual browse rather than a copy-paste text dump. |

### `JSAction` rows (thin action shells)

| File | NocoBase row name | Purpose |
|---|---|---|
| `jsaction/act_material_out.js` | `act_material_out` | Thin shell → `ui_material_out`. |
| `jsaction/act_prepare_fabric.js` | `act_prepare_fabric` | Thin shell → `ui_prepare_fabric`. |
| `jsaction/act_import_material_details` | `act_import_material_details` | Table-level action, thin shell → `ui_import_material_details`. Attach to the `material_details` list block's toolbar. |
| `jsaction/act_import_product_main_material` | `act_import_product_main_material` | Table-level action, thin shell → `ui_import_product_main_material`. Attach to the `product` table block's toolbar. |
| `jsaction/act_import_product_material` | `act_import_product_material` | Table-level action, thin shell → `ui_import_product_material`. Attach wherever `product_material` rows are managed. |

**Not yet built:** `act_match_production` (shell for `ui_match_production`) — the
module exists but isn't wired to a JSAction row yet, deliberately deferred; see §9.

### 8.1 Direct raw URLs — fetch these exactly, don't construct your own

Every URL below is literal and exact. See the note at the top of this file for
why that matters (web-fetch tools reject constructed/edited URLs) — and see the
second note right after it about fetches silently returning the URL instead of
content, which is a different problem from construction and can happen even here.

**`source_code/`**
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_list_engine.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_production_detail.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_production_edit.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_production_material_detail.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_record_nav.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_prepare_fabric.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_material_out.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_match_production
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_import_material_details
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_import_product_main_material
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_import_product_material

**`jblock/`**
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jblock/view_production.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jblock/view_production_material.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jblock/view_production_result
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jblock/view_source_code_updates
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jblock/view_database_schema_dump
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jblock/view_database_table_list

**`jsaction/`**
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_material_out.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_prepare_fabric.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_import_material_details
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_import_product_main_material
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_import_product_material

**Root-level / schema**
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/README.md (this file)
- https://raw.githubusercontent.com/ricardoandre/kanoerp/refs/heads/main/kanoerp/Schema%20Dump (also linked in §7)

**`fb-ads-sync/`** (separate system, see §10 — list may lag actual repo contents,
prefer cloning if you need certainty here)
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/sync.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/backfill.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/creatives.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/lib/facebook.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/lib/transform.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/lib/nocobase.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/lib/creatives.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/sync-periodic.js *(new, see §10.1 — confirm it's actually been committed before trusting this link)*
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/backfill-periodic.js *(new, see §10.1 — same caveat)*
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/lib/transform-period.js *(new, see §10.1 — same caveat)*

**This list must be kept current by hand** — unlike the registry tables, there's
no tool that regenerates it. Whenever a file is added/renamed in the repo, add/fix
its line here in the same commit, or this section silently goes stale and
reintroduces the exact problem it's meant to solve.

---

## 9. What's next (pending / on the horizon)

**Immediately pending:**
- `ui_result_import` — module for importing production results. (Distinct from
  the already-built `ui_import_*` CSV importers in §8, which cover
  `material_details`, `product.fk_main_fabric_code`, and `product_material` — not
  `production_result`.)
- `ui_result_bulk_add` — module for bulk-adding production results.
- JSAction shells for both of the above (`act_result_import`, `act_result_bulk_add`
  or similar, following the `act_` thin-shell pattern).
- `act_match_production` — JSAction shell for the already-built `ui_match_production`
  module. Deliberately deferred: not deployed, not tested yet, for a later stage.
- **FB Ads weekly/monthly reach & frequency** — see §10.1 for full detail and open
  questions. Summary: code drafted this session, none of it confirmed pasted/
  committed/run yet.

**On the horizon:**
- Possible future split of `ui_prepare_fabric` into a logic layer + a `lib_pdf`
  layer — only once a second consumer needs the PDF builder (extract-on-second-use).
- Desktop adaptive branch for a full-screen detail page (currently deferred in favor
  of the single bottom-sheet mobile pattern everywhere).
- Optional cleanup: normalize the inconsistent `.js` extensions across repo files
  (some rows have it, some don't — cosmetic only, not urgent). See §2 for how to
  rename a file on GitHub if/when this gets done.

---

## 10. Facebook Ads → NocoBase pipeline

Separate Node.js project, mirrored in this repo at `fb-ads-sync/` (see §8.1 for
direct file URLs) and run from `~/fb-ads-sync` on the Unix host. Not NocoBase
code — no `loadCode`/`jblock`/`JSAction` conventions apply here, it's plain
Node.js run via cron/manually.

Files (as of last check — this list can drift, prefer cloning if it matters):
`sync.js`, `backfill.js`, `creatives.js`, `lib/facebook.js`, `lib/transform.js`,
`lib/nocobase.js`, `lib/creatives.js`, plus the new §10.1 files.

- Always run scripts from the `~/fb-ads-sync` project root, not from inside `lib/`.
- NocoBase upsert uses the `:updateOrCreate` endpoint with `filterKeys[]` for
  idempotent upserts keyed on `(ad_id, date)` for the daily tables, and on
  `(entity_type, entity_id, period_type, period_start)` for `fb_ads_period_data`
  (§10.1).
- Use the `pickConv` / `pickRevenue` fallback pattern: try CPAS arrays first, fall
  back to pixel arrays.
- Backfill: `BACKFILL_SINCE=2024-01-01 node backfill.js` run from the project root.
- See §4 above for the CPAS/Shopee conversion-data gotcha, and §4 above for the
  reach/frequency non-additivity gotcha.

**Secrets: `.env` is gitignored, not committed.** This repo is public. Real
credentials (`ACCESS_TOKEN`, `NOCOBASE_API_KEY`, etc.) must never be committed —
if `.env` was ever accidentally committed, the fix is rotating the credentials
immediately, not just deleting the file (git history keeps old commits
retrievable regardless of later deletions). `node_modules/` and `*.log` are also
gitignored — regenerate with `npm install`, don't commit dependencies.

### 10.1 Weekly/monthly reach & frequency (started 2026-07-02, NOT yet verified live)

**Problem:** `sync.js`/`backfill.js` fetch daily rows (`time_increment: 1`) via
`lib/facebook.js`'s `fetchInsights`. Daily `reach`/`frequency` values are correct
*per day*, but summing/averaging them into a week or month is wrong — see the
reach/frequency non-additivity note in §4. Every other metric synced daily
(spend, impressions, clicks, conversions) is additive and fine as-is.

**Approach:** a separate sync path that asks the Marketing API for the whole
period in one request per entity (`time_range` = the period, no
`time_increment`), rather than deriving it from daily rows. Only ever syncs
*closed* periods — an in-progress week/month's reach is still changing, so
writing it early just means it needs overwriting later.

**New NocoBase table `fb_ads_period_data`** (already created by Andre before this
work started):

| field | type | notes |
|---|---|---|
| `id` | snowflakeId | primary key |
| `entity_type` | string | `ad` \| `campaign` \| `account` |
| `entity_id` | string | FB id at that level |
| `period_type` | string | `week` \| `month` |
| `period_start` | string | `YYYY-MM-DD`; Monday for weeks, 1st-of-month for months |
| `reach` | bigInt | from FB directly, not derived |
| `frequency` | double | from FB directly, not derived |
| `impression` | bigInt | stored alongside for sanity-check / debugging drift |
| `synced_at` | datetime | |

No `period_end` column — derive it from `period_type` + `period_start` at read
time if a reporting view needs it.

**Levels:** ad, campaign, and account (Andre's call — "multiple levels", not just
one). Adset-level was deliberately left out this round; trivial to add later by
extending `LEVELS` in the two new scripts and `LEVEL_FIELDS.adset` already exists
in `lib/facebook.js`.

**Files changed/added this session:**
- `lib/facebook.js` — **modified.** `fetchInsights` gained an optional
  `timeIncrement` param (default `1`, so `sync.js`/`backfill.js` are unaffected),
  and `LEVEL_FIELDS` gained `account: ['account_id']` (previously only
  ad/adset/campaign existed, no account-level support at all). A full replacement
  file was generated and handed to Andre — **not yet confirmed pasted in, and not
  regression-tested against `sync.js`/`backfill.js` still working afterward.**
- `lib/transform-period.js` — **new.** `transformPeriodRow(level, periodType,
  periodStart, row)`, separate from `transform.js`'s `TRANSFORMERS` because this
  table's shape (entity_type/entity_id/period_type/period_start, no conversions/
  revenue) doesn't match the ad/adset/campaign-keyed daily tables.
- `sync-periodic.js` — **new.** `node sync-periodic.js --period=week|month`.
  Computes the most recently *closed* period, calls `fetchInsights` with
  `timeIncrement: null` for each of the three levels, upserts into
  `fb_ads_period_data` via `upsertMany` (confirmed-real signature from
  `lib/nocobase.js`).
- `backfill-periodic.js` — **new.** `BACKFILL_SINCE=... node backfill-periodic.js
  --period=week|month`. Same idea as `backfill.js` but chunks by whole periods
  (a week or a month), since each chunk IS the row being stored, not something
  aggregated afterward from daily data.

**None of the three new/changed files have been confirmed pasted into
`~/fb-ads-sync` on the host, committed to this repo, or actually run yet** — this
section describes what was designed and drafted, not what's live. Verify at the
start of the next session before assuming any of this works.

**Suggested (not installed) cron, assuming plain crontab on the host — not
confirmed, the host might use something else (pm2, systemd timer):**
```cron
0 6 * * 1 cd ~/fb-ads-sync && node sync-periodic.js --period=week >> logs/sync-periodic.log 2>&1
0 6 2 * * cd ~/fb-ads-sync && node sync-periodic.js --period=month >> logs/sync-periodic.log 2>&1
```

**Open questions for next session (don't re-ask Andre these from scratch — check
first, and only ask if genuinely still unresolved):**
1. Does `fb_ads_period_data` actually have a composite-unique index/constraint on
   `(entity_type, entity_id, period_type, period_start)`? `upsertMany`'s
   `:updateOrCreate` needs one to reliably match the right existing row on re-run
   — unconfirmed whether Andre set this up when creating the table.
2. Was the edited `lib/facebook.js` actually pasted in, and do `sync.js`/
   `backfill.js` still run correctly afterward (regression check on the
   `timeIncrement` default-`1` path)?
3. Were `sync-periodic.js`, `backfill-periodic.js`, `lib/transform-period.js`
   actually added to `~/fb-ads-sync` and committed to this repo?
4. Has `sync-periodic.js` or `backfill-periodic.js` actually been run once,
   successfully, against real data? (Not yet, as of this write-up.)
5. Is adset-level reach/frequency wanted too, alongside ad/campaign/account?
6. What does the host actually use for scheduling — plain crontab, pm2,
   something else? The cron block above is a guess based on `backfill.js`'s
   `BACKFILL_SINCE` env-var convention, not a confirmed mechanism.
7. **`sync.js`, `backfill.js`, and `lib/transform.js`'s real content was not
   successfully re-verified this session** — the fetch tool returned only bare
   URL echoes on every attempt at these three specific files this session (see
   the fetch-reliability note at the top of this doc). Everything said about them
   in this README (e.g. `TRANSFORMERS`, `pickConv`/`pickRevenue`, the daily
   `(ad_id, date)` upsert key) is carried over from earlier sessions' summaries
   and was **not** re-confirmed by direct reading this time. Only `lib/nocobase.js`
   and (eventually, after several failed attempts) `lib/facebook.js` were
   actually read for real in this session.

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
- **Claude cannot execute this code against the live NocoBase instance** — there's
  no test environment reachable from chat. All code is written from documented
  patterns and prior working examples, not verified by actually running it. Flag
  assumptions and untested edges explicitly in the response rather than presenting
  code as guaranteed-correct — the paste-by-Andre → report-errors-back loop *is*
  the verification step, by design, not a sign something went wrong.
- **Before stating "I read file X" or describing its contents, confirm the fetch
  actually returned real content, not just the URL text back.** *(Learned
  2026-07-02, the hard way — see the note at the top of this doc.)* A tool call
  that returns without error is not the same as a tool call that returned the
  thing you asked for. This applies doubly to any claim about a file made without
  a fetch in the same turn — don't extend an earlier real read into an assumption
  about a *different*, unread file just because they live in the same repo.

---

## 12. Footer

Public repo: `github.com/ricardoandre/kanoerp`. Structure: `source_code/`, `jblock/`,
`jsaction/` folders, mirroring the NocoBase row types above. Schema lives in a
separate file — see §7.
