# ASKA Label / Kano — code mirror

Canonical mirror of the inline React (`jblock`) and `source_code` components for the
Kano garment-production system on NocoBase. **NocoBase is the live source of truth** (it executes the code); this repo is the history + context mirror.

Each file here corresponds to one NocoBase row. The filename matches the row's
lookup `name` exactly — for `source_code` rows that is the key passed to `loadCode(ctx, name)`, so the name must match character-for-character.

## Sync workflow

1. Code is generated/edited in a Claude session.
2. Paste into the matching NocoBase row (it runs).
3. Commit the same change here (the mirror) — paste-and-commit, no delete/reupload.
4. Next session, share the raw URL of the file(s) in play so Claude reads current state.

You only need to keep current the files you're about to work on; the runtime is
always current regardless of mirror lag.

**Start a new Claude session by sharing this README's raw URL first.** It tells
Claude what NocoBase can/can't do in this sandbox and the established patterns,
so it doesn't have to rediscover them by trial and error again (see "Sandbox
constraints" and "CSV import wizard pattern" below — both were earned the hard
way over several rounds of runtime errors).

## Registry

### `source_code` rows (shared logic, compiled via `new Function`, loaded with `loadCode`)

| File                                           | NocoBase row name               | Purpose                                                                                                                                                                                         |
| ----------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source_code/ui_list_engine.js`                | `ui_list_engine`                | Generic list engine; both views are thin configs on top of it (was `kano_listview`).                                                                                                            |
| `source_code/ui_production_detail.js`          | `ui_production_detail`          | Canonical production detail. Self-contained: takes `{ productionId, onClose }`, fetches own data. All entry points render this identical experience.                                            |
| `source_code/ui_production_edit.js`            | `ui_production_edit`            | Production new/edit drawer.                                                                                                                                                                     |
| `source_code/ui_production_material_detail.js` | `ui_production_material_detail` | Material detail + `MaterialEditDrawer`. (Project mirror was misnamed `…_details` plural; row is singular.)                                                                                      |
| `source_code/ui_material_out.js`               | `ui_material_out`               | Material-out modal. Exports `openModal({ctx,pmId,onSaved})`, `fetchSummary(ctx,pmId)`, `renderSummary(data)`, `isAccType(type)`.                                                                |
| `source_code/ui_prepare_fabric.js`             | `ui_prepare_fabric`             | Prepare-fabric modal + PDF (was `preparefabric`). `buildFabricPdf` is the future `lib_pdf` extraction candidate.                                                                                |
| `source_code/ui_record_nav.js`                 | `ui_record_nav`                 | Cross-record replace-navigation host. Mount one `RecordNav` per view root; cross-links close current + open target (never stacks). Depends on the two detail components + `ui_production_edit`. |
| `source_code/ui_import_material_code.js`       | `ui_import_material_code`       | CSV import wizard: sets `product.fk_main_fabric_code` by `product.code`. No-op if value already matches; auto-updates if current value is empty; conflicting non-empty values require an explicit per-row checkbox before overwrite. Codes not found in `product` are **created as new products** (`{ code, fk_main_fabric_code }`). See "CSV import wizard pattern" below. |
| `source_code/ui_import_product_material.js`    | `ui_import_product_material`    | CSV import wizard: bulk-**creates** `product_material` rows (`fk_product_code`, `fk_material_details_code`, `quantity`). Duplicate `(product_code, material_code)` pairs are skipped and reported, not merged/updated. Blank `quantity` (with both codes present) still creates the row but omits `quantity` from the payload (left unset, not forced to 0/null). |
| `source_code/ui_import_material_details.js`    | `ui_import_material_details`    | CSV import wizard: bulk-**creates** `material_details` rows (`code`, `fk_material_code` → **`raw_material.code`**, `variant`, `supplier_variant_code`). Create-only: existing `code` is skipped, not updated. `material_details`'s belongsTo association field is named `material` (not `fk_material_code`) — the create payload must set `values.material`, not `values.fk_material_code`, or NocoBase's required-field validation on the association rejects it. |

### `jblock` rows (inline React pasted into the DB; thin domain shells)

| File                                 | NocoBase row name          | Purpose                                                                                                               |
| ------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jblock/view_production.js`          | `view_production`          | Thin domain config → `ui_list_engine` (SQL, status colors, card layout, detail/edit loaders, mounts `ui_record_nav`). |
| `jblock/view_production_material.js` | `view_production_material` | Thin domain config → `ui_list_engine` for `production_material`.                                                      |

### `JSAction` rows (thin action shells)

