// =====================================================
// ui_record_nav — shared cross-record navigation host.
//
// Mount ONE RecordNav at a view root. It shows a production OR a
// production_material detail as a top-level drawer. Cross-links REPLACE (close
// current, open target), so navigation never stacks: production_ref ⇄ material
// row, back and forth indefinitely. Also hosts Edit + Delete for both types.
//
// EXPORTS:
//   RecordNav({ navRef })
//     navRef.open(type, id, helpers)  — type 'production' | 'material'.
//        Opens (or replaces) the detail for that record. `helpers` is the engine
//        helpers of the originating list (used to reload after edit/delete).
//
// Depends on: ui_production_detail, ui_production_material_detail, ui_production_edit.
// (No cycles: the detail rows bubble cross-links via callbacks, never load this.)
//
// NOTE (2026-07): loadCode converted from raw ctx.sql to ctx.api.resource() —
// ctx.sql.save() is admin/root-gated and silently fails per-record for other
// roles (see README §3). Do not revert to raw SQL.
//
// FIX (2026-08) — three silent-failure defects, all measured or reasoned from
// the view_diagnostic run. None of these were ctx.sql problems; the API
// conversion above was correct but incomplete.
//
//   1. SINGLE-FLIGHT LOADER. The cache stored the RESOLVED module, and only
//      after the fetch returned:
//          if (_codeCache[name]) return Promise.resolve(_codeCache[name]);
//          ... await ...
//          _codeCache[name] = compile(...)
//      Between the guard and the assignment the cache is empty, so every
//      caller that arrives inside that ~50ms window starts its OWN fetch and
//      its OWN compile. Compiling twice produces two distinct module objects
//      with separate internal state. The cache now stores the PROMISE,
//      assigned before the await, so concurrent callers share one in-flight
//      request. (On the old ctx.sql path this same window was what produced
//      "uid already exists" / the null-'sql' 500 — the duplicate-load bug and
//      the uid collision were the same window seen from two sides.)
//
//   2. FAIL LOUDLY, NOT EMPTILY. `(rows[0] && rows[0].code) || ''` compiled an
//      empty string into `undefined`, and `.catch(function(){})` threw the
//      real error away. A missing/renamed source_code row therefore produced a
//      component that rendered NOTHING, with no console output and no UI —
//      clicking a cross-link simply did nothing. Now: a missing row, an empty
//      row, or a row that compiles to nothing all THROW with the module name
//      in the message, failures are evicted from the cache so they can be
//      retried, and the error is surfaced in the UI (see 3).
//
//   3. VISIBLE FALLBACK. Previously `PDMod ? ce(...) : null` meant a failed
//      load was indistinguishable from "nothing to show". Now a failed or
//      still-loading module renders a real drawer with either a spinner or the
//      error text, so a dead cross-link is never silent.
//
// VERIFY (2026-08): this file loads 'ui_production_material_detail' (SINGULAR).
// The canonical Project file appears to be named ui_production_material_details
// (PLURAL). If the source_code row is the plural spelling, the material half of
// this nav has been silently dead — and under the OLD loader that failure was
// invisible. Confirm the exact row name and correct MODULES.material below if
// needed; the new loader will now surface the mismatch loudly on first use.
// =====================================================
const ce = React.createElement;
const { useState, useEffect } = React;
const { Modal, Drawer, Spin } = antd;

// module names in one place so a rename is a one-line change (and so the
// VERIFY note above has a single thing to point at)
const MODULES = {
  production: 'ui_production_detail',
  material: 'ui_production_material_detail',
  edit: 'ui_production_edit',
};

// ── notifications ──
// ctx.message is used elsewhere in this file's history; antd's message is the
// documented fallback. Guarded so a missing ctx.message can never itself throw
// inside an error path.
function notifyError(msg) {
  try { if (ctx && ctx.message && ctx.message.error) { ctx.message.error(msg); return; } } catch (e) {}
  try { if (antd && antd.message && antd.message.error) { antd.message.error(msg); return; } } catch (e) {}
  try { console.error(msg); } catch (e) {}
}
function notifySuccess(msg) {
  try { if (ctx && ctx.message && ctx.message.success) { ctx.message.success(msg); return; } } catch (e) {}
  try { if (antd && antd.message && antd.message.success) { antd.message.success(msg); return; } } catch (e) {}
}
function errText(e) {
  if (!e) return 'unknown error';
  const body = e.response && e.response.data;
  const apiMsg = body && body.errors && body.errors[0] && body.errors[0].message;
  return String(apiMsg || e.message || e);
}

