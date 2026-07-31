# Internal Production System — code mirror

Canonical mirror of the inline React (`jblock`) and `source_code` components for an
internal production-management system on NocoBase. **NocoBase is the live source of
truth** (it executes the code); this repo is the history + context mirror **and the
onboarding doc for any new Claude session**.

> **For a new chat AI reading this first:** read this whole file before writing any
> code. It contains the sandbox constraints, the architecture rules, and the mistakes
> we've already made and fixed.
>
> **Constraints in §3 are empirically verified**, not assumed — they come from
> `view_sandbox_probe` (§8), which executes each one and reports what actually
> happened. If you believe a constraint is wrong, **add a probe and re-run it**
> rather than arguing from this document. Everything marked *unverified* is
> explicitly untested; say so rather than presenting it confidently.
>
> **On getting files without asking Andre:** if you have bash/code-execution
> access, `git clone` the repo yourself (§2). If you only have a web-fetch tool,
> note that most such tools can only fetch a URL that already appears *literally*
> in the conversation — **a URL you construct by editing another URL's path will
> be rejected**. §8.1 lists exact literal raw URLs for this reason.

---

## 0. Correction log — claims this file previously got wrong

Kept visible so the same wrong assumptions don't get reintroduced.

| Was claimed | Verified reality | When |
|---|---|---|
| `window.*` fully blocked | Per-property allowlist; the object exists and most reads work | 2026-07-31 |
| Writing to any global throws (SES lockdown) | Global writes **succeed** | 2026-07-31 |
| `setTimeout` blocked in jblocks | **Works**, as does `setInterval` | 2026-07-31 |
| `window.addEventListener` never usable | Attaches fine | 2026-07-31 |
| dayjs has no plugins loaded | `.utc()` and `.tz()` **both exist** | 2026-07-31 |
| antd version unknown (v4 vs v5) | **antd 5.24.2**, React 18.2.0 | 2026-07-31 |
| `jblock` / `JSAction` are NocoBase tables | Only `source_code` is a collection; the rest live in `uiSchemas` | 2026-07-31 |
| Never send a raw FK value alone | `fk_*` are first-class string fields; raw writes work unless the relation is required | 2026-07-31 |

**Method note:** several of these were originally inferred from *absence of usage in
the codebase* ("zero uses of `.utc()` anywhere, therefore no plugins"). That is not
evidence. Absence of use means nobody tried. Only a probe counts.

---

## 1. What this project is

An **internal garment production management system**, built as inline JavaScript
pasted directly into **NocoBase** (self-hosted, Jakarta timezone, `DD/MM/YYYY`
dates). No filesystem deployment.

It tracks productions across two internal brands (product code prefix `A` vs `O`)
through statuses: `planning → cutting → production → QC → permak → done`. Core
entities: productions, konveksi (external partners), products/SKU variants,
materials, samples, delivery/QC results, permakan (alteration/rework).

Separate components: a **Facebook Ads → NocoBase pipeline** (`~/fb-ads-sync`,
Node.js), an **Instagram pipeline** (`ig-sync/`), and a **Shopee ads pipeline**
(`shopee-ads-sync/`, Python).

### 1.1 Where code actually lives — only one collection is queryable

**`source_code` is the ONLY code-bearing NocoBase collection** (primary key `name`,
fields `name` / `code` / `createdAt` / `updatedAt`). It is queryable via
`ctx.api.resource('source_code')` and raw SQL.

`jblock`, `JSAction`, and `jscolumn` code is **not** in a collection — it lives
inside NocoBase's `uiSchemas` tree as page/block configuration. It cannot be listed
or audited through the normal data API. Any tool that wants to scan "all the code"
can therefore only reach `source_code` rows.

**Column naming:** this instance runs NocoBase with underscored columns. Field
`updatedAt` is column `updated_at`; `createdById` is `created_by_id`. Use camelCase
with `ctx.api.resource(...)`, snake_case in raw SQL. Both appear throughout the
codebase and both are correct in their own layer.

---

## 2. Sync workflow (steady state)

1. Code is generated/edited in a Claude session.
2. Paste into the matching NocoBase row (it runs immediately).
3. Commit the same change here — paste-and-commit, no delete/reupload.
4. Next session: clone fresh, or share raw URLs of the files in play.

```
git clone --depth 1 https://github.com/ricardoandre/kanoerp.git
find kanoerp -type f -not -path '*/.git/*'
```