| File                                       | NocoBase row name            | Purpose                                     |
| -------------------------------------------- | ------------------------------ | ---------------------------------------------------- |
| `jsaction/act_material_out.js`             | `act_material_out`           | Thin shell → `ui_material_out`.             |
| `jsaction/act_prepare_fabric.js`           | `act_prepare_fabric`         | Thin shell → `ui_prepare_fabric`.           |
| `jsaction/act_import_material_code.js`     | `act_import_material_code`   | Table-level action → `ui_import_material_code`. Attach to the Product table's toolbar. |
| `jsaction/act_import_product_material.js`  | `act_import_product_material`| Table-level action → `ui_import_product_material`. Attach wherever `product_material` is managed. |
| `jsaction/act_import_material_details.js`  | `act_import_material_details`| Table-level action → `ui_import_material_details`. Attach to the material_details list toolbar. |

## Dependency rule

Downward-only: `ui_` → `fn_` → `lib_`. Never sideways or circular —
circular deps are very hard to debug under `new Function` compilation.

## Conventions

- `React.createElement` aliased as `ce` — no JSX (no transpiler in the sandbox).
- Jblocks cannot import each other; shared logic lives in `source_code` rows,
  compiled via `new Function('React','antd','dayjs','ctx', src)`, loaded through
  `loadCode(name)` with a module-level `_codeCache`.
- Rename rows **in place** in NocoBase, never delete-and-recreate (jblock UIDs feed
  filter controllers; recreating breaks them silently).
- Reads go through `ctx.sql.save({uid, sql, dataSourceKey:'main'})` then
  `ctx.sql.runById(uid, {type:'selectRows', dataSourceKey:'main'})`.
- Writes go through `ctx.api.resource(collectionName).create({values})` /
  `.update({filterByTk, values})` or `.update({filter:{...}, values})` /
  `.destroy({filterByTk})` — **never raw SQL for writes**.
  - Prefer `filter: { someColumn: value }` over `filterByTk` when you don't
    know for certain that the collection's primary key equals the column
    you're matching on (e.g. matching business-key `code` rather than the
    internal `id`) — `filter` matches on any field, `filterByTk` requires the
    literal primary key.
  - **A `belongsTo` association's required-field validation lives on the
    association name, not the raw FK column.** E.g. `material_details` has a
    `belongsTo` field named `material` (backed by `fk_material_code`); a
    create payload must set `values.material = <raw_material.code value>`,
    not `values.fk_material_code = ...`, or you'll get a "Material is
    needed" validation error even though the FK column itself has a value.
    Check the field's "Field name" vs. the association's display name on the
    Configure Fields screen if a create keeps failing with a "X is needed"
    error despite the FK looking correct.
- Action-triggered modals mount via **antd's imperative `Modal.confirm()`**
  (see `ui_material_out.js`): hide the default OK/Cancel with
  `okButtonProps: {style:{display:'none'}}` / `cancelButtonProps: {...}`, put
  custom buttons inside `content` (a React element whose internal state drives
  phase changes — antd keeps it mounted and reactive), and close with
  `Modal.destroyAll()`. **Do not** try to mount a manual `ReactDOM` root into
  `document.body` — see sandbox constraints below, it's blocked outright.

## Sandbox constraints (SES lockdown)

This NocoBase instance runs action/source_code scripts inside an SES
("Secure ECMAScript") compartment (visible in the browser console as
`npm.ses.*.js`). It blocks a lot of normal browser API surface that would
work in a plain webpage. Everything below was discovered empirically by
hitting the actual runtime error — save yourself the round trip:

| API                                          | Status | Error you'll see                                                          |
| --------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `document.body`, `document.head`, etc.       | ❌ Blocked | `Error: Access to document property "body" is not allowed.`                |
| `window.SOMEGLOBAL = ...` (writing any global) | ❌ Blocked | `Error: Access to global property "XLSX" is not allowed.` (same restriction, applies to any name, not just XLSX) |
| `fetch(...)`                                  | ❌ Blocked | `fetch() is not available in this sandbox` (thrown synchronously — see gotcha below) |
| `new FileReader()`                            | ❌ Blocked | `FileReader is not a constructor`                                          |
| Dynamic `import(...)` — **including inside string literals and comments** | ❌ Blocked | `SyntaxError: Possible import expression rejected ... (SES_IMPORT_REJECTED)` |
| `Blob.prototype.text()` / `.arrayBuffer()` on an existing `File` object | ✅ Allowed | — it's an instance method on an object the platform already handed you, not a global you're instantiating |
| `new Function(...)`                           | ✅ Allowed | — this is exactly how the platform's own `loadCode` works, so it's clearly trusted |
| `ctx.sql.*`, `ctx.api.*`, `ctx.libs`, `ctx.message`, `ctx.notification`, `ctx.resource.refresh` | ✅ Allowed | — the sanctioned surface |

**Practical consequences:**

