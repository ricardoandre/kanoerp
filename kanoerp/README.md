# Internal Production System — code mirror

Canonical mirror of the inline React (`jblock`) and `source_code` components for an
internal production-management system on NocoBase. **NocoBase is the live source of
truth** (it executes the code); this repo is the history + context mirror **and the
onboarding doc for any new Claude session**.

> **For a new chat AI reading this first:** read this whole file before writing any
> code. It's kept short on purpose — the long "how we found out" stories, deprecated
> files, and past mistakes live in `HISTORY.md` instead. Don't repeat mistakes
> described there. Don't propose solutions that violate §3 — they've been tried and
> confirmed broken. The database schema is **not** in this file — see §7.
>
> **On getting files without asking:** if you have bash/code-execution access,
> `git clone` the repo yourself (§2). If you only have a web-fetch tool, note most
> such tools can only fetch a URL that already appears *literally* in the
> conversation — **a URL you construct by editing another URL's path will be
> rejected**, even if the pattern is obvious. Fetching this README puts every file
> URL in §8.1 into the conversation verbatim, so you can fetch any of them
> directly. **Also: GitHub can drift from what's actually live in NocoBase**
> (confirmed once — a stale file sat in this mirror while the real NocoBase row had
> already been fixed). If something a fetched file says looks internally
> inconsistent, ask for it to be pasted directly rather than trusting the fetch.

---

## 0. The things most likely to bite you if you skip them

1. **Sandbox constraints are per-property, not blanket bans** (§3). Four separate
   times, a real narrow finding got written up as a broader "X is blocked/exclusive"
   rule, and the broader version turned out wrong. Test the specific property
   directly (throwaway jblock, `try/catch`, render the result) before trusting an
   inherited claim that doesn't quite match what you're seeing.
2. **`ctx.sql` (raw SQL) is NOT admin-gated** — works for every role, even against
   `fields` directly. The ONE gated thing: `ctx.api.resource('fields')` specifically.
3. **`ctx.model`, `ctx.openView`, `ctx.antd`, `ctx.React`, `ctx.engine`,
   `ctx.useResource` are available on every jblock** — not exclusive to Filter
   Control blocks or files using the `ctx.antd`/`ctx.React` style. Two equally valid
   paths to the same thing.
4. **JSX only works in a jblock's own top-level code.** Never in a `source_code` row
   or JSAction — both compile via `new Function(...)`, no transpiler, JSX there is
   `SyntaxError: Unexpected token '<'`.
5. **`belongsTo` writes need `{ relName: { targetKey: value } }`** — never a raw FK
   value alone; fails required-field validation. Relation field names are NOT
   predictable from the collection name — check the schema dump (§4.1).
6. **`fetch()`, writing to any global, and `new FileReader()` are all blocked**
   (SES lockdown). `Blob.prototype.text()` on an existing `File` IS allowed — the
   proven pattern for reading an uploaded file's contents.
7. **Jblocks can't import each other.** Shared logic lives in `source_code` rows,
   loaded via `loadCode(ctx, name)`.
8. **`product`'s primary key is `code`, not `id`.** Same for `konveksi`,
   `raw_material`, `material_details`.
9. **Two detail-view display standards exist on purpose**: accordion (data-heavy —
   production, sample) and flat/always-expanded (lighter — product details). Don't
   "fix" one into matching the other.
10. **Extract-on-second-use, not before.** A hardcoded list/label map duplicated
   across files WILL drift (this happened at least twice) — but don't pre-abstract
   something used only once.
11. **When something looks broken, ask before assuming.** More than once, a
   "bug" turned out to be intentional and a "fix" turned out to be the actual bug.
   Confirm intent for anything ambiguous before changing it.

---

## 1. What this project is

This is an **internal garment production management system**, built as inline
JavaScript pasted directly into **NocoBase** (self-hosted, Jakarta timezone,
`DD/MM/YYYY` date formatting). No filesystem deployment — every "file" here
corresponds to one row in a NocoBase table (`source_code`, `jblock`, or `JSAction`),
**or, for JS Column code, lives inline in a table field's settings and isn't its own
row at all** (§8.1).

It tracks productions across two internal brands (product code prefix `A` vs `O`)
through statuses `planning → cutting → production → QC → permak → done`. Core
entities: productions, konveksi (external production partners), products/SKU
variants, materials, samples, delivery/QC results, permakan (alteration/rework),
product measurements, markers (fabric cutting layouts), store sales/stock.

A second, unrelated component is a **Facebook Ads → NocoBase pipeline**
(`~/fb-ads-sync`, Node.js) that syncs ad performance data — see §10.

---

## 2. Sync workflow

1. Code is generated/edited in a Claude session.
2. Paste into the matching NocoBase row (it runs immediately — NocoBase is live).
3. Commit the same change here — paste-and-commit, no delete/reupload.
4. Next session: clone fresh, or share the raw URL(s) / paste the file(s) directly.

