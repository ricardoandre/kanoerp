# HISTORY.md — narrative context, corrected claims, deprecated files

The "why" and "how we found out" behind `README.md`'s current rules. Not required
reading before writing code — read `README.md` first, come here for the backstory
on a specific rule, or out of curiosity why something used to work differently.

---

## Corrected claims — a recurring pattern

Four separate times this session, a real, narrow, correctly-observed finding got
written up as a broader blanket rule — and the blanket version turned out wrong.

**The pattern**: something breaks in one specific context → the fix that worked
gets generalized into "X is blocked/exclusive/dangerous" → that broader claim gets
copied into new files' comments → nobody re-tests the broader claim, because the
narrow fix already solved the immediate problem → it calcifies into "known fact."

**The fix**: test the *specific* property/call directly (a throwaway jblock with a
`try/catch`, rendering the result) whenever a constraint claim doesn't quite match
what you're seeing, instead of trusting an inherited comment.

### 1. `window.*` — was "fully blocked", actually per-property

Found auditing `view_sample_details.js`, which used `window.location.origin` and
`window.open()` and worked perfectly live — directly contradicting "fully
blocked." A diagnostic probe (`try/catch` around each property in a throwaway
jblock) showed: `window.location.origin` allowed, `window.open` allowed (an
earlier test's "failure" was actually the *browser's* popup blocker eating a call
made from `useEffect`, not a real click — a different failure mode entirely),
`window.addEventListener` allowed. `window.location.href`, `window.innerWidth`,
`window.print` genuinely blocked (`"Access to global property... is not
allowed"` — a real sandbox denial).

### 2. `ctx.sql` admin-gating — was "broadly gated", actually one narrow endpoint

The marker feature's original bug report was real: `ctx.api.resource('fields')`
threw "No permissions" for a non-admin user. That got generalized into "raw
`ctx.sql` is admin/root-gated" and drove migrations of `ui_production_addmarker`,
`ui_production_edit`, `ui_production_detail`, `ui_production_material_detail`,
`view_sample_details` off raw SQL onto `ctx.api.resource()`. A later direct test —
the same probe, run under both an admin and non-admin login — showed identical
results either way: plain `ctx.sql` against an ordinary table works, `ctx.sql`
directly against `fields` works, ONLY `ctx.api.resource('fields')` specifically
403s. The migrations weren't wrong (`ctx.api.resource()` is fine regardless), just
not necessary for the stated reason.

### 3. JSX — was "never JSX anywhere", actually only inside `new Function(...)`

`view_database_table_list.js`, a plain jblock, uses raw JSX and works fine live.
Root-caused with a direct test: a throwaway `source_code` row containing
`return <div>hello</div>;`, loaded via `loadCode()`
(`new Function('React','antd','dayjs','ctx', src)`), threw
`SyntaxError: Unexpected token '<'`. NocoBase transpiles a jblock's own top-level
code before running it, but does NOT transpile whatever `new Function(...)`
compiles at runtime.

### 4. `ctx.model`/`ctx.openView`/`ctx.antd`/`ctx.React` — was "exclusive to a
special context", actually universal

`view_sample_canvas_mix` and the Filter Control blocks all use `ctx.antd`/
`ctx.React` (top-level) plus `ctx.model.uid`/`ctx.openView`/`ctx.engine`/
`ctx.useResource` — initially framed as "a separate execution context these files
happen to use." A direct test — a throwaway jblock in the completely standard
`ctx.libs.React` style — successfully read `ctx.model.uid`, confirmed
`ctx.openView` as a function, and found `ctx.antd`/`ctx.React`/`ctx.engine`/
`ctx.useResource` all present. The only thing empty was `ctx.resource` — because
that's populated BY calling `ctx.useResource(...)` first, not a gating issue. So
`ctx.antd`/`ctx.React` vs `ctx.libs.antd`/`ctx.libs.React` was always just a
stylistic choice, not a marker of a restricted compile context.

---

## Other lessons (not corrections — genuine constraints, confirmed once and still true)