- **No client-side `.xlsx`/`.xls` parsing is possible.** It would need either
  `fetch()` to pull in a parser like SheetJS, or `new FileReader()` to read
  binary data — both blocked. CSV/TSV/semicolon-delimited text is the only
  practically supported upload format for any future import wizard. Read
  files with `file.text()` (a `Blob` instance method) and hand-roll a small
  delimited-text parser (see any `ui_import_*.js` file for a working one with
  header-row auto-detection and delimiter auto-detection).
- **No dynamically mounting a UI outside the existing React tree.** Modals
  triggered from a JSAction must use antd's imperative APIs (`Modal.confirm`,
  `Modal.info`, etc.) which manage their own portal internally, rather than
  `ReactDOM.createRoot(...)` + `document.body.appendChild(...)`.
- **The `import(` text-scanner is naive and case-sensitive-ish but very
  trigger-happy.** It appears to do a source-text scan for the literal
  pattern `import` followed by `(` (optionally with whitespace in between)
  **anywhere in the file**, including inside string literals, template
  strings, and `//` comments — not just real syntax. It has bitten this
  project twice already:
  - A button label string `'Run import (' + count + ')'` tripped it (fixed by
    rewording to `'Run import — ' + count`).
  - A comment *explaining this very restriction* (`// ...dynamic import()
    expression...`) tripped it too.
  **Rule of thumb: never let the substring `import(` (even across a line
  break with only whitespace between the two tokens) appear anywhere in a
  `source_code`/`jsaction` row — including comments and UI copy.** Prefer
  wording like "Run import — N row(s)" over "Run import (N)". Grep for it
  before pasting: `grep -i "import\s*(" file.js`.
- If a button click does *nothing at all* — no console error, no visible
  effect — the most likely cause is a `SES_IMPORT_REJECTED` compile failure
  inside `loadCode`, which silently fails to produce the exported object.
  Check the browser console for `SyntaxError: Possible import expression
  rejected` before assuming the click handler itself is broken.

## CSV import wizard pattern

Three import wizards (`ui_import_material_code`, `ui_import_product_material`,
`ui_import_material_details`) all follow the same shape — copy the closest one
as a starting point for the next import rather than rebuilding from scratch.

**Shell:** `openModal({ ctx, onSaved })` calls `Modal.confirm({ title, width,
icon: null, content: ce(ImportContent, {ctx, onSaved}), okButtonProps:
{style:{display:'none'}}, cancelButtonProps: {style:{display:'none'}},
maskClosable: true })`. `ImportContent` is a normal React component that owns
all wizard state and renders its own buttons inside itself (antd keeps
`content` mounted and reactive across phase changes). Closing calls
`Modal.destroyAll()`.

**Phases** (component-local `useState('pick')`):
1. `pick` — antd `Upload.Dragger` with `beforeUpload: (file) => { handleFile(file); return false; }` (returning `false` prevents antd's own upload attempt; we handle the `File` object ourselves).
2. `parsing` — reads via `file.text()`, splits into cells with delimiter auto-detection (comma/semicolon/tab — pick whichever appears most in line 1), strips a header row heuristically (checks if row 1's cells look like known column names), then runs one or more `runSql` lookups to classify every row **before** touching the database.
3. `preview` — shows category counts + a small `Table` per non-empty category (will-create/will-update, duplicates, not-found, invalid, conflicts). Conflicts (if the import type has them) get a `Table` with `rowSelection` checkboxes, **unchecked by default** — never auto-select destructive overwrites.
4. `running` — sequential `for` loop (not `Promise.all`) over the confirmed rows, calling `ctx.api.resource(...).create()/.update()` per row inside try/catch so one failure doesn't abort the rest; updates an antd `Progress` bar each iteration.
5. `done` — full stat breakdown (read / succeeded / failed / skipped-by-category / ignored-blank) plus a detail `Table` for every non-empty problem category, so nothing has to be re-derived from console errors after the fact.

**Classification conventions established so far** (adjust per collection's
actual needs, but these are sensible defaults):
- A row where *every* column is blank → silently ignored, not counted as an error.
- A row missing a genuinely required identifying field (e.g. a code) → invalid, listed with a reason string.
- An optional field being blank (e.g. `quantity`, `variant`) → row still proceeds; that key is simply omitted from the `values` payload (left unset) rather than sent as `0`/`null`/`''`.
- Foreign key doesn't resolve to an existing row → skipped, listed (never silently dropped).
- Would-be duplicate (natural key already exists) → default to **skip + report**, unless explicitly told the target field should be reconciled — reconciliation needs an explicit per-row confirmation UI (see `ui_import_material_code`'s conflict table), never a silent overwrite.

**Before shipping any new import wizard:** grep it for `import\s*\(` per the
sandbox-constraints section above, and `node --check file.js` to catch plain
syntax errors before pasting into NocoBase.