```
git clone --depth 1 https://github.com/ricardoandre/kanoerp.git
```

**How code actually goes live in NocoBase:**
- **`jblock`** → a new Page, one big custom-code block on it. One page = one jblock
  (e.g. `view_production` is its own page). Anything that's a full custom view.
- **`JSAction`** → attached *alongside* a native NocoBase table block (not a custom
  jblock) to extend what that table can do — a button action pointed at the
  JSAction row. **A bare JSAction has no host React tree** (nothing has called
  `ctx.render()` for it) — see §6.1 for what this rules out.
- **JS Column** → also alongside a native table block, scoped to one field/column.
  Pasted directly into that field's "JS Column" settings — never its own DB row,
  never `loadCode`-able by name.
- A `source_code` row is never placed on a page directly — only ever loaded via
  `loadCode(ctx, name)` from a `jblock` or `JSAction`.

**Session close ritual:** end every session with an explicit "changed this
session" list — which rows to paste, which files to commit.

**Schema refresh ritual:** the schema lives in a separate file (§7). Run
`view_database_schema_dump`, paste the output into a new chat with "update the
schema file." Don't hand-edit it from memory — relation field names routinely
differ from what you'd guess (§4.1).

**Getting the current file list:** GitHub's web tree page blocks automated
fetching (`robots.txt`). The clone command above always works; after cloning:
```
find kanoerp -type f -not -path '*/.git/*'
```

---

## 3. Hard sandbox constraints — tested, not assumed

Every constraint below was empirically tested (not guessed). If unsure whether some
other property works, test it the same way — a throwaway jblock, `try/catch`,
render the result — rather than generalizing from one property to its whole parent.

**`window.*`** — per-property, not a blanket block:
- Allowed: `window.location.origin` (read), `window.open(url, target)` (the sandbox
  itself permits the call; a *browser* popup-blocker separately requires a real
  user gesture — calling it from `useEffect` gets silently suppressed, a real
  `onClick` works), `window.addEventListener`.
- Blocked: `window.location.href` (read), `window.innerWidth`, `window.print`.
- Not yet tested: anything not listed above.

**`document.*`** — per-property:
- Allowed: `document.createElement('a')` + `Blob` + `.click()` — the proven
  download pattern (CSV exports, `ui_prepare_fabric`'s PDF).
- Blocked: `document.body` (e.g. `document.body.appendChild(...)`, manually
  mounting a React root). `ctx.libs` doesn't even expose `ReactDOM` — mount via
  `ctx.render()` (jblocks) or `Modal.confirm({ content })` (bare JSAction, §6.1).

**More SES lockdown, confirmed while building the CSV importers:**
- `fetch()` is blocked, and writing to any global (`window.XLSX = ...`) throws —
  no way to load an external binary parser (e.g. SheetJS for `.xlsx`). Users must
  convert `.xlsx`/`.xls` to CSV before uploading.
- `new FileReader()` is blocked (constructing this specific global throws), but
  **`Blob.prototype.text()` on an existing `File` object is allowed** — an
  instance method on something you already have (e.g. from antd `Upload`), not a
  global being instantiated. The proven pattern for reading uploaded file
  contents: get the `File`, call `.text()`, parse as delimited text
  (comma/semicolon/tab, auto-detected).
- `setTimeout` **works fine** — confirmed by direct test, contradicting an earlier
  claim in this README that it was blocked.

**`ctx.sql`** — NOT admin-gated. Raw SQL works for every role, even directly
against the `fields` meta-table. The ONLY confirmed-gated thing is
`ctx.api.resource('fields')` (and presumably `collections`/`roles`, untested) via
the **resource API** specifically — not raw SQL against the same table. If you
need a `belongsTo` relation's field name, hardcode it from the schema dump (§4.1)
rather than resolving it at runtime via `ctx.api.resource('fields')` — a
`getRels()`-style pattern querying that endpoint still throws "No permissions" for
non-admin users even when the write itself falls back and succeeds, which is
confusing to debug since the data did save.

**JSX** — works only in a jblock's own top-level code (NocoBase transpiles it
before running). Never in a `source_code` row or JSAction — both compile via
`new Function('React','antd','dayjs','ctx', src)`, which only parses real
JavaScript. Confirmed: a `source_code` row containing raw JSX throws
`SyntaxError: Unexpected token '<'` the moment it's loaded.