// ── single-flight code loader ──
// Caches the PROMISE (see FIX 1). Failures are evicted so a transient network
// error doesn't poison the cache for the rest of the session.
const _codeCache = {};
function loadCode(name) {
  if (_codeCache[name]) return _codeCache[name];
  _codeCache[name] = ctx.api.resource('source_code').list({
    filter: { name: name },
    fields: ['code'],
    pageSize: 1,
  }).then(function (res) {
    const rows = (res && res.data && res.data.data) || [];
    // deliberately NOT `|| ''` — an empty-string fallback is what let a missing
    // row compile to `undefined` silently. Check the real value instead.
    const src = rows[0] && rows[0].code;
    if (!src) throw new Error('source_code row missing or empty: "' + name + '"');
    const mod = new Function('React', 'antd', 'dayjs', 'ctx', src)(React, antd, dayjs, ctx);
    if (!mod) throw new Error('source_code row "' + name + '" compiled to nothing — is its final `return { … }` missing?');
    return mod;
  }).catch(function (e) {
    delete _codeCache[name];
    throw e;
  });
  return _codeCache[name];
}

// ── fallback drawer: loading spinner or a real error, never silence ──
const LoadFallback = function (props) {
  return ce(Drawer, {
    open: !!props.open,
    onClose: props.onClose,
    title: props.title || 'Loading…',
    placement: 'right',
    width: 420,
    zIndex: 1050,
  },
    props.error
      ? ce('div', { style: { padding: 4 } },
          ce('div', { style: { fontWeight: 700, color: '#ef4444', fontSize: 14, marginBottom: 8 } },
            'Could not load ' + props.moduleName),
          ce('div', { style: { fontSize: 12, color: '#6b7280', lineHeight: 1.6, wordBreak: 'break-word' } }, props.error),
          ce('div', { style: { fontSize: 11, color: '#9ca3af', marginTop: 12, lineHeight: 1.6 } },
            'Check that a source_code row named "' + props.moduleName + '" exists and ends with a return statement.'))
      : ce('div', { style: { padding: 50, textAlign: 'center' } }, ce(Spin, null)));
};

