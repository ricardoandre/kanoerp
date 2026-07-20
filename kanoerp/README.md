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

---

## 1. What this project is

This is an **internal garment production management system**, built as
inline JavaScript pasted directly into **NocoBase** (self-hosted, Jakarta timezone,
`DD/MM/YYYY` date formatting). No filesystem deployment — every "file" in this repo
corresponds to one row in a NocoBase table (`source_code`, `jblock`, or `JSAction`),
**or, for JS Column code, lives inline in a table field's settings and isn't its own
row at all** — see the note under §8.1.

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
  `act_import_*`, `act_material_out`/`act_prepare_fabric`, and
  `act_production_marker` actions attach to their respective native tables.
  **A bare JSAction has no host React tree of its own** (nothing has called
  `ctx.render()` for it) — see §6's Modal.confirm subsection for what this rules
  out and what the proven pattern is instead.
- **JS Column** → also lives *alongside a native table block*, but scoped to one
  field/column rather than a button — the code goes directly into that field's
  "JS Column" settings, and is never stored as its own DB row (not `source_code`,
  not `JSAction`, nothing to `loadCode` by name). See `col_production_marker.js`
  in §8.1 for the one example currently in the repo. Same sandbox constraints
  apply (§3), and it follows the COLUMN CODE pattern in §6, not the DETAILS CODE
  one.
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
  and in `ui_prepare_fabric`'s PDF download). **Any other `document.*` access — e.g.
  `document.body.appendChild(...)`, manually mounting a React root — throws
  `"Access to document property ... is not allowed"`.** This was hit directly while
  first building `ui_production_addmarker.js`, which tried to hand-mount via
  `ReactDOM.createRoot(document.body...)`. `ctx.libs` doesn't even expose `ReactDOM`
  in this sandbox — only `{ React, antd, dayjs }` (§4.3). Never assume `ReactDOM` is
  available; mount via `ctx.render()` (jblocks) or `Modal.confirm({ content })` /
  antd's own portal machinery (bare JSAction, see §6) instead.
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
  **Note: this specific collision risk turned out to be a red herring for a separate,
  much bigger problem — see the permissions bullet immediately below, which was
  the actual root cause of an intermittent load failure originally (wrongly)
  attributed to this one.**
- **`ctx.sql.save()`/`ctx.sql.runById()` are admin/root-gated and silently fail for
  non-admin roles.** *(Learned 2026-07, the hard way — first suspected as a
  concurrency race per the bullet above, actually a permissions gap.)* No thrown
  error, just empty results (or, if wrapped in the §4.2 `runSql` template, a
  swallowed rejection that looks like "no data found"). Confirmed independently in
  three separate files (`product_measurement.js`, `ui_product_measurement_add.js`,
  `ui_product_measurement_edit.js`) before this was promoted here — **use
  `ctx.api.resource()` (`.list()` / `.get()` / `.create()` / `.update()` /
  `.destroy()`, with the `fetchAllPages`/`fetchByIn` batching helpers in §4) for ALL
  reads and writes in any component non-admin users will touch. Never raw `ctx.sql`
  for anything user-facing.** The §4.2 `runSql`/`execSql` template isn't deprecated
  outright — it may still suit genuine admin-only/dev-tool contexts (e.g.
  `view_database_schema_dump`) — but stop treating it as a general-purpose data-access
  pattern for regular features.
