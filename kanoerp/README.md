# ASKA Label / Kano — code mirror

Canonical mirror of the inline React (`jblock`) and `source_code` components for the
Kano garment-production system on NocoBase. **NocoBase is the live source of truth**
(it executes the code); this repo is the history + context mirror.

Each file here corresponds to one NocoBase row. The filename matches the row's
lookup `name` exactly — for `source_code` rows that is the key passed to
`loadCode(ctx, name)`, so the name must match character-for-character.

## Sync workflow

1. Code is generated/edited in a Claude session.
2. Paste into the matching NocoBase row (it runs).
3. Commit the same change here (the mirror) — paste-and-commit, no delete/reupload.
4. Next session, share the raw URL of the file(s) in play so Claude reads current state.

You only need to keep current the files you're about to work on; the runtime is
always current regardless of mirror lag.

## Registry

### `source_code` rows (shared logic, compiled via `new Function`, loaded with `loadCode`)

| File | NocoBase row name | Purpose |
|---|---|---|
| `source_code/ui_list_engine.js` | `ui_list_engine` | Generic list engine; both views are thin configs on top of it (was `kano_listview`). |
| `source_code/ui_production_detail.js` | `ui_production_detail` | Canonical production detail. Self-contained: takes `{ productionId, onClose }`, fetches own data. All entry points render this identical experience. |
| `source_code/ui_production_edit.js` | `ui_production_edit` | Production new/edit drawer. |
| `source_code/ui_production_material_detail.js` | `ui_production_material_detail` | Material detail + `MaterialEditDrawer`. (Project mirror was misnamed `…_details` plural; row is singular.) |
| `source_code/ui_material_out.js` | `ui_material_out` | Material-out modal. Exports `openModal({ctx,pmId,onSaved})`, `fetchSummary(ctx,pmId)`, `renderSummary(data)`, `isAccType(type)`. |
| `source_code/ui_prepare_fabric.js` | `ui_prepare_fabric` | Prepare-fabric modal + PDF (was `preparefabric`). `buildFabricPdf` is the future `lib_pdf` extraction candidate. |
| `source_code/ui_record_nav.js` | `ui_record_nav` | Cross-record replace-navigation host. Mount one `RecordNav` per view root; cross-links close current + open target (never stacks). Depends on the two detail components + `ui_production_edit`. |

### `jblock` rows (inline React pasted into the DB; thin domain shells)

| File | NocoBase row name | Purpose |
|---|---|---|
| `jblock/view_production.js` | `view_production` | Thin domain config → `ui_list_engine` (SQL, status colors, card layout, detail/edit loaders, mounts `ui_record_nav`). |
| `jblock/view_production_material.js` | `view_production_material` | Thin domain config → `ui_list_engine` for `production_material`. |

### `JSAction` rows (thin action shells)

| File | NocoBase row name | Purpose |
|---|---|---|
| `jsaction/act_material_out.js` | `act_material_out` | Thin shell → `ui_material_out`. |
| `jsaction/act_prepare_fabric.js` | `act_prepare_fabric` | Thin shell → `ui_prepare_fabric`. |

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