**`ctx.model`, `ctx.openView`, `ctx.antd`, `ctx.React`, `ctx.engine`,
`ctx.useResource`** — available on every jblock, confirmed in a standard
`ctx.libs.React`-style file, not just files already using the `ctx.antd`/
`ctx.React` style (`filter-production`, `view_sample_canvas_mix`). `ctx.resource`
specifically only exists after calling `ctx.useResource(...)` first — not
pre-populated, not gated. This means `ctx.openView(uid, opts)` (open a native
NocoBase popup/drawer by uid) and `ctx.model.uid` (the current block's own uid)
are genuinely available anywhere, not restricted — just underused elsewhere.

**Filter Control blocks** (`filter-production`, `filter-production-marker`) are a
genuinely different, valid pattern — a block type sitting alongside a native table
block, pushing an advanced filter into that table's resource. Uses JSX,
`ctx.antd`/`ctx.React` (now confirmed available everywhere, not exclusive to this
pattern — see above), `ctx.model.uid`, `ctx.engine.getModel(uid)`,
`ctx.useResource('SQLResource')` for a per-block count query. Confirmed working
live. Both known examples hardcode a target-block-uid constant that's different
per page — copying to a new page without updating it fails with a caught,
user-facing error rather than silently doing nothing. **Don't refactor these onto
the `ce()`/`ctx.libs` convention** — copy one of these two as the template for a
new one instead.

**Concurrent `ctx.sql` calls with dynamic uids can collide.** Firing several
dynamic-uid SQL calls at once via `Promise.all` threw `"invalid sql schema uid
used"`. Fix: combine into one query (e.g. `UNION ALL`) under a fixed uid, or
serialize the calls. Multiple *fixed*, *different* uids fired concurrently is
proven-safe — the risk is specifically *dynamic* uids in parallel.

---

## 4. NocoBase API patterns

- **Database engine: MySQL.** Backtick-quote reserved words, `LIMIT n` syntax,
  standard MySQL date functions. Matters most for raw-SQL contexts.
- **SQL**: `ctx.sql.save(uid, sql)` (awaited) → `ctx.sql.runById(uid)`. `uid` must
  be a fixed string in single-row contexts; in multi-row column code, dynamic per
  row (`"prefix_" + record_id`) to avoid collisions between rows rendering at once
  — but don't fire many dynamic uids in parallel from one component (see §3).
- **Reads**: `ctx.api.resource('collection').list({ filter, fields, appends, sort,
  pageSize, page })` / `.get({ filterByTk })`. Use these batching helpers rather
  than hand-rolling pagination or `$in` chunking (proven across many files):
  ```js
  const DEFAULT_PAGE_SIZE = 1000;
  function fetchAllPages(resourceName, params) {
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
  // fetchByIn(resourceName, field, values, params): batches values into chunks of
  // 150, merges filter[field] = { $in: batch }, concatenates across batches — a
  // single large $in can blow nginx's URL-length limit (414) or silently truncate.
  ```
- **Writes**: `ctx.api.resource('collection').create({ values })` — reliable,
  avoids snowflake-ID issues raw SQL `INSERT` runs into.
- **`belongsTo` writes**: `{ [relFieldName]: { [targetKey]: value } }` — never a
  raw FK value alone (§3, §4.1).
- **Images/attachments**: relations through obfuscated junction tables (`t_xxx`),
  not plain columns. Use `appends: ['fieldName']` via the resource API — prefer
  this over hand-rolling the junction-table SQL join. Relative
  `/storage/uploads/…` URLs work directly in `<img src>`.
- **Enum/select labels**: `ctx.dataSourceManager.getDataSource('main')
  .getCollection(name).getField(field).enum` — shared as
  `lib_enum_labels.enumLabelMap(collection, field)`. Not SQL.
- **Schema/field introspection**: `ctx.dataSourceManager.getDataSource('main')
  .getCollections()` (or `.getCollection(name).getFields()`) is authoritative —
  synchronous, dynamic, no hardcoded table list. Raw-SQL `information_schema` FK
  introspection is NOT reliable — most relations here are enforced at the
  NocoBase application layer, not real DB FK constraints, so an
  `information_schema` dump comes back mostly empty despite the relations working
  fine. Not yet tested whether this API is role-gated like
  `ctx.api.resource('fields')` — treat with the same suspicion until confirmed.
- **`snowflakeId` values can exceed `Number.MAX_SAFE_INTEGER`.** Never
  sort/compare via plain subtraction (`a.id - b.id`) — convert via `BigInt(...)`
  first, or treat as opaque strings for comparison.
- **CPAS/Shopee-integrated ad accounts**: conversions only appear in
  `catalog_segment_actions`/`catalog_segment_value`; standard account/
  campaign-level `actions`/`action_values` silently drops conversion data for
  these accounts. Ad-level (`ads_insights`) is the only reliable source.

### 4.1 Relation field names are not predictable — always check the schema file

NocoBase's relation accessor field name is frequently *different* from both the
target collection's name and the raw FK column name. Confirmed gotchas:
- A `belongsTo`/`hasMany` field's name doesn't have to match its target
  collection's name.
- A target's primary key isn't always `id` — e.g. `product`'s is `code`, so
  `{ product: { code: value } }`, not `{ product: { id: value } }`.
- Some tables have legacy/duplicate raw audit columns alongside the standard
  `createdBy`/`updatedBy` belongsTo pair — prefer the belongsTo pair.
- **Some collections have NO belongsTo relations at all — just plain FK columns**
  (e.g. `production_marker`, `product_marker`). For these, write the raw FK value
  directly, always.

**Rule**: check the schema file before writing a `belongsTo` payload or an
`appends: ['relationName']` call — never guess or recall from memory. Once
confirmed, hardcode it as a constant (see `MARKER_RELS` in
`ui_production_addmarker.js`) rather than re-resolving it at runtime via `fields`
(§3).

### 4.2 `loadCode` — two valid variants, both fine

```js
// resource-based — works for every role, incl. through the one gated case (doesn't touch 'fields')
async function loadCode(name) {
  const res = await ctx.api.resource('source_code').list({ filter: { name }, fields: ['code'], pageSize: 1 });
  const src = res?.data?.data?.[0]?.code || '';
  return new Function('React','antd','dayjs','ctx', src)(React, antd, dayjs, ctx);
}
// raw-SQL-based (via the runSql/execSql template below) — also fine, some older files use this style
```

**Canonical `runSql`/`execSql` template**, for whichever files choose the raw-SQL
style (both are valid per §3 — this is a style choice, not a permissions
workaround):
```js
async function runSql(ctx, uid, sql) {
  if (ctx.flowSettingsEnabled) {
    await ctx.sql.save({ uid, sql, dataSourceKey: 'main' }).catch(() => {});
  }
  return ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' }).then(r => r || []).catch(() => []);
}
async function execSql(ctx, uid, sql) {
  if (ctx.flowSettingsEnabled) {
    await ctx.sql.save({ uid, sql, dataSourceKey: 'main' }).catch(() => {});
  }
  return ctx.sql.runById(uid, { type: 'exec', dataSourceKey: 'main' }).catch(() => null);
}
```
`ctx.flowSettingsEnabled` gates whether `.save()` runs — semantics not fully
understood (likely tied to NocoBase's flow-config/edit UI vs. live page), but the
pattern shows up independently in multiple files, strong enough evidence to copy
as-is. Note both `.save()`/`.runById()` swallow errors via `.catch()` — a
permissions failure and an empty table look identical through this wrapper, so if
something using this returns "no data," check the calling role before assuming
the query is wrong.

### 4.3 `ctx` surface — confirmed members

| Member | Use |
|---|---|
| `ctx.libs` | `{ React, antd, dayjs }` inside `new Function(...)`. **No `ReactDOM`.** `dayjs` has no plugins loaded — do timezone math by hand. |
| `ctx.sql` | `.save({uid,sql,dataSourceKey})` / `.runById(uid,{type,dataSourceKey})` — NOT gated (§3), fine for any role. Style choice vs. `ctx.api`, not a permissions workaround. |
| `ctx.api` | `.resource('collection').list/get/create/update/destroy(...)` — the other equally-valid pattern. **Except `fields`/`collections`/`roles`, which ARE gated even through this API (§3).** |
| `ctx.dataSourceManager` | `.getDataSource('main').getCollections()` / `.getCollection(name).getField(name)` — schema/enum introspection (§4). Untested for role-gating. |
| `ctx.render` | Mounts the component tree — required at the end of every jblock. Only jblocks get this. |
| `ctx.model` | `.uid` — the current block's own uid. **Confirmed available on every jblock**, not exclusive to any style (§3). |
| `ctx.openView` | `(uid, opts)` — opens a native NocoBase popup/drawer by uid. **Confirmed available on every jblock.** |
| `ctx.engine` | `.getModel(uid)` — resolves another block on the page by uid. Confirmed present everywhere; deeper capabilities not yet explored beyond the Filter Control usage. |
| `ctx.useResource` | `('SQLResource')` populates `ctx.resource` for the current block. Confirmed present everywhere; `ctx.resource` itself only exists after calling this. |
| `ctx.record` | The current row, in record-scoped contexts (JSAction/column code on a record). |
| `ctx.resource` | `.getSelectedRows()`, `.refresh()` — populated by `ctx.useResource(...)` first. |
| `ctx.message` | `.warning(...)` etc. `.loading(text, 0)` returns a closable handle — the non-Modal loading-indicator pattern (§6.1). |
| `ctx.notification` | Toast-style, more prominent than `ctx.message`. Convention for which to use when isn't formalized. |
| `ctx.flowSettingsEnabled` | Gates `.save()` in the §4.2 template. |
| `ctx.t` | i18n translation function. Used sparingly. |

**antd version isn't confirmed** (v4 vs v5 differ on some Modal/message APIs) —
mirror components already proven working rather than assume a version. Confirmed:
`Modal` (incl. `.confirm()`/`.destroyAll()` — `.update()` on the handle is NOT
reliable, §6.1), `Drawer`, `Dropdown`, `Select`, `DatePicker`, `InputNumber`,
`Switch`, `Spin`, `message`, `Pagination`, `Upload`, `Button`, `Table`, `Alert`,
`Progress`, `Input`, `Tag`, `Checkbox`, `Row`/`Col`, `Typography`.

---

## 5. Architecture principles

- **Extract-on-second-use.** Write inline first; promote once genuinely needed a
  second time. Don't pre-abstract.
- **Downward-only dependencies**: `ui_` → `fn_` → `lib_`. Never sideways/circular.
- **Stable contracts.** One-line comment at the top of every shared module stating
  its input/output shape.
- **Single canonical version** — edit shared modules in place.
- **Rename in place, never delete-and-recreate jblocks** — block UIDs feed filter
  controllers; recreating breaks those silently.
- **Naming**: `ui_`/`fn_`/`lib_` → `source_code`; `view_` → `jblock`; `act_` →
  `JSAction`.
- **`ctx` always threaded as a parameter**, never captured at compile time.
- **Full-file replacement for complex changes; targeted find/replace for small
  ones.** Confirm direction before writing code when ambiguous.
- **Mockup before implementation** for any new UI layout.
- **Check every other place that might reference what changed**, not just the
  piece being edited — moving a button/config key without checking sibling
  references has shipped real bugs (duplicate headers, missing exports).
- **Preview before writing, opt-in before overwriting** for any bulk-write/import
  feature — classify rows (new/no-op/conflict), require explicit opt-in before
  overwriting non-empty data. Never auto-apply silently.
- **Two orderings for one shared field list is valid** when a form needs a
  fixed/legacy-column order (e.g. Excel-paste alignment) and a read-only view
  wants a grouped/human order instead — see `lib_measurement_fields`'s
  `ENTRY_ORDER` vs `DISPLAY_ORDER`. Both derive from one label map; don't
  duplicate labels.
- **Auto-discovery over hardcoded field lists where the collection can grow.** A
  hardcoded list drifts silently — prefer `SELECT *`/schema introspection + a
  small ordering/label override map, so a new column shows up automatically
  instead of vanishing until someone notices.

---

## 6. UI conventions

- **JSX only in a jblock's own top-level code — never in `loadCode`-loaded modules
  or JSActions** (§3). Use `ce()`/`React.createElement` there.
- CSS via injected `<style>` tags with scoped class prefixes. Don't blanket-kill
  `transition`/`animation` on a Modal via this — can break antd's close lifecycle
  (§6.1).
- Scrollable popups end with a dummy spacer div (~80–120px) so the last item
  isn't clipped by a sticky footer.
- **Mobile detail pattern**: single expandable bottom sheet, always-visible main
  details + accordion sub-sections. Detail actions live as `Edit` + `•••`
  top-right. No separate mobile page.
- **Cross-record navigation** uses *replace*, never stack — `ui_record_nav`, a
  sibling-mounted host with a `navRef = { open: null }` channel.
- Clickable cross-links: `›` chevron in indigo (`#4338ca`), no underline.
- **Status colors**: planning `#f97316` · cutting/production `#d97706` · QC
  `#84cc16` · permak `#ef4444` · done `#22c55e`. Orange = pending, green = done.

**`lib_drawer_shell.DrawerShell`** — shared Drawer chrome for jblock-hosted
drawers (needs a real host tree via `ctx.render()`). Explicit close button,
header/footer/accent-bar, `loading` prop so a Drawer mounts immediately instead
of returning `null` pre-mount (that null-return pattern is what causes a Drawer
to "snap" into view instead of sliding, reading like a popup). Contract:
`{ open, onClose, title, extra, accentColor, width, placement, rootClassName,
zIndex, footer, loading, children }`. Callers accept an optional `DrawerShell`
prop and fall back to a plain `antd.Drawer` if not passed. **Does NOT apply to
bare-JSAction `Modal.confirm`-hosted UI** — no host tree for a real `Drawer`
there; see §6.1 instead.

**Two detail-view display standards** — pick by data volume, not for
consistency's own sake:
- **Accordion** (`AccordionItem`, single-open, collapsed by default) — production,
  sample. Enough content that showing it all at once is noisy.
- **Flat/always-expanded** (`SectionBlock`, static header, no toggle) — product
  details, product measurement. Not much data.

**`ui_list_engine.createListView(config)`** — shared list/card/drawer engine. Key
hooks: `fetchList`, `renderCard`, `detailRender`, `renderNewDrawer`/
`renderEditDrawer`, `bulkActions`, `quickActions` (optional).

**`config.quickActions`** — per-card actions: `[{ key, icon, label, color?,
primary?, danger?, run(row, helpers) }]`. Drives both the mobile swipe-reveal
panel and a desktop hover-reveal cluster (gated on `(hover:hover) and
(pointer:fine)`, never sticks on touch). Not set → the original Edit+Delete pair,
for free on both surfaces. `helpers.openEdit(row)`/`helpers.confirmDelete(row)`
let a custom list reach the standard flows too, not just new custom ones.

### 6.1 Modal.confirm gotchas — bare-JSAction record UI, no host Drawer

For a JSAction on a native table (no host `ctx.render()` tree), a real `Drawer`
can't be mounted, and manually mounting via `document.body`/`ReactDOM` is blocked
(§3). `Modal.confirm()` styled to look drawer-like is the proven pattern instead
(`ui_material_out.js`, `openDuplicateDrawer` in `ui_production_edit.js`,
`ui_production_addmarker.js`). **Never nest a real `Drawer` inside
`Modal.confirm`.**

Confirmed-broken, not just theoretically risky:
- **Never `transition: none !important`/`animation: none !important` on a Modal**,
  even scoped. antd's close lifecycle depends on a transition actually completing
  — kill it and `Modal.destroyAll()` "succeeds" (no error) but the modal never
  disappears. If an enter-animation flash needs addressing, shorten the duration
  instead of removing it.
- **`.update(newConfig)` on the Modal.confirm handle does not reliably merge** —
  can reset other config (`title`, `onCancel`) rather than merging. Avoid; keep a
  single mounted content component that manages its own internal loading state
  instead.
- **`Modal.destroyAll()` immediately followed by a fresh `Modal.confirm()` is not
  safe** — not fully synchronous; can leave two instances briefly overlapping
  (stacked masks, or an invisible stale mask blocking clicks).
- **Don't show an intermediate loading state via a second Modal instance.** Either
  accept a brief gap while `loadCode` resolves (fast, cached after first use), or
  use `ctx.message.loading(text, 0)` (a toast, not a Modal). One `Modal.confirm`
  call per user action, full stop.
- Prefer interactive elements inside `content`, not `title` — `content` is a
  normal React subtree and proven-working.

---

## 7. Database schema — see separate file

Not kept in this README — regenerated from NocoBase's own metadata (§4) and lives
at the separate schema dump file (regenerate via `view_database_schema_dump`,
§8). Fetch it at the start of any session touching SQL, `belongsTo` payloads, or
`appends`. Don't reconstruct from memory.

Schema-adjacent behavioral notes (not column names, so worth keeping here):
- All production FKs are standardized to `fk_production_id`.
- `material_ledger` captures supplier **per transaction** (a snapshot) — don't
  assume the current material's supplier FK reflects historical transactions.
- **`product.model` is often unset at creation time**, fixed later. Anything
  matching/grouping by `model` needs a validity check first — a bare
  "brand-letter(s)+digits" value like `O41` is a placeholder, not a real model;
  reject with `!/^[A-Za-z]+\d+$/.test(model.trim())`. See `isValidModel()` in
  `ui_production_addmarker.js`.
- **`product.code` is fixed at creation and always available immediately** —
  prefer keying cross-product logic off `code` (or an explicit mapping table)
  over `model` when something needs to work from the moment a record is created.

---

## 8. Registry — current components

Full history of what replaced what, and why, is in `HISTORY.md`. This is just
what exists now. File names may have inconsistent `.js` extensions — harmless.

### `source_code/` — shared logic, `new Function`-compiled, `loadCode`'d by name

| Row name | Purpose |
|---|---|
| `ui_list_engine` | Generic list/card/drawer engine (§6). `FormDrawer`/`DetailDrawer` accept optional `config.DrawerShell`, falling back to original rendering if unset. Supports `config.quickActions`. |
| `lib_drawer_shell` | Shared Drawer chrome, jblock-hosted only (§6). |
| `lib_enum_labels` | `enumLabelMap(collection, field)` via `ctx.dataSourceManager`. |
| `lib_measurement_fields` | Shared measurement field labels + `ENTRY_ORDER` (flat, append-only, for forms/Excel paste) + `DISPLAY_ORDER` (grouped, for read-only views) + schema-based auto-discovery. Used by `ui_product_measurement_add`/`_edit`, `view_product_measurement`, `ui_product_detail`. |
| `ui_production_detail` | Canonical production detail (accordion). Self-fetches from `productionId`. Sections: Summary, Material, Quantity, Result History, Remarks, Marker, History. |
| `ui_production_edit` | Production new/edit drawer + `openDuplicateDrawer`. Resource-based throughout; `DrawerShell`-aware. |
| `ui_production_material_detail` | Material detail + edit drawer. |
| `ui_production_addmarker` | Marker feature — summary + creation/reuse panel. Bare-JSAction-hosted (`Modal.confirm`, §6.1). Marker↔product mapping via `product_marker` (plain FKs, no relations), matched in tiers: same product code → same valid `model` → manual lookup. Exports `{ openModal, fetchSummary, searchByProductCode, isValidModel, MarkerContent }`. |
| `ui_product_detail` (row name — confirm vs. `ui_product_details`, see §9) | Product detail (flat/always-expanded). Measurements via `lib_measurement_fields`. |
| `ui_product_measurement_add` / `_edit` | Product measurement forms — `ENTRY_ORDER` for Excel paste, schema auto-discovery for new fields. |
| `ui_record_nav` | Cross-record replace-navigation host. |
| `ui_prepare_fabric` | Prepare-fabric modal + hand-built PDF (no external lib, no CDN). `buildFabricPdf` is a future `lib_pdf` candidate once a second consumer exists. |
| `ui_material_out` | Material-out modal: `openModal`, `fetchSummary`, `renderSummary`, `cancelLedger`, `isAccType`. |
| `ui_match_production` | Generalized matcher — `kind: 'production_result' \| 'qc_result'` via `KIND_CONFIG`. `openMatchModal`, `fetchMatchData`, `applyMatches`. QC kind has no post-apply "done" state (intentional — see §9). |
| `ui_import_material_details` / `ui_import_product_main_material` / `ui_import_product_material` | Bulk CSV importers — classify/preview before writing, opt-in before overwrite (§5). |
| `ui_product_import_code` / `ui_product_bulk_import_image` / `ui_product_variant_import` | Product bulk tools. |
| `ui_store_sales_add` / `ui_store_stock_transfer` | Store tools — write to `store_sales`/`stock_ledger`. |
| `ui_production_planning_report` | `createComponent(ctx, { mode: 'week'\|'matrix'\|'date' })` — `'date'` mode has no known caller (§9). |
| `ui_fbads_controls` | Pure UI, no ctx/data logic. |
| `fn_fbads_data` / `fn_production_planning_data` | Pure data-layer functions for their reports. |

All three CSV importers share one shell pattern (forced by §3's SES constraints):
`Modal.confirm()` with default OK/Cancel hidden, custom buttons in `content`,
`Modal.destroyAll()` to close; file contents via `Blob.prototype.text()` on the
`File` from antd `Upload`, parsed as delimited text.

### `jblock/` — thin domain shells on `ui_list_engine`, or standalone views

| Row name | Purpose |
|---|---|
| `view_production` | Production list. Fully resource-based. |
| `view_production_material` | Production material list. Fully resource-based. **Note: the GitHub mirror of this file was found stale once — confirm live content before trusting a fetch of this specific file.** |
| `view_production_result` | Production result list; Match Production bulk action. |
| `view_product_details` | Product record-popup detail (delegates to `ui_product_detail`). |
| `view_product_measurement` | Product measurement list — has `quickActions` configured (Edit primary, Duplicate/Delete in overflow). |
| `view_sample_details` | Sample record-popup detail. Fully resource-based. |
| `view_sample_dashboard_summary` | Sample Summary Report + Collection Preview. Uses the `ctx.antd`/`ctx.React` style (a style choice, not a different capability set — §3). Still on raw `ctx.sql` (fine, §3) except three duplicated `fields`-table enum lookups, now consolidated via `lib_enum_labels`. |
| `view_sample_canvas_mix` | Moodboard tool. Same `ctx.antd`/`ctx.React` style. Create-canvas flow writes directly via `ctx.api.resource('canvas').create(...)`, no native-popup-plus-polling. |
| `view-sample-variant-details` | Sample variant record-popup detail. |
| `report_store_display` / `report_store_monthly_report` / `report_store_stock_tracking` | Store reports. Resource-based/raw-SQL mix, both fine per §3. |
| `view_fb_report_overview` / `_details` / `_monthly` / `_creatives` | FB ads reports. Fully resource-based. |
| `view_production_dashboard_planning_report` / `_matrix` | Thin shells → `ui_production_planning_report`. |
| `view_database_schema_dump` | Produces the schema dump text (§7) via `ctx.dataSourceManager.getCollections()`. |
| `view_database_table_list` | Lighter companion — antd `Table` view of collections. Uses JSX directly (valid — plain jblock, §3). |
| `view_source_code_updates` | Lists `source_code` rows updated since an editable timestamp. |
| `filter-production` / `filter-production-marker` | Filter Control blocks (§3). Don't refactor onto the `ce()`/`ctx.libs` convention. |

### `jsaction/` — thin shells: resolve host record, `loadCode`, delegate

`act_production_view`, `act_production_material_view`, `act_production_addmarker`,
`act_production_duplicate`, `act_production_prepare_fabric`,
`act_production_material_material_out`, `act_match_production`,
`act_match_qc_result`, `act_material_out`, `act_prepare_fabric`,
`act_product_details` (now a proper thin shell, delegates to `ui_product_detail`),
`act_product_import_code`, `act_product_import_image`, `act_product_variant_import`,
`act_product_measurement_smart_add`, `act_store_sales_add`,
`act_store_stock_transfer`, `act_import_material_details`,
`act_import_product_main_material`, `act_import_product_material`.

### JS Column code (inline field settings — not its own DB row)

| File | Attached to | Purpose |
|---|---|---|
| `col-production-history` / `col-production-marker` / `col-production-material` / `col-production-permakan` / `col-production-quantity-summary` / `col-production-ratio-quantity` / `col-production-summary` | Production table columns | `ctx.element.innerHTML` pattern (§6), no React/`ctx.render`. Sort by `snowflakeId` via `BigInt(...)`, never plain subtraction (§4). `col-production-quantity-summary` deliberately shows only the FIRST material (the main one) — not a bug, see §9. |
| `col-sample-comments` / `col-sample-details` / `col-sample-history` / `col-sample-image` / `col-sample-variant` / `col-sample-variant-comments` / `col-sample-variant-details` / `col-sample-variant-image` / `col-sample-variant-qc` | Sample/variant table columns | Same pattern. Variant columns intentionally show the PARENT sample's comments/image where no per-variant equivalent exists in the schema. |

### 8.1 Direct raw URLs

Every URL must be literal and exact (see the note at the top of this file). This
list needs hand-maintenance — add/fix a line here in the same commit that
adds/renames a file, or it goes stale. Base pattern:
`https://raw.githubusercontent.com/ricardoandre/kanoerp/main/kanoerp/{folder}/{filename}`

Root-level: `README.md` (this file), `HISTORY.md`, and the schema dump file (see §7
for its exact path/name).

---

## 9. Known open items

- **`store_stock_in` table removed from schema; `ui_store_stock_in_import` was
  writing to it and has been deleted.** Every row would have failed (the table
  doesn't exist). No replacement built — `stock_ledger` now covers all
  inbound/outbound store movement if a "Stock In" importer is wanted again.
- **`ui_product_detail` vs `ui_product_details` naming** — the file's own header
  claims one name, the GitHub path uses the other. `act_product_details` currently
  tries both defensively at load time. Confirm the real registered name and
  simplify.
- **QC matching has no "done" state** after a successful apply (production
  matching does — Apply stays disabled after one run). Preserved as a deliberate
  per-`kind` config flag (`hasDoneState`), not unified — flag if it should
  actually match.
- **`ui_production_planning_report`'s `'date'` mode** has no known caller. Build
  the third call site or remove the dead mode.
- **`view_sample_canvas_mix`** not yet in active real-world use.
- **6 legacy `product_marker` rows** from when that collection's second FK column
  meant `product_variant.code` instead of its current meaning, `product.code` —
  values no longer match anything. Delete or manually correct.
- Optional cleanup: normalize inconsistent `.js` extensions across files.

---

## 10. Facebook Ads → NocoBase pipeline

Separate Node.js project at `~/fb-ads-sync`: `sync.js`, `backfill.js`,
`creatives.js`, `lib/facebook.js`, `lib/transform.js`, `lib/nocobase.js`,
`lib/creatives.js`. Not NocoBase code — plain Node.js, no `loadCode` conventions.

- Run scripts from the project root, not from inside `lib/`.
- NocoBase upsert via `:updateOrCreate` with `filterKeys[]`, idempotent, keyed on
  `(ad_id, date)`.
- `pickConv`/`pickRevenue` fallback: try CPAS arrays first, fall back to pixel
  arrays (§4).
- Backfill: `BACKFILL_SINCE=2024-01-01 node backfill.js` from the project root.

**Secrets: `.env` is gitignored, never committed** — this repo is public. If ever
accidentally committed, rotate the credentials immediately; deleting the file
alone doesn't remove it from git history. `node_modules/`/`*.log` also
gitignored — regenerate with `npm install`.

---

## 11. Working style

- Modular structure: shared helpers → data layer → small presentational
  sub-components (`createElement`, not plain functions) → thin composition root.
- Complete drop-in replacement of the specific named component on iteration, not
  a full-file rewrite of unrelated things — and check every other place that
  might reference what changed (§5).
- One concrete step at a time, confirmation before the next, when a task has
  multiple unconfirmed prerequisites.
- **State explicitly whether a change is a bug fix or a standardization/polish
  change** — different risk profiles. A fix addresses something confirmed broken;
  polish touches working code purely for consistency, carrying real risk with no
  urgency.
- **Cosmetic polish on working functionality is lower priority than it feels, and
  each attempt is a real chance to break something that worked.** When the
  underlying mechanism is unverified, lean toward leaving working code alone, or
  make the smallest possible change and flag the tradeoff — don't chain multiple
  speculative fixes hoping one sticks.
- **Claude cannot execute this code against the live NocoBase instance** — no
  reachable test environment. All code is written from documented patterns and
  prior working examples, not verified by running it. Flag assumptions/untested
  edges explicitly. The paste-by-user → report-errors-back loop *is* the
  verification step by design — when it reports something broken, prefer the
  smallest fix addressing the actual reported symptom over a broader rework.
- End every session with a "changed this session" list — which rows to paste,
  which files to commit.

---

## 12. Footer

Public repo: `github.com/ricardoandre/kanoerp`. Folders: `source_code/`,
`jblock/`, `jsaction/`, `column/` (JS Column code), mirroring the NocoBase row
types above. Schema: separate file, §7. Deeper history, corrected-claim
narratives, and deprecated files: `HISTORY.md`.