- **NocoBase's `fields` meta-collection (and likely other system collections like
  `collections`/`roles`) is ALSO admin-gated — even via `ctx.api.resource()`, not
  just raw SQL.** *(Learned 2026-07, building `ui_production_addmarker.js`.)* The
  "resolve a `belongsTo` relation's field name at runtime by querying `fields`"
  pattern (`getRels()`, used in `ui_production_edit.js`,
  `ui_product_measurement_add.js`, `ui_product_measurement_edit.js`, and the first
  version of `ui_production_addmarker.js`) is *also* broken for non-admin roles. A
  `.catch()`-wrapped failure here won't crash the write — many FK columns are
  directly writable regardless of the relation wrapper, so the write silently falls
  back to a raw value and often still succeeds — but NocoBase's own global HTTP
  interceptor still pops a "No permissions" toast for the failed sub-request
  regardless of local error handling. This looks like a real bug to the end user
  even though the save actually worked, and is confusing to debug precisely because
  the data *did* save. **Fix: once a relation's field name and target key are
  confirmed from a schema dump, hardcode them as a plain constant instead of
  re-resolving at runtime** — see `MARKER_RELS`/`MARKER_DETAILS_RELS` in
  `ui_production_addmarker.js` for the pattern, including the reminder that a
  target's key isn't always `id` (e.g. `product`'s primary key is `code`). For
  relations where the exact field name genuinely isn't confirmed and can't be
  safely guessed (§4.1), prefer just writing the raw FK column directly (skip the
  relation wrapper entirely) over calling `getRels()` — see how
  `createProductMeasurement`/`updateProductMeasurement` were fixed for a case
  exactly like this. Only use dynamic `getRels()`-style resolution in genuinely
  admin-only contexts.

---

## 4. NocoBase API patterns

- **Database engine: MySQL** (confirmed). Write SQL accordingly — backtick-quote
  reserved words, `LIMIT n` (not `LIMIT n OFFSET m` reversed), no `information_schema`
  reliance for relation semantics (§4's schema-introspection note below), standard
  MySQL date functions if needed. This matters most for anyone writing raw SQL
  directly rather than using `ctx.api.resource(...)`. **See §3: raw `ctx.sql` is now
  admin-only — this section's SQL-specific advice applies to those narrow contexts,
  not to regular user-facing features.**
- **SQL:** `ctx.sql.save(uid, sql)` (awaited) → `ctx.sql.runById(uid)`.
  - `uid` must be a **fixed string** in column/list contexts.
  - In **multi-row column code**, `uid` must be **dynamic per row**
    (`"prefix_" + record_id`) to prevent concurrent collisions between rows rendering
    at the same time — but see §3: don't fire many dynamic uids in parallel from a
    single component (e.g. a loop + `Promise.all`); combine into one query or
    serialize instead.
- **Reads for non-admin-facing features:** `ctx.api.resource('collection').list({
  filter, fields, appends, sort, pageSize, page })` / `.get({ filterByTk })`. Use the
  batching helpers below rather than hand-rolling pagination or `$in` chunking —
  they're proven across `product_measurement.js`, `ui_product_measurement_add.js`,
  `ui_product_measurement_edit.js`, and `ui_production_addmarker.js`:
  ```js
  const DEFAULT_PAGE_SIZE = 1000;
  function fetchAllPages(ctx, resourceName, params) {
    const pageSize = (params && params.pageSize) || DEFAULT_PAGE_SIZE;
    function loadPage(page, acc) {
      return ctx.api.resource(resourceName).list(Object.assign({}, params, { pageSize, page }))
        .then(function (res) {
          const rows = (res && res.data && res.data.data) || [];
          const merged = acc.concat(rows);
          if (rows.length < pageSize) return merged;
          return loadPage(page + 1, merged);
        });
    }
    return loadPage(1, []);
  }
  function fetchByIn(ctx, resourceName, field, values, params) {
    // batches values into chunks of 150, merges filter[field] = { $in: batch } with
    // any existing params.filter, concatenates results across batches — see
    // ui_production_addmarker.js for the full implementation.
  }
  ```
- **Writes:** use `ctx.api.resource('collection').create({ values: {...} })` for
  inserts — this is reliable and avoids snowflake-ID issues that raw SQL `INSERT`
  runs into.
- **belongsTo associations** require nested payloads:
  `{ [relFieldName]: { [targetKey]: value } }` — never send a raw FK value alone,
  it fails required-field validation. **The relation field name is not always
  predictable — see §4.1, check the schema file. And per §3: don't resolve it via a
  runtime `getRels()`-style query against `fields` for anything non-admin users will
  hit — hardcode it once confirmed, or fall back to the raw FK column if the exact
  relation name genuinely isn't confirmed.**
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
- **`snowflakeId` values can exceed `Number.MAX_SAFE_INTEGER`.** *(Learned 2026-07,
  building `col_production_marker.js`.)* Never sort/compare them via plain numeric
  subtraction (`a.id - b.id`) — silent precision loss. Convert with `BigInt(...)`
  first: `const ba = BigInt(a.id), bb = BigInt(b.id); return ba < bb ? -1 : ba > bb ? 1 : 0;`.
  Treat snowflake IDs as opaque strings for comparison/sorting purposes unless
  explicitly converted to `BigInt`. This is the same class of bug as letting a
  large ID pass through a JS `Number` unnecessarily elsewhere in the stack.
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
- A target collection's primary key isn't always `id` — e.g. `product`'s primary
  key is `code`, so a `belongsTo` payload pointing at it needs
  `{ product: { code: value } }`, not `{ product: { id: value } }`. Confirmed the
  hard way while hardcoding `MARKER_RELS` in `ui_production_addmarker.js` (§3).
- Some tables carry **legacy/duplicate raw audit columns** alongside the standard
  NocoBase `createdBy`/`updatedBy` belongsTo pair (plain `bigInt` columns with
  similar names) — prefer the belongsTo pair; treat the raw duplicates as legacy
  and don't build new logic on them without checking why they exist first.
- New, previously-undocumented relations can exist that aren't obvious from the
  collection's "primary" purpose (e.g. a product-level relation into materials
  beyond the expected `product_material` join table).
- **Some collections have NO belongsTo relations configured at all — just plain FK
  columns** (e.g. `production_marker`, `product_marker`). Confirm this from the
  schema dump too, rather than assuming every FK column has a relation wrapper
  available; for these, write the raw FK value directly, always.

**Rule going forward:** before writing a `belongsTo` nested-payload create/update,
or before calling `appends: ['relationName']`, check the actual field name in the
schema file (§7) rather than assuming it matches the collection name. Never
hand-edit or hand-recall the schema from memory for this — regenerate the dump.
**And per §3: once confirmed, hardcode it — don't re-resolve it at runtime via a
`fields`-collection query for anything non-admin users will hit.**

### 4.2 Canonical `runSql` / `execSql` template — admin-only contexts now, not general-purpose

⚠️ **Per §3, raw `ctx.sql` is admin/root-gated and silently fails for non-admin
roles.** The template below is preserved for genuinely admin-only/dev-tool contexts
(e.g. `view_database_schema_dump`) — **do not reach for it in any new user-facing
component.** Use the `ctx.api.resource()` / `fetchAllPages` / `fetchByIn` pattern
in §4 instead.

The most defensive version found in the codebase, independently present in two
files (`ui_match_production`, `ui_material_out.js`) — treat this as the default
template *for admin-only SQL helpers specifically*, in preference to the simpler
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
errors via `.catch()` rather than letting them propagate. **That silent `.catch()`
is exactly why the admin-gating problem above was hard to diagnose — a permissions
failure and an "empty table" look identical through this wrapper.** If you're
debugging a mysterious "no data found" from something using this template, check
the calling user's role before assuming the query itself is wrong.

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
| `ctx.libs` | `{ React, antd, dayjs }` — the three libraries available inside `new Function('React','antd','dayjs','ctx', src)`. **`ReactDOM` is NOT included** — don't assume it, don't try `ReactDOM.createRoot(...)` (confirmed absent while first building `ui_production_addmarker.js`; see §3's `document` bullet for the related failure). **`dayjs` has no plugins loaded** (confirmed: zero uses of `.utc()`/`.tz()`/`.extend()` anywhere in the codebase) — do timezone math by hand (see `view_source_code_updates`'s manual UTC+7 conversion), don't assume a plugin is available. |
| `ctx.sql` | `.save({uid, sql, dataSourceKey})` / `.runById(uid, {type, dataSourceKey})` — **admin/root-gated, silently fails for non-admin roles (§3). Admin-only/dev-tool contexts only** — use the §4.2 wrapper there, never raw calls, and never for regular user-facing features (use `ctx.api` instead). |
| `ctx.api` | `.resource('collection').list({filter,fields,appends,sort,pageSize,page})` / `.get({filterByTk})` / `.create({values})` / `.update({filterByTk,values})` / `.destroy({filterByTk})` — the reliable, non-admin-safe path for both reads and writes (§4). **Except the `fields`/`collections`/`roles` system collections, which are ALSO admin-gated even through this API (§3)** — don't query those at runtime for non-admin-facing features. |
| `ctx.dataSource` / `ctx.dataSourceManager` | `.getDataSource('main').getCollections()` / `.getCollection(name).getField(name)` — schema/enum introspection (§4, §7). Unclear whether this specific API is also role-gated like `ctx.api.resource('fields')` is — hasn't been tested by a non-admin user yet. Treat with the same suspicion until confirmed either way. |
| `ctx.render` | Mounts the component tree — required at the end of every jblock. **Only jblocks get this** — a bare JSAction has no host tree to mount into (§6). |
| `ctx.record` | The current row, in record-scoped contexts (JSAction on a record, column code). |
| `ctx.resource` | `.getSelectedRows()`, `.refresh()` — list/table resource; used from bulk actions and JSActions to refresh after a write. |
| `ctx.message` | Inline feedback, e.g. `ctx.message.warning('...')`. `ctx.message.loading(text, 0)` returns a callable close function for manual dismissal — used for a lightweight "loading" indicator that isn't a second Modal instance (see §6). Not separately confirmed beyond that one usage; treat as likely-fine standard antd `message` API but not exhaustively proven here. |
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
- **When refactoring which part of a UI owns a piece of state or a config key
  (e.g. moving a button from one slot to another), check every other place that
  might still reference the old version.** *(Learned 2026-07, `ui_production_addmarker.js`.)*
  Moving a close button out of `Modal.confirm`'s `title` into `content` but
  forgetting to also clear the old `title: 'Some Text'` string left two stacked
  headers in production. A "drop-in replacement" isn't complete until the
  surrounding call site is checked too, not just the piece being moved.
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
`Modal` (incl. `.confirm()`, `.destroyAll()` — but see §6.1, `.update()` on the
returned handle is confirmed **NOT** reliable), `Drawer`, `Dropdown`, `Select`,
`DatePicker`, `InputNumber`, `Switch`, `Spin`, `message`, `Pagination`, `Upload`,
`Button`, `Table`, `Alert`, `Progress`, `Input`, `Tag`. If a new component or prop
is needed that isn't on this list, it's not necessarily broken — just unverified;
say so explicitly rather than presenting it with full confidence.

- All components use `React.createElement` aliased as `ce` — **never JSX** (no
  transpiler in the sandbox).
- CSS via injected `<style>` tags with scoped class prefixes, to avoid leaking styles
  into the rest of the NocoBase page. **But see §6.1 — don't blanket-kill
  `transition`/`animation` on a Modal via this technique; it can break antd's own
  close lifecycle.**
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

### Two known component patterns for full detail/list UIs — only one is correct

**DETAILS CODE pattern (correct — use for any detail/popup page context):**
`ctx.libs.React`, `async bootstrap()` inside `useEffect`, a `runSql()` helper
(`.save` + `.runById`), rendered through `ctx.render()`. Sections: highlight card,
qty summary (DO/Cut/Sent/QC + diffs, orange = not done / green = done), variant
table (same color logic), permakan (pending orange / done green), activity history
(grouped, variant tags, defect badges). **Update per §3: even in this pattern,
prefer `ctx.api.resource()` over the `runSql()` helper for any non-admin-facing
data — the "correct" part of this pattern is `ctx.render()`-based mounting for a
full detail page, not necessarily the SQL layer itself.**

**COLUMN CODE pattern (only for simple list-column cell renderers, never for a
detail page):**
`ctx.element.innerHTML` with chained `.then()` queries, no React / `ctx.render`.
See `col_production_marker.js` (§8.1) for the current working example — it now
uses `ctx.api.resource()` chains instead of `ctx.sql`, same reasoning as §3.

### 6.1 Modal.confirm gotchas — bare-JSAction record UI, no host Drawer

For a JSAction on a native table (no host `ctx.render()` tree — see §2's JSAction
bullet), a real `Drawer` can't be mounted: there's nowhere to mount it into, and
manually mounting via `document.body`/`ReactDOM` is blocked outright (§3).
`Modal.confirm()` styled via CSS to look drawer-like is the proven pattern instead
(see `ui_material_out.js`, `openDuplicateDrawer` in `ui_production_edit.js`,
`ui_production_addmarker.js`). **Never nest a real `Drawer` inside `Modal.confirm`.**

Several attempts to polish this pattern's loading/animation UX broke core
functionality instead — treat all of the following as **confirmed-broken**, not
just theoretically risky, from building `ui_production_addmarker.js`:

- **Never set `transition: none !important` / `animation: none !important` on a
  Modal's CSS**, even scoped to a custom `className`, even just to kill an unwanted
  enter-animation flash (the default center-fade-zoom looking wrong against a
  CSS-repositioned "drawer" shape). antd's `Modal` close lifecycle appears to
  depend on a CSS transition actually completing before it removes itself from the
  DOM — kill the transition entirely and `Modal.destroyAll()` gets called
  successfully (you may even see antd's default button click-wave ripple fire) but
  the modal never actually disappears. This exact bug shipped and had to be
  reverted. If the enter-animation flash needs addressing at all, shorten the
  transition's duration instead of removing it (`transition-duration: 0.05s !important`),
  and test closing specifically before considering it done.
- **`Modal.confirm()`'s returned handle `.update(newConfig)` does not reliably do a
  shallow merge** in this antd version — calling `.update({ content: newNode })`
  alone appeared to reset other config (`title`, `onCancel`, `maskClosable`) rather
  than merging it, breaking the close button after a content swap. **Not on the
  confirmed-working list — avoid it.** If a modal's content must change after the
  initial call (e.g. swapping a loading spinner for real data once a module
  finishes loading), don't manage that via the Modal's own config after the fact;
  keep a single mounted content component and let *it* handle its own internal
  loading state instead (see how `MarkerContent` handles `fetchSummary` internally).
- **`Modal.destroyAll()` immediately followed by a fresh `Modal.confirm()` call is
  not safe either** — the two are not fully synchronous with each other. Calling
  them back-to-back (e.g. to swap a loading modal for the real one) can leave two
  modal instances briefly overlapping: stacked masks read as "the screen got
  darker"; a stale, invisible leftover mask blocks clicks on the new modal —
  "nothing is clickable" even though content is visibly rendered underneath. This
  also shipped and had to be reverted.
- **The net result of the two bullets above: don't try to show an intermediate
  loading state via a second Modal instance at all.** Either accept a brief gap
  with nothing shown while a module loads via `loadCode` (usually fast, and the
  module-level `_codeCache` makes repeat opens on the same page instant), or use a
  non-modal indicator like `ctx.message.loading(text, 0)` (a toast, not a Modal —
  see §4.3) for interim feedback, and make exactly **one** `Modal.confirm()` call
  per user action, full stop.
- **Prefer putting all interactive elements (buttons, links) inside a
  `Modal.confirm`'s `content`, not its `title`.** `content` is a normal React
  subtree and is the proven-working path. An interactive element inside `title`
  was suspected as a cause of a close-button failure at one point — it turned out
  the actual cause was the transition-CSS bug above, not the title slot itself —
  but the uncertainty wasn't worth carrying regardless, since `content` is
  unambiguously safe and there's no upside to using `title` for anything but plain
  text.
- If you do need a header row with actions/close button inside `content` (rather
  than relying on antd's own title bar), just render it as the first element of
  your content component — see the top of `MarkerContent` in
  `ui_production_addmarker.js` for the current working example.

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

Schema-adjacent notes worth keeping here since they're about *behavior*, not
column names:
- All production FKs are standardized to `fk_production_id`.
- `material_ledger` captures supplier **per transaction** (a point-in-time
  snapshot), because the supplier for a given material can change over time —
  don't assume the current material's supplier FK reflects historical
  transactions.
- **`product.model` is often not set at production-creation time — it gets fixed
  later, after the fact.** Any feature that wants to group/match records by model
  (e.g. marker reuse across products sharing a model, see §8) needs a validity
  check before trusting it: a bare "brand-letter(s) + digits" value like `O41`
  with nothing after it is a temporary placeholder, not a real model — reject it
  with something like `!/^[A-Za-z]+\d+$/.test(model.trim())`. A real model has
  content after that prefix, e.g. `O41Seville`. See `isValidModel()` in
  `ui_production_addmarker.js`.
- **`product.code` is fixed at creation time and is always available immediately**
  — unlike `model` above. Prefer keying cross-product matching logic off `code`
  (or an explicit mapping table like `product_marker`) rather than `model` alone
  when something needs to work from the moment a production/product is created,
  not just after a model gets assigned later.

---

## 8. Registry — current components

> File names below match the repo exactly, including inconsistent `.js` extensions
> (some rows have one, some don't — harmless, not worth normalizing yet; see §9 if
> you want to clean it up).

### `source_code` rows (shared logic, compiled via `new Function`, loaded with `loadCode`)

| File | NocoBase row name | Purpose |
|---|---|---|
| `source_code/ui_list_engine.js` | `ui_list_engine` | Generic list/card/drawer engine; views are thin configs on top of it (was `kano_listview`). Exposes a `banner(data)` hook for warning banners. `FormDrawer`/`DetailDrawer` optionally accept `config.DrawerShell` (from `lib_drawer_shell`) — if set, uses the shared drawer chrome; if not, falls back to its original rendering unchanged, so older callers are unaffected. |
| `source_code/lib_drawer_shell.js` | `lib_drawer_shell` | Shared Drawer chrome for **jblock-hosted** drawers only (needs a real host React tree via `ctx.render()`) — explicit close button (not reliant on antd's default `Drawer` close icon, unverified in this environment), consistent header/footer/accent-bar layout, and a `loading` prop so callers can mount the Drawer immediately instead of returning `null` pre-mount (which causes a "popup then snaps into place" visual bug — see the jblock loaders below). **Does NOT apply to bare-JSAction `Modal.confirm`-hosted UI (e.g. `ui_production_addmarker.js`) — there's no host tree for a real `Drawer` to mount into in that context; see §6.1 instead.** |
| `source_code/ui_production_detail.js` | `ui_production_detail` | Canonical production detail. Self-contained: `{ productionId, onClose }`, fetches its own data. All entry points render this identical experience. Includes a Result History accordion section. |
| `source_code/ui_production_edit.js` | `ui_production_edit` | Production new/edit drawer. **Still on the older `.save()/.runById()` `runSql` pattern and its own `getRels()` — not yet migrated to `ctx.api.resource()` per §3's admin-gating fix, and not yet given `DrawerShell` support. Flagged as outstanding — migrate next time this file is touched.** |
| `source_code/ui_production_material_detail.js` | `ui_production_material_detail` | Material detail + edit drawer (project mirror was previously misnamed `..._details` plural; the row name is singular). |
| `source_code/ui_production_addmarker.js` | `ui_production_addmarker` | Production Marker summary + creation/reuse panel. Bare-JSAction-hosted (`Modal.confirm`, see §6.1) — no `DrawerShell`, by design. Reads/writes entirely via `ctx.api.resource()` (§3/§4, not `ctx.sql`). Marker↔product mapping is a real many-to-many via the `product_marker` collection (plain FK columns, no relations configured on it), matched in tiers: same product code → same (valid) `model` → manual product-code lookup. Exports `{ openModal, fetchSummary, searchByProductCode, isValidModel, MarkerContent }`. |
| `source_code/ui_record_nav.js` | `ui_record_nav` | Cross-record replace-navigation host. Mount one per view root; cross-links close current + open target (never stacks). Depends on both detail components + `ui_production_edit`. |
| `source_code/ui_prepare_fabric.js` | `ui_prepare_fabric` | Prepare-fabric modal + PDF (was `preparefabric`). `buildFabricPdf` is the future `lib_pdf` extraction candidate — split only once a second PDF consumer exists. |
| `source_code/ui_material_out.js` | `ui_material_out` | Material-out modal. Exports `openModal({ctx,pmId,onSaved})`, `fetchSummary(ctx,pmId)`, `renderSummary(data)`, `isAccType(type)`. |
| `source_code/ui_match_production` | `ui_match_production` | Reusable match-production module. Exports `openMatchModal`, `fetchMatchData`, `applyMatches`. **Not deployed/tested yet — no `act_match_production` shell exists. Deliberately for later stage; see §9.** |
| `source_code/ui_import_material_details` | `ui_import_material_details` | Bulk-CREATE `material_details` rows from an uploaded CSV (`code`, `fk_material_code`, `variant`, `supplier_variant_code`). Create-only — existing `code` is skipped and reported, no overwrite path. |
| `source_code/ui_import_product_main_material` | `ui_import_product_main_material` | Bulk-import `product.fk_main_fabric_code` from an uploaded CSV (`code`, `material_code`). Classifies each row: blank → ignored, `code` not found → new `product` row created, already matches → no-op, currently empty → auto-updates, differs (non-empty) → conflict table with opt-in checkboxes before overwrite. |
| `source_code/ui_import_product_material` | `ui_import_product_material` | Bulk-CREATE `product_material` rows from an uploaded CSV (`product_code`, `material_code`, `quantity`). |
| `source_code/product_measurement.js` (jblock, listed here for context) | `product_measurement` | Product Measurement list/card/detail, thin config over `ui_list_engine`. First place the `ctx.sql` admin-gating problem (§3) was independently documented, and first place the `fetchAllPages`/`fetchByIn` resource-based pattern originated from. Its `NewDrawerLoader`/`EditDrawerLoader` now preload `lib_drawer_shell` alongside their target module and mount the real `New/EditMeasurementFormBody` inside one persistent `DrawerShell` instance — see `ui_product_measurement_add.js`/`ui_product_measurement_edit.js` below. |
| `source_code/ui_product_measurement_add.js` | `ui_product_measurement_add` | New Product Measurement — form/grid/paste UI. Exports `{ ProductMeasurementNewDrawer, openModal, NewMeasurementFormBody }`. `NewMeasurementFormBody` is the content-only piece (no Drawer chrome), exported specifically so the jblock's loader can host it inside one persistent `DrawerShell` across the whole loading→loaded lifecycle rather than swapping Drawer instances (see §6.1's underlying lesson — same "don't swap the outer container" principle, just for a real `Drawer` this time, not a `Modal.confirm`). `createProductMeasurement` writes `fk_product_measurement_variant_id`/`fk_product_measurement_id` as raw FK columns directly — no `getRels()` call, per §3. |
| `source_code/ui_product_measurement_edit.js` | `ui_product_measurement_edit` | Edit Product Measurement. Exports `{ ProductMeasurementEditDrawer, EditMeasurementFormBody }`. Same content/wrapper split as the New file, with the footer lifted via an `onFooterChange` callback since Edit's Cancel/Save live in a sticky Drawer footer slot (New's are just inline at the bottom of content — a pre-existing, intentionally-untouched difference between the two files). `updateProductMeasurement` also writes raw FK columns directly, same fix as New. |

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
| `jblock/view_production.js` | `view_production` | Thin domain config → `ui_list_engine` (SQL, status colors, card layout, detail/edit loaders, mounts `ui_record_nav`). **Likely has the same `NewDrawerLoader`/`EditDrawerLoader`-returns-null pattern that caused the "popup then drawer" bug in `product_measurement.js` — not yet audited/migrated to `lib_drawer_shell`. Flagged as outstanding; migrate next time this file is touched.** |
| `jblock/view_production_material.js` | `view_production_material` | Thin domain config → `ui_list_engine` for `production_material`. Same outstanding-migration flag as `view_production.js` above. |
| `jblock/view_production_result` | `view_production_result` | Production result list. Full SQL layer, card/detail/form layouts, 7 secondary filters, 4 bulk actions (including Match Production). Same outstanding-migration flag. |
| `jblock/product_measurement.js` | `product_measurement` | See the `source_code` table above — listed there instead since most of what's notable about it is about the modules it loads. |

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
| `jsaction/act_production_marker.js` | `act_production_marker` | Thin shell → `ui_production_addmarker`. Deliberately minimal: `loadCode` then `openModal`, plus a `ctx.message.loading` toast for feedback while the module loads — **not** a second Modal instance (see §6.1 for why that was tried twice and reverted twice). |
| `jsaction/act_import_material_details` | `act_import_material_details` | Table-level action, thin shell → `ui_import_material_details`. Attach to the `material_details` list block's toolbar. |
| `jsaction/act_import_product_main_material` | `act_import_product_main_material` | Table-level action, thin shell → `ui_import_product_main_material`. Attach to the `product` table block's toolbar. |
| `jsaction/act_import_product_material` | `act_import_product_material` | Table-level action, thin shell → `ui_import_product_material`. Attach wherever `product_material` rows are managed. |

**Not yet built:** `act_match_production` (shell for `ui_match_production`) — the
module exists but isn't wired to a JSAction row yet, deliberately deferred; see §9.

### JS Column code (inline field settings — not its own DB row)

Not `source_code`/`jblock`/`JSAction` — this code is pasted directly into a table
field's "JS Column" settings in NocoBase and has no `loadCode`-able name. Listed
here for completeness since the registry above would otherwise have no record of
it at all.

| File | Attached to | Purpose |
|---|---|---|
| `column/col_production_marker.js` | Production table, a column showing linked markers | Follows the COLUMN CODE pattern (§6): `ctx.element.innerHTML` with chained queries, no React/`ctx.render`. Reads via `ctx.api.resource()`, not `ctx.sql` (§3). Sorts marker rows via `BigInt(id)` comparison, not plain numeric subtraction (§4). |

### 8.1 Direct raw URLs — fetch these exactly, don't construct your own

Every URL below is literal and exact. See the note at the top of this file for
why that matters (web-fetch tools reject constructed/edited URLs).

**⚠️ Placeholder URLs below for files added this session** (`ui_production_addmarker.js`,
`lib_drawer_shell.js`, `act_production_marker.js`, `col_production_marker.js`, and
the two `ui_product_measurement_*` files if not already committed) — these follow
the repo's existing folder/naming convention but haven't been verified to exist at
these exact paths yet. **Andre: confirm the actual paths after committing and fix
this list in the same commit**, per the standing rule at the bottom of this
section.

**`source_code/`**
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_list_engine.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/lib_drawer_shell.js *(placeholder — confirm path)*
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_production_detail.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_production_edit.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_production_addmarker.js *(placeholder — confirm path)*
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_production_material_detail.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_record_nav.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_prepare_fabric.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_material_out.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_match_production
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_import_material_details
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_import_product_main_material
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_import_product_material
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/product_measurement.js *(placeholder — confirm path; may live under jblock/ instead)*
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_product_measurement_add.js *(placeholder — confirm path)*
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/source_code/ui_product_measurement_edit.js *(placeholder — confirm path)*

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
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_production_marker.js *(placeholder — confirm path)*
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_import_material_details
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_import_product_main_material
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_import_product_material

**`column/`** *(new folder — placeholder, confirm/create as needed)*
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/column/col_production_marker.js *(placeholder — confirm path)*

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

**This list must be kept current by hand** — unlike the registry tables, there's
no tool that regenerates it. Whenever a file is added/renamed in the repo, add/fix
its line here in the same commit, or this section silently goes stale and
reintroduces the exact problem it's meant to solve. **This is doubly true for the
placeholder entries added this session — resolve them at the next commit, don't
let them linger.**

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
- **Migrate `ui_production_edit.js` off raw `ctx.sql`/`getRels()` onto
  `ctx.api.resource()`**, per §3 — same fix already applied to
  `ui_production_addmarker.js` and the `ui_product_measurement_*` files, not yet
  applied here. Also give it `DrawerShell` support (currently builds its own
  `Drawer` directly, no `config.DrawerShell` opt-in like `ui_list_engine.js`'s
  `FormDrawer`/`DetailDrawer` now have).
- **Audit `view_production.js`, `view_production_material.js`, and
  `view_production_result` for the same `NewDrawerLoader`/`EditDrawerLoader`-returns-null
  pattern** that caused the "popup then drawer" bug in `product_measurement.js`,
  and migrate to `lib_drawer_shell` the same way, if present.
- **Clean up the 6 legacy `product_marker` rows** created back when that
  collection's second FK column meant `product_variant.code` instead of its
  current meaning, `product.code` — those rows' values no longer match anything
  going forward. Either delete them or manually correct them to real `product.code`
  values.
- **Resolve the placeholder raw URLs in §8.1** — added this session for files not
  yet confirmed to exist at those exact paths in the actual repo.

**On the horizon:**
- Possible future split of `ui_prepare_fabric` into a logic layer + a `lib_pdf`
  layer — only once a second consumer needs the PDF builder (extract-on-second-use).
- Desktop adaptive branch for a full-screen detail page (currently deferred in favor
  of the single bottom-sheet mobile pattern everywhere).
- Optional cleanup: normalize the inconsistent `.js` extensions across repo files
  (some rows have it, some don't — cosmetic only, not urgent). See §2 for how to
  rename a file on GitHub if/when this gets done.
- Whether `ctx.dataSourceManager.getCollections()`-style schema introspection is
  also role-gated like `ctx.api.resource('fields')` turned out to be — not yet
  tested from a non-admin account. Worth confirming given how central this API is
  to `view_database_schema_dump` and the whole schema-refresh ritual (§2).

---

## 10. Facebook Ads → NocoBase pipeline

Separate Node.js project, mirrored in this repo at `fb-ads-sync/` (see §8.1 for
direct file URLs) and run from `~/fb-ads-sync` on the Unix host. Not NocoBase
code — no `loadCode`/`jblock`/`JSAction` conventions apply here, it's plain
Node.js run via cron/manually.

Files (as of last check — this list can drift, prefer cloning if it matters):
`sync.js`, `backfill.js`, `creatives.js`, `lib/facebook.js`, `lib/transform.js`,
`lib/nocobase.js`, `lib/creatives.js`.

- Always run scripts from the `~/fb-ads-sync` project root, not from inside `lib/`.
- NocoBase upsert uses the `:updateOrCreate` endpoint with `filterKeys[]` for
  idempotent upserts keyed on `(ad_id, date)`.
- Use the `pickConv` / `pickRevenue` fallback pattern: try CPAS arrays first, fall
  back to pixel arrays.
- Backfill: `BACKFILL_SINCE=2024-01-01 node backfill.js` run from the project root.
- See §4 above for the CPAS/Shopee conversion-data gotcha.

**Secrets: `.env` is gitignored, not committed.** This repo is public. Real
credentials (`ACCESS_TOKEN`, `NOCOBASE_API_KEY`, etc.) must never be committed —
if `.env` was ever accidentally committed, the fix is rotating the credentials
immediately, not just deleting the file (git history keeps old commits
retrievable regardless of later deletions). `node_modules/` and `*.log` are also
gitignored — regenerate with `npm install`, don't commit dependencies.

---

## 11. Working style / how Claude should operate on this project

- Deliver code in modular structure: shared helpers → data-fetching layer → small
  presentational sub-components (called via `createElement`, not plain functions)
  → thin composition root.
- On iteration, provide a **complete drop-in replacement of the specific named
  component**, not a full-file rewrite of unrelated things. **And check every other
  place that might still reference what changed** — see the new bullet under §5;
  a duplicated header shipped once from skipping this.
- One concrete step at a time, with confirmation before moving to the next —
  don't jump ahead of unconfirmed prerequisites.
- **Be explicit about whether a change is a bug fix or a standardization/polish
  change.** *(Learned 2026-07, directly requested after some back-and-forth where
  this wasn't clear.)* These carry different risk profiles — a fix addresses
  something confirmed broken; a standardization change touches something already
  working, purely for consistency/polish, and therefore carries all the risk with
  none of the urgency. Say which one a change is *before* making it, not just in
  hindsight.
- **Cosmetic/UX polish on top of already-working functionality is lower priority
  than it feels, and each attempt is a real chance to break something that
  worked.** *(Learned 2026-07, `ui_production_addmarker.js`'s Modal.confirm saga —
  see §6.1.)* Two separate attempts to polish a loading/animation transition broke
  actual functionality (the close button) in ways that took several follow-up
  turns to diagnose and fix. When a cosmetic improvement carries real functional
  risk and the underlying mechanism is unverified (§6's "unverified, say so"
  rule), lean toward leaving working code alone, or make the smallest possible
  change and explicitly flag the tradeoff before shipping it — don't chain
  multiple speculative fixes on top of each other hoping one sticks.
- Always remind Andre, at the end of a session, to (a) paste the finalized code into
  the matching NocoBase row and (b) commit the same change to this GitHub mirror, so
  the canonical source stays in sync with the live runtime.
- Before writing SQL or a `belongsTo` payload against a table you haven't touched
  recently, fetch the schema file (§7) — don't assume field/relation names match
  the collection name (§4.1). **And per §3: once confirmed, hardcode it rather than
  re-resolving it at runtime for anything non-admin users will hit.**
- **Claude cannot execute this code against the live NocoBase instance** — there's
  no test environment reachable from chat. All code is written from documented
  patterns and prior working examples, not verified by actually running it. Flag
  assumptions and untested edges explicitly in the response rather than presenting
  code as guaranteed-correct — the paste-by-Andre → report-errors-back loop *is*
  the verification step, by design, not a sign something went wrong. **When that
  loop reports something broken, prefer the smallest fix that addresses the actual
  reported symptom over a broader rework — see the bullet above about cosmetic
  polish risk.**

---

## 12. Footer

Public repo: `github.com/ricardoandre/kanoerp`. Structure: `source_code/`, `jblock/`,
`jsaction/` folders, mirroring the NocoBase row types above. Schema lives in a
separate file — see §7.