**Deployment mechanics:**
- **`jblock`** → new **Page** → one custom-code block → paste. One page = one jblock.
- **`JSAction`** → a button action on a *native* NocoBase table block, pointed at the
  JSAction row.
- **`jscolumn`** → cell renderer code on a native table column.
- A `source_code` row is never placed on a page — only loaded via `loadCode(ctx, name)`.

**Compilation signatures differ.** A `source_code` row is compiled as
`new Function('React','antd','dayjs','ctx', src)` — those four are parameters, so
you reference `React` bare. A `jblock` receives only `ctx` and must destructure
`const { React, antd, dayjs } = ctx.libs;` itself. Code written for one context will
not run in the other without adjustment.

**Session close ritual:** end every session with an explicit "changed this session"
list — which rows to paste, which files to commit.

**Schema refresh ritual:** run `view_database_schema_dump` (§8), paste the output
into a Claude chat with "update the schema file." Never hand-edit from memory (§4.1).

**Mirror drift is real:** as of 2026-07-31 there are **45 live `source_code` rows but
only 29 in this mirror**. Run `view_source_code_updates` (§8) and reconcile before
assuming the mirror is complete.

---

## 3. Sandbox constraints — VERIFIED, not assumed

The sandbox is a **per-property allowlist proxy**, not a blanket block. `window` and
`document` both exist as objects; individual properties are gated and throw
`Access to global property "X" is not allowed.` when denied. This is why
blanket rules ("never touch `window`") were wrong and kept getting contradicted by
working production code.

Re-verify any of this with `view_sandbox_probe` (§8).

### 3.1 Denied — these throw

| Expression | Error |
|---|---|
| `window.innerWidth` | Access to global property "innerWidth" is not allowed |
| `window.print` | Access to global property "print" is not allowed |
| `window.location.href` | Reading location.href is not allowed |
| `document.body` | Access to document property "body" is not allowed |
| `document.execCommand` | Access to document property "execCommand" is not allowed |
| `new FileReader()` | TypeError: FileReader is not a constructor |
| `new FormData()` | TypeError: FormData is not a constructor |

⚠️ **`window.FormData` *reads* as a function but is not constructible.** A truthiness
check on it therefore passes and then `new FD()` throws. See §9 — this affects
`lib_attachment_upload`.

### 3.2 Absent — undefined, don't feature-detect against a throw

`fetch`, `queueMicrotask`, `localStorage`.

No `fetch` means **external libraries cannot be loaded** (no CDN, no binary parser
like SheetJS). Users must convert `.xlsx`/`.xls` to CSV before upload. This
conclusion is unchanged — only the reason is corrected (absent, not blocked).

### 3.3 Allowed — verified working

| Expression | Result |
|---|---|
| `typeof window` / `typeof document` | `object` |
| `window.location.origin` | `http://app.kano.id` |
| `window.addEventListener` | attaches fine |
| `window.x = 1` / `globalThis.x = 1` | **writes succeed** |
| `document.createElement('a')` | works — the download pattern |
| `new Blob([...])` / `Blob.prototype.text()` | work |
| `setTimeout` / `setInterval` | **work**, return numeric handles |
| `console` / `console.error` | available |
| `navigator` / `navigator.clipboard` | available (object) |

**`window.open('about:blank')`** returns falsy without throwing — neutered, not
blocked. Don't rely on it.

**On global writes:** they work, but **don't use them for module sharing anyway**.
Shared logic goes in `source_code` rows loaded via `loadCode` (§5) — that's an
architectural rule about single-canonical-version, not a sandbox limitation.

**On `navigator.clipboard`:** available, so copy-to-clipboard is viable. Existing
dev tools use a read-only `<textarea>` for copy-paste; that predates knowing this.
Not urgent to change, but new tools can use the real API.

### 3.4 Still a genuine constraint

**Concurrent `ctx.sql.save`/`runById` pairs with *generated* uids collide.**
*(Learned 2026-07-02.)* Firing several dynamic-uid SQL calls at once via
`Promise.all` throws `"invalid sql schema uid used"`.