const RecordNav = function (props) {
  const navRef = props.navRef;
  const sC = useState(null);   const current = sC[0];    const setCurrent = sC[1];   // {type,id}
  const sE = useState(null);   const editT = sE[0];      const setEditT = sE[1];     // {type,id}
  const sH = useState(null);   const hlp = sH[0];        const setHlp = sH[1];
  const sR = useState(0);      const rk = sR[0];         const setRk = sR[1];
  const sPD = useState(null);  const PDMod = sPD[0];     const setPDMod = sPD[1];
  const sMD = useState(null);  const MDMod = sMD[0];     const setMDMod = sMD[1];
  const sPE = useState(null);  const PEMod = sPE[0];     const setPEMod = sPE[1];
  // per-module load errors — null while loading, string once failed
  const sErr = useState({});   const loadErr = sErr[0];  const setLoadErr = sErr[1];

  useEffect(function () {
    function fail(key, name) {
      return function (e) {
        const msg = errText(e);
        setLoadErr(function (prev) {
          const next = Object.assign({}, prev); next[key] = msg; return next;
        });
        // loud in the console too — this used to be swallowed entirely
        try { console.error('[ui_record_nav] failed to load ' + name + ': ' + msg); } catch (x) {}
      };
    }
    loadCode(MODULES.production).then(setPDMod, fail('production', MODULES.production));
    loadCode(MODULES.material).then(setMDMod, fail('material', MODULES.material));
    loadCode(MODULES.edit).then(setPEMod, fail('edit', MODULES.edit));

    if (navRef) {
      navRef.open = function (type, id, helpers) {
        setHlp(helpers || null);
        setEditT(null);
        setCurrent({ type: type, id: id });
      };
    }
    return function () { if (navRef) navRef.open = null; };
  }, []);

  function bump() { setRk(function (k) { return k + 1; }); }
  function afterMutate() { bump(); if (hlp && hlp.reload) hlp.reload(); }

  function deleteProduction(id) {
    Modal.confirm({
      title: 'Delete production?', content: 'This production will be permanently deleted.',
      okText: 'Delete', okButtonProps: { danger: true },
      onOk: function () {
        return ctx.api.resource('production').destroy({ filterByTk: id })
          .then(function () { notifySuccess('Production deleted.'); setCurrent(null); afterMutate(); })
          .catch(function (e) { notifyError('Delete failed: ' + errText(e)); });
      },
    });
  }
  function deleteMaterial(id) {
    Modal.confirm({
      title: 'Delete production material?', content: 'This material will be permanently deleted.',
      okText: 'Delete', okButtonProps: { danger: true },
      onOk: function () {
        return ctx.api.resource('production_material').destroy({ filterByTk: id })
          .then(function () { notifySuccess('Material deleted.'); setCurrent(null); afterMutate(); })
          .catch(function (e) { notifyError('Delete failed: ' + errText(e)); });
      },
    });
  }

  const isProd = !!(current && current.type === 'production');
  const isMat = !!(current && current.type === 'material');
  const isEditProd = !!(editT && editT.type === 'production');
  const isEditMat = !!(editT && editT.type === 'material');

  return ce('div', null,
    // ── production detail ──
    (isProd && PDMod)
      ? ce(PDMod.ProductionDetailDrawer, {
          open: true, productionId: current.id, refreshKey: rk, zIndex: 1050,
          onClose: function () { setCurrent(null); },
          onEdit: function (id) { setEditT({ type: 'production', id: id }); },
          onDelete: function (id) { deleteProduction(id); },
          onOpenMaterial: function (pmId) { setCurrent({ type: 'material', id: pmId }); },
        })
      : null,
    (isProd && !PDMod)
      ? ce(LoadFallback, {
          open: true, title: 'Production', moduleName: MODULES.production,
          error: loadErr.production, onClose: function () { setCurrent(null); },
        })
      : null,

    // ── material detail ──
    (isMat && MDMod)
      ? ce(MDMod.ProductionMaterialDetailDrawer, {
          open: true, pmId: current.id, refreshKey: rk, zIndex: 1050,
          onClose: function () { setCurrent(null); },
          onEdit: function (id) { setEditT({ type: 'material', id: id }); },
          onDelete: function (id) { deleteMaterial(id); },
          onOpenProduction: function (productionId) { setCurrent({ type: 'production', id: productionId }); },
          onChanged: function () { bump(); },
        })
      : null,
    (isMat && !MDMod)
      ? ce(LoadFallback, {
          open: true, title: 'Material', moduleName: MODULES.material,
          error: loadErr.material, onClose: function () { setCurrent(null); },
        })
      : null,

    // ── production edit ──
    (isEditProd && PEMod)
      ? ce(PEMod.ProductionEditDrawer, {
          open: true, productionId: editT.id,
          onClose: function () { setEditT(null); },
          onSaved: function () { setEditT(null); afterMutate(); },
        })
      : null,
    (isEditProd && !PEMod)
      ? ce(LoadFallback, {
          open: true, title: 'Edit production', moduleName: MODULES.edit,
          error: loadErr.edit, onClose: function () { setEditT(null); },
        })
      : null,

    // ── material edit (lives in the material detail module) ──
    (isEditMat && MDMod)
      ? ce(MDMod.MaterialEditDrawer, {
          open: true, pmId: editT.id,
          onClose: function () { setEditT(null); },
          onSaved: function () { setEditT(null); afterMutate(); },
        })
      : null,
    (isEditMat && !MDMod)
      ? ce(LoadFallback, {
          open: true, title: 'Edit material', moduleName: MODULES.material,
          error: loadErr.material, onClose: function () { setEditT(null); },
        })
      : null
  );
};

return { RecordNav };