- **Concurrent dynamic-uid `ctx.sql` calls collide** (`"invalid sql schema uid
  used"`). Originally suspected as the cause of an intermittent load failure that
  turned out to actually be the `fields`-gating issue (correction #2 above) — this
  uid-collision risk is real on its own, just wasn't the culprit that one time.
- **`fetch()`/writing to globals/`new FileReader()` are blocked** (SES lockdown),
  discovered building the CSV importers. Rules out any external binary-format
  library entirely. `Blob.prototype.text()` on an existing `File` object works
  fine (an instance method, not a global construction).
- **`document.body`/manual `ReactDOM` mounting is blocked**, discovered first
  building `ui_production_addmarker.js` (tried `ReactDOM.createRoot(document.body...)`).
  `ctx.libs` doesn't expose `ReactDOM` at all.
- **A moved config key/button needs every reference checked, not just the piece
  being moved.** Moving a close button out of `Modal.confirm`'s `title` into
  `content` but forgetting to clear the old `title: 'Some Text'` string left two
  stacked headers in production once.

---

## Bugs found and fixed

A rough chronological log, in case a specific fix needs re-checking against the
reasoning that produced it.

- **`ui_production_edit.js`**: migrated off raw `ctx.sql`. Discovered
  `openDuplicateDrawer` (and the `initialValues`/`inline` support it depended on)
  had been silently dropped in an earlier refactor — restored, converted to
  `ctx.api.resource()`. Given `DrawerShell` support.
- **`act_production_duplicate`, `act_production_view`,
  `act_production_material_view`**: still had the old raw-`ctx.sql`-based
  `loadCode` instead of the resource-based one every other shell uses. Swapped.
- **`ui_production_detail.js`**: full SQL migration. Also a real bug: the "Marker"
  section read a column literally named `marker`, which doesn't exist — the real
  column is `marker_remarks`. `fetchProductImage` stopped introspecting `fields`
  for the image junction table, switched to `appends`.
- **`ui_production_material_detail.js`**: same SQL migration pattern.
- **`view_sample_details.js`**: same, plus confirmed `window.location.origin`/
  `window.open` should stay untouched (correction #1).
- **`col-production-quantity-summary`**: briefly "fixed" from first-material-only
  to an all-materials aggregate, then REVERTED — intentional: the first material
  by id is the main material, and `planning_rol` is a roll count (fabric-specific
  unit), so aggregating in accessories (measured in packs) would produce a
  meaningless mixed total. A genuine "ask before assuming" case.
- **`col-production-ratio-quantity`**: a real bug, not reverted — the sort
  comparator referenced `a.option?.sort`, but the row shape (`SELECT *`, no join)
  never had an `.option` property. Every row compared as `0` — the "sort by
  variant order" was a silent no-op. Fixed by looking up sort order from the
  already-fetched `sku_option` list instead.
- **`col-production-permakan`**: missing the empty-record guard every sibling
  column has — added for consistency.
- **`ui_import_material_details`**: create payload sent the material link under
  the key `material` instead of the schema-confirmed `fk_material_code` —
  `material` isn't a real field, so every import row failed outright (a required
  field, so the failure was loud — "Created 0 of N", not silent).
- **`act_match_production`/`ui_match_production`**: found duplicated — a full,
  separate implementation lived directly in the JSAction instead of delegating to
  the shared module built for the same purpose. Converted the JSAction to a thin
  shell — then had to REVERT `ui_match_production`'s content to match the
  JSAction's exact original behavior (INNER JOIN vs LEFT JOIN on the
  production-candidate query, a column label, atomic vs non-atomic status update)
  once it turned out the JSAction's version was the one actually in live use.
  Later generalized `ui_match_production` via a `kind` parameter to serve
  `qc_result` matching too (previously its own fully duplicated JSAction, now
  `act_match_qc_result`, a thin shell).
- **`act_product_details` + `ui_product_details`**: identical conceptual bug —
  assuming `product_variant` has its own `fk_product_measurement_id` (it doesn't;
  that field is on `product` itself). The resource-API version failed silently
  (empty Measurements table); the raw-SQL version would have thrown and gotten
  the whole Variants+Measurements section stuck on "Loading…" forever, since
  referencing a nonexistent SQL column is a hard error and that fetch chain had
  no `.catch()`. Also converted `act_product_details` from a full standalone
  duplicate into a proper thin shell delegating to `ui_product_details` — the
  duplication is exactly why the same bug needed fixing twice.
- **`ui_store_stock_in_import`**: found writing to `store_stock_in`, a table no
  longer in the schema. Every row would fail. Deprecated, deleted rather than
  migrated.
- **`view_sample_canvas_mix`**: the "create canvas" flow had two paths — a Modal
  that could never actually open (`setShowModal(true)` never called anywhere),
  and even if it had, its own submit handler ignored the Name/Collection values
  it had just collected. The other, working path opened a native NocoBase popup
  and polled for up to 30 seconds waiting for the new row. Replaced both with one
  `Drawer` that creates the canvas directly via `ctx.api.resource('canvas')
  .create(...)` — no polling, the created row comes back immediately.
- **Product measurement's field list**: found duplicated across four files, one
  of which had silently drifted (missing `bust2`/`waist2`/`elastic`, only caught
  by manually checking the schema). A later user-added `crotch` column surfaced
  the same class of problem again. Extracted to `lib_measurement_fields`, with a
  deliberate two-ordering split: forms need a fixed, append-only, legacy-Excel
  order; read-only views want a grouped, human-friendly order. Both derive from
  one label map; schema-based auto-discovery means a future column shows up
  automatically in both instead of silently vanishing.
- **`ui_list_engine.js`**: added `config.quickActions` (desktop hover-reveal
  cluster + generalized mobile swipe panel, previously hardcoded to Edit/Delete
  only). Required also exposing `helpers.openEdit`/`helpers.confirmDelete` so a
  custom `quickActions` list can still reach the standard flows.

---

## Deprecated / removed files

- **`ui_store_stock_in_import`** — deleted. Wrote to `store_stock_in`, a table
  removed from the schema before this session; every row failed.
- **The GitHub mirror's copy of `jblock/view_production_material.js`** was found
  stale — it contained old, retired `ProductionDetailView` content (the
  dashboard-card layout `ui_production_detail.js`'s own header says it replaced)
  instead of the actual live, correctly-migrated file. The live NocoBase row was
  confirmed fine; only the GitHub copy needed re-committing. General lesson (also
  in `README.md` §2): don't fully trust a GitHub fetch without cross-checking
  when something about it looks off.

---

## Design decisions worth remembering (not bugs, could look like ones)

- **`col-production-quantity-summary` shows only the first material**,
  deliberately — see the revert above. Don't "fix" this into an all-materials sum.
- **QC matching has no post-apply "done" state, production matching does** —
  original behavior of both standalone JSActions before merging into one shared
  module; preserved as a deliberate per-`kind` config flag (`hasDoneState`) rather
  than unified, since unifying would have silently changed QC's existing
  behavior without being asked to.
- **`ui_product_variant_import`/`ui_product_import_code` use different valid
  patterns for the same kind of write** (raw FK column vs. relation object) —
  both correct against the schema, just two files written slightly differently.
- **Sample-variant columns showing the parent sample's comments/image** is
  intentional — there's no per-variant equivalent in the schema for those fields.