The dangerous kind is a uid that is **new on every call** — anything containing
`Date.now()`, a counter, or a random value. A uid that is dynamic but *stable per
record* (`'prefix_' + recordId`) is fine, as are multiple fixed distinct uids fired
concurrently (`ui_production_edit`'s four parallel lookups are proven safe).

Fix: combine into one query (`UNION ALL`) under a single stable uid, or serialize.

⚠️ A throwaway uid also **persists a new saved SQL schema record on every
invocation** — an unbounded leak, independent of the collision risk.

### 3.5 JSX

No transpiler. Use `React.createElement` (conventionally aliased `ce`). This is a
build-pipeline fact, not a sandbox proxy rule.

---

## 4. NocoBase API patterns

- **Database engine: MySQL.** Backtick-quote reserved words; standard MySQL date
  functions.
- **SQL:** `ctx.sql.save(uid, sql)` → `ctx.sql.runById(uid)`. See §4.2 for the
  canonical wrapper and §3.4 for uid rules.
- **Writes:** `ctx.api.resource('collection').create({ values: {...} })` is the
  reliable path; avoids snowflake-ID issues that raw SQL `INSERT` hits.
- **belongsTo:** `fk_*` columns are declared as **first-class string/bigInt fields
  alongside** the relation, so writing a raw FK value directly **works** — this is
  what all three `ui_import_*` modules do in production. A nested payload
  (`{ relName: { targetKey: value } }`) is required only when the relation is
  marked required, where a raw write fails validation. Prefer the nested form for
  new code; don't treat existing raw writes as bugs.
- **Image/attachment fields** are relations through obfuscated junction tables
  (`t_xxx`). Use `appends: ['image']`, or JOIN junction → attachments via SQL.
  Attachment records carry a populated `url`; prefer
  `row.url || (row.filename ? '/storage/uploads/' + row.filename : '')`. Relative
  URLs work directly in `<img src>` — **no `window.location.origin` needed**, and
  the relative form survives origin/proxy changes. (Three files still build an
  absolute URL from `origin`; both work, the relative one is preferred.)
- **Enum / single-select options** resolve via
  `ctx.dataSourceManager.getDataSource('main').getCollection(...).getField(...).enum`
  — not via SQL. `lib_enum_labels` wraps this.
- **Schema introspection:** `ctx.dataSource || ctx.dataSourceManager.getDataSource('main')`
  → `.getCollections()` gives every collection synchronously. Authoritative for
  relation types/targets/keys. Raw-SQL `information_schema` FK introspection is
  **unreliable** — most relations are enforced at the application layer, not as DB
  foreign keys, so an FK dump comes back nearly empty.
- **CPAS / Shopee-integrated ad accounts:** conversions appear only in
  `catalog_segment_actions` / `catalog_segment_value`. Ad-level (`ads_insights`) is
  the only reliable source for conversion rollups.

### 4.1 Relation field names are not predictable

NocoBase relation accessor names frequently differ from both the target collection
name and the FK column name. Verified live examples:

- `sample_variant.fk_sample_variant_id` is the FK pointing at **`sample`** — despite
  the name suggesting a self-reference. The accessor is `sample`.
- `sample.sample_variant` is a `hasMany` to `sample_variant` with
  `foreignKey=fk_sample_variant_id`.
- `sample.comment` (singular) is the `hasMany` to `sample_comment`.
- Attachment relations use obfuscated junction/FK names (`f_57nmxuosclw`,
  `t_wda3bnmr9c9`).
- Some tables carry legacy duplicate raw audit columns beside the standard
  `createdBy`/`updatedBy` belongsTo pair — prefer the pair.

**Rule:** before a nested-payload write or an `appends:`, check the actual field
name in the schema file (§7). Never recall it from memory. `view_code_audit` (§8)
validates every `appends` name against live metadata automatically.

### 4.2 Canonical `runSql` / `execSql`

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

`ctx.flowSettingsEnabled` gates whether `.save()` runs. **Probed value: `true`** in a
normally-rendered jblock page — so the guard is not simply "false at runtime." Its
full semantics remain unexplained; copy the pattern as-is.

⚠️ **The `.catch()` handlers make failures invisible.** A collision or SQL error
returns `[]`, which renders as "no data" rather than an error. When debugging a
section that renders empty but shouldn't, temporarily replace the catch with
`.catch(e => { console.error('SQL FAIL', uid, e); return []; })` — `console` is
available (§3.3).

### 4.3 `ctx` surface — confirmed members

| Member | Use |
|---|---|
| `ctx.libs` | `{ React, antd, dayjs }`. **antd 5.24.2, React 18.2.0.** dayjs **has `.utc()` and `.tz()` available** — you do not need manual offset math. (Existing files do it by hand; that predates verification and still works.) |
| `ctx.sql` | `.save({uid, sql, dataSourceKey})` / `.runById(uid, {type, dataSourceKey})` — use the §4.2 wrapper. |
| `ctx.api` | `.resource(name).list/get/create/update`, `.request(cfg)` — the reliable write path. |
| `ctx.dataSource` / `ctx.dataSourceManager` | `.getDataSource('main').getCollections()` / `.getCollection(n).getField(n)`. |
| `ctx.render` | Mounts the component tree — required at the end of every jblock. |
| `ctx.record` | Current row, in record-scoped contexts. |
| `ctx.resource` | `.getSelectedRows()`, `.refresh()`. |
| `ctx.message` | Inline feedback. |
| `ctx.notification` | Toast feedback — more prominent than `ctx.message`. Convention not formalized. |
| `ctx.flowSettingsEnabled` | Gates `ctx.sql.save()` (§4.2). Probed `true`. |
| `ctx.t` | i18n. Unclear if translation is configured; treat as optional. |

---

## 5. Architecture principles

- **Extract-on-second-use.** Write inline first; promote to `source_code` on the
  second genuine need.
- **Downward-only dependencies:** `ui_` → `fn_` → `lib_`. Never sideways or circular.
- **Stable contracts per module.** One-line comment at the top stating input/output
  shape. Never bolt caller-specific props onto a shared component.
- **Single canonical version.** Edit shared modules in place; no forked copies.
  **Exception:** the `loadCode` bootstrap is necessarily duplicated in every file
  that loads modules — it cannot load itself. Keep the copies textually identical
  (including the `_codeCache` variable name; one file currently drifts to
  `_moduleCache`).
- **Rename in place, never delete-and-recreate jblocks.** Block UIDs feed filter
  controllers.
- **Jblock names ≠ importable strings.** Only `source_code` rows load by name.
- **Naming**, underscore-separated (slashes are invalid in flowSql uids):
  - `ui_` / `fn_` / `lib_` → `source_code`
  - `view_` → `jblock` · `act_` → `JSAction` · `col_` → `jscolumn`
  - *(Some existing rows use hyphens, e.g. `col-sample-details`,
    `view-sample-variant-details`. Legacy; don't copy.)*
- **`ctx` is always threaded as a function parameter**, never captured at compile time.
- **Change scope discipline:** full-file replacement for widespread changes; targeted
  find/replace for small ones.

  ⚠️ A careless global find/replace has already corrupted a file
  (`ui_sample_details` contains `vierunSqlw_sample_dashboard_summary` where `view_`
  was meant). After any bulk replace, re-read the diff.
- **Mockup before implementation** for any new UI layout.
- **Preview before writing, opt-in before overwriting.** Any bulk-write/import
  feature must classify rows (new / no-op / conflict), show a preview, and require
  explicit opt-in before overwriting non-empty data. Hard rule.

---

## 6. UI conventions

**antd is 5.24.2** (Ant Design v5), React 18.2.0 — exposed via `ctx.libs`. v5 APIs
are safe to use. Confirmed-working components: `Modal` (incl. `.confirm()`,
`.destroyAll()`), `Drawer`, `Dropdown`, `Select`, `DatePicker`, `InputNumber`,
`Switch`, `Spin`, `message`, `Pagination`, `Upload`, `Button`, `Table`, `Alert`,
`Progress`, `Input`, `Tag`.

- All components use `React.createElement` aliased `ce` — **never JSX**.
- CSS via injected `<style>` tags with scoped class prefixes.
- Any scrollable popup/drawer/sheet ends with a ~80–120px spacer div.
- **File upload:** get the `File` from antd `Upload`, call `.text()` on it
  (`Blob.prototype.text` works, `FileReader` does not), parse as delimited text with
  comma/semicolon/tab auto-detection.
- **PDF generation** must not use `window.print` (denied, §3.1). Bundle a pure JS
  PDF writer into a `source_code` row — see `ui_prepare_fabric`.
- **Mobile detail pattern:** single expandable bottom sheet, always-visible main
  details, single-open accordion sub-sections. `Edit` + `•••` top-right.
- **Cross-record navigation** uses *replace*, never stack — via `ui_record_nav`.
- Clickable cross-links: `›` chevron in indigo (`#4338ca`), no underline.
- **Status colors:** planning `#f97316` · cutting/production `#d97706` ·
  QC `#84cc16` · permak `#ef4444` · done `#22c55e`. Orange = pending, green = done,
  zero quantity = orange.

### 6.1 Two component patterns — only one is correct for detail views

**DETAILS CODE (correct):** `ctx.libs.React`, `async bootstrap()` in `useEffect`, a
`runSql()` helper, rendered through `ctx.render()`.

**COLUMN CODE (wrong for detail pages):** `ctx.element.innerHTML` with chained
`.then()` SQL, no React. Only belongs in simple list-column cell renderers.

**Never nest a real `Drawer` inside `Modal.confirm`.** For bare JSAction hosts with
no render tree, use `Modal.confirm` styled to look like a right-side drawer — see
`ui_material_out`, `ui_production_addmarker`, `ui_sample_details.openViewModal`.
Use `display:contents` on antd's confirm wrapper chain rather than trying to
propagate `height:100%` through layers whose nesting varies by version.

---

## 7. Database schema — separate file

**https://raw.githubusercontent.com/ricardoandre/kanoerp/refs/heads/main/kanoerp/Schema%20Dump**

Fetch it at the start of any session touching SQL, `belongsTo` payloads, or
`appends`. Regenerate via `view_database_schema_dump` (§8). Never reconstruct from
memory (§4.1).

Behavioural notes:
- All production FKs are standardized to `fk_production_id`.
- `material_ledger` captures supplier **per transaction** — a point-in-time
  snapshot. Don't assume the material's current supplier FK reflects history.
- Comma joins (`FROM a, b WHERE a.fk = b.id`) are implicit INNER JOINs and appear in
  10+ files. They silently drop rows when the FK is null — e.g. a sample with no
  collection returns zero detail rows. House convention; be aware of it.

---

## 8. Registry

⚠️ **This registry is known to be incomplete.** The repo contains a `jscolumn/`
folder and many `report_*`, `view_sample_*`, `view_fb_*`, `act_*` files not listed
here, and 45 live `source_code` rows vs 29 mirrored. Reconcile with
`find kanoerp -type f -not -path '*/.git/*'` rather than trusting these tables.

### Dev tools (jblock)

| Row | Purpose |
|---|---|
| `view_sandbox_probe` | **Executes every §3 constraint and reports PASS/BLOCKED/ABSENT.** The authority for §3. Re-run after any NocoBase upgrade. |
| `view_code_audit` | Static rule catalog (§3–§6) over every `source_code` row; validates `appends` names against live metadata. Read-only. |
| `view_database_schema_dump` | Copy-pasteable dump of every collection/field/relation. Regenerates §7. |
| `view_database_table_list` | antd `Table` browse of collections. |
| `view_source_code_updates` | `source_code` rows updated since a timestamp — what still needs committing. |

### `source_code` (loaded via `loadCode`)

`ui_list_engine` · `ui_production_detail` · `ui_production_edit` ·
`ui_production_material_detail` · `ui_record_nav` · `ui_prepare_fabric` ·
`ui_material_out` · `ui_match_production` *(not deployed)* · `ui_import_material_details` ·
`ui_import_product_main_material` · `ui_import_product_material` · `ui_sample_add` ·
`ui_sample_details` *(live, not mirrored)* · `ui_product_details` ·
`ui_product_import_code` · `ui_product_variant_import` · `ui_product_bulk_import_image` ·
`ui_product_measurement_add` · `ui_product_measurement_edit` · `ui_production_addmarker` ·
`ui_production_planning_report` · `ui_store_sales_add` · `ui_store_stock_transfer` ·
`ui_fbads_controls` · `fn_fbads_data` · `fn_production_planning_data` ·
`lib_attachment_upload` · `lib_current_user` · `lib_drawer_shell` · `lib_enum_labels` ·
`lib_detail_shell` · `lib_modal_drawer_shell`

All three `ui_import_*` modules share one pattern: `Modal.confirm()` with default
OK/Cancel hidden and custom buttons in `content`, `Modal.destroyAll()` to close,
file read via `Blob.prototype.text()`, delimiter auto-detected.

### 8.1 Direct raw URLs

Literal and exact — fetch these, don't construct your own. **This list is
hand-maintained and lags the repo**; prefer cloning.

- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/README.md
- https://raw.githubusercontent.com/ricardoandre/kanoerp/refs/heads/main/kanoerp/Schema%20Dump
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
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jblock/view_production.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jblock/view_production_material.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jblock/view_production_result
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jblock/view_source_code_updates
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jblock/view_database_schema_dump
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jblock/view_database_table_list
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_material_out.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_prepare_fabric.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_import_material_details
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_import_product_main_material
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/jsaction/act_import_product_material
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/sync.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/backfill.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/creatives.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/lib/facebook.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/lib/transform.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/lib/nocobase.js
- https://raw.githubusercontent.com/ricardoandre/kanoerp/main/fb-ads-sync/lib/creatives.js

---

## 9. Open issues

**Needs verification, possibly breaking:**
- **`lib_attachment_upload` may be broken.** It selects `window.FormData` (which
  reads as a truthy function) and calls `new FD()` — but `FormData` is **not
  constructible** (§3.1). If uploads are failing, this is why; the symptom is its
  own "FormData is unavailable in this context" error. Affects `ui_sample_add` and
  the canvas view. Test before relying on either.

**Confirmed defects:**
- `ui_product_import_code` — `fetchExistingCodes` builds
  `'pci_' + table + '_' + len + '_' + Date.now()` and fires two concurrently via
  `Promise.all`. Textbook §3.4 collision.
- `ui_sample_details` — `fetchComments` uses a `Date.now()` uid inside a
  `Promise.all` with two other dynamic-uid queries. Failures are swallowed to `[]`,
  so the symptom is comments intermittently rendering empty. Its `runSql` also omits
  the `ctx.flowSettingsEnabled` guard despite a comment claiming §4.2 compliance.
- `ui_sample_details` header comment corrupted by a bad find/replace (§5).
- `ui_production_edit` uses `_moduleCache` where every other file uses `_codeCache`.

**Pending features:**
- `ui_result_import`, `ui_result_bulk_add`, plus JSAction shells.
- `act_match_production` — shell for the built-but-undeployed `ui_match_production`.

**Cleanup, non-urgent:**
- Five files still use the pre-§4.2 SQL helper: `fn_fbads_data`, `ui_product_details`,
  `ui_production_planning_report`, `ui_material_out`, `ui_import_material_details`.
- Three files build absolute image URLs from `origin`; eight use the preferred
  relative form.
- Inconsistent `.js` extensions and hyphenated legacy row names.
- Possible `ui_prepare_fabric` → `lib_pdf` split, once a second PDF consumer exists.

---

## 10. Node.js pipelines

Not NocoBase code — no `loadCode`/`jblock` conventions apply.

**`fb-ads-sync/`** (run from `~/fb-ads-sync`): `sync.js`, `sync-today.js`,
`sync-periodic.js`, `backfill.js`, `backfill-periodic.js`, `creatives.js`,
`fetch-status.js`, `lib/{facebook,transform,transform-period,nocobase,creatives,accounts}.js`.
- Always run from the project root, not from inside `lib/`.
- Upserts use `:updateOrCreate` with `filterKeys[]`, keyed on `(ad_id, date)`.
- Use the `pickConv` / `pickRevenue` fallback: CPAS arrays first, then pixel arrays.
- Backfill: `BACKFILL_SINCE=2024-01-01 node backfill.js`.
- See §4 for the CPAS/Shopee conversion gotcha.

**`ig-sync/`**: `sync.js`, `sync-periodic.js`, `sync-stories.js`,
`sync-demographics.js`, `backfill*.js`, `lib/{instagram,ig-accounts,media-images,nocobase}.js`.

**`shopee-ads-sync/`** (Python): `parse_shopee_ads.py`, `nocobase_import.py`.

**Secrets: `.env` is gitignored. This repo is public.** Never commit credentials; if
one leaks, rotate it — deleting the file doesn't remove it from git history.
`node_modules/` and `*.log` are gitignored.

---

## 11. How Claude should operate on this project

- Modular structure: shared helpers → data layer → small presentational
  sub-components (via `createElement`) → thin composition root.
- On iteration, deliver a **complete drop-in replacement of the specific named
  component**, not a rewrite of unrelated code.
- One concrete step at a time, confirmation before the next.
- Remind Andre at session end to (a) paste into NocoBase and (b) commit here.
- Fetch the schema file (§7) before writing SQL or a `belongsTo` payload.
- **Claude cannot execute code against the live NocoBase instance.** Flag assumptions
  and untested edges explicitly rather than presenting code as guaranteed-correct.
  The paste → report-errors-back loop *is* the verification step.
- **When this file and observed behaviour disagree, behaviour wins.** Add a probe to
  `view_sandbox_probe`, run it, and update §0 and §3 with the result. Do not
  reason from this document's claims when a probe could settle it — that is exactly
  how §3 accumulated four wrong constraints.
- **Absence of a pattern in the codebase is not evidence it doesn't work.** It
  usually means nobody tried.

---

## 12. Footer

Public repo: `github.com/ricardoandre/kanoerp`. Structure: `source_code/`, `jblock/`,
`jsaction/`, `jscolumn/`, `fb-ads-sync/`, `ig-sync/`, `shopee-ads-sync/`.
Schema in a separate file (§7).
