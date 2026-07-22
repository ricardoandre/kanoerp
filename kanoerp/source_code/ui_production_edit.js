// =====================================================
// ui_production_edit — shared production CREATE + EDIT drawers.
//
// Stored as a `source_code` row named 'ui_production_edit'.
// Loaded via loadCode('ui_production_edit'); compiled with
//   new Function('React','antd','dayjs','ctx', src)(React, antd, dayjs, ctx).
//
// EXPORTS (contract):
//   ProductionNewDrawer({ open, onClose, onCreated })
//       — self-contained "New Production" drawer. Self-fetches options.
//         onCreated(newId) fires after a successful insert (production + variants;
//         BOM/sample are written by the NocoBase workflow on insert).
//
//   ProductionEditDrawer({ open, productionId, onClose, onSaved })
//       — self-contained "Edit Production" drawer. Self-fetches options + the
//         record for productionId (details, variants, materials). onSaved() fires
//         after a successful update. zIndex 1100 so it sits above a detail drawer.
//
// 2026-07 MIGRATION: all reads/writes moved off raw ctx.sql onto
// ctx.api.resource() (fetchAllPages), same fix already applied to
// ui_production_addmarker.js — raw ctx.sql and any getRels()-style runtime
// query against the `fields` meta-collection are admin/root-gated and
// silently fail (or throw a "No permissions" toast even when the write
// itself falls back and succeeds) for non-admin roles. belongsTo relation
// field names below are hardcoded from the schema dump, not resolved at
// runtime, per the same reasoning as MARKER_RELS in
// ui_production_addmarker.js.
//
// FIX (marker_remarks): the old "Marker" card read/wrote a `marker` column
// on production that does not exist — the real column is `marker_remarks`.
//
// MARKER INTEGRATION: the Edit Production drawer's "Markers" card embeds
// ui_production_addmarker.js's MarkerContent component directly (loaded
// lazily, same source_code as the standalone "Add Marker" modal) —
// existing markers, reuse suggestions (same product / same model), manual
// product-code lookup, add-new-marker form, and marker_remarks notes are
// all handled there, exactly as in that modal. Rendered with
// `embedded: true`, which hides the modal-only chrome (title bar, close
// button, product-info box — redundant next to this drawer's own Details
// card). Marker actions are immediate writes, independent of this drawer's
// own "Save changes" button — same as standalone usage. This drawer no
// longer owns marker_remarks itself: MarkerContent is the single source of
// truth for that field.
//
// Card order: Details → Materials → Quantity → Markers → Remarks.
//
// Depends on: none (but the Edit drawer lazily loads the 'ui_production_addmarker'
// source_code row at runtime for the Markers card).
// =====================================================
const { Drawer, Select, DatePicker, InputNumber, Switch, Spin, Modal, message } = antd;
const ce = React.createElement;
const { useState, useEffect, useRef } = React;

const num = v => Number(v == null ? 0 : v);
const STATUS_OPTIONS = ['planning', 'cutting', 'production', 'qc', 'permak', 'done'];
const STATUS_LABEL = { planning: 'Planning', cutting: 'Cutting', production: 'Production', qc: 'QC', permak: 'Permak', done: 'Done' };
const sLabel = v => STATUS_LABEL[String(v || '').toLowerCase()] || (v || '-');

const fieldLabel = t => ce('div', { style: { fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' } }, t);

// ── resource-based read helpers (non-admin-safe), same pattern as
// ui_production_addmarker.js / product_measurement.js ──
const DEFAULT_PAGE_SIZE = 1000;
function fetchAllPages(resourceName, params) {
  const pageSize = (params && params.pageSize) || DEFAULT_PAGE_SIZE;
  function loadPage(page, acc) {
    return ctx.api.resource(resourceName).list(Object.assign({}, params, { pageSize: pageSize, page: page }))
      .then(function (res) {
        const rows = (res && res.data && res.data.data) || [];
        const merged = acc.concat(rows);
        if (rows.length < pageSize) return merged;
        return loadPage(page + 1, merged);
      });
  }
  return loadPage(1, []);
}

// resource-based source_code loader (non-admin-safe) — used to lazily load
// ui_production_addmarker.js for the embedded Markers card.
const _moduleCache = {};
function loadModule(name) {
  if (_moduleCache[name]) return Promise.resolve(_moduleCache[name]);
  return ctx.api.resource('source_code').list({ filter: { name: name }, fields: ['code'], pageSize: 1 })
    .then(function (res) {
      const rows = (res && res.data && res.data.data) || [];
      const src = (rows[0] && rows[0].code) || '';
      if (!src) throw new Error("source_code row '" + name + "' was not found or is empty.");
      _moduleCache[name] = new Function('React', 'antd', 'dayjs', 'ctx', src)(React, antd, dayjs, ctx);
      return _moduleCache[name];
    });
}

const EDIT_CSS =
  ".pe-edit-drawer .ant-drawer-content-wrapper{width:min(580px,100vw) !important;}" +
  "@media (max-width:700px){.pe-edit-drawer .ant-drawer-content-wrapper{width:100% !important;}}" +
  ".pe-new-drawer .ant-drawer-content-wrapper{width:min(480px,100vw) !important;}" +
  "@media (max-width:700px){.pe-new-drawer .ant-drawer-content-wrapper{width:100% !important;}}" +
  ".pe-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}" +
  "@media (max-width:700px){.pe-grid2{grid-template-columns:1fr;}}";
const EditStyles = () => ce('style', null, EDIT_CSS);

// =====================================================
// OPTIONS (self-fetched, cached for the jblock lifetime)
// =====================================================
let _optsCache = null;
function fetchOptions() {
  if (_optsCache) return Promise.resolve(_optsCache);
  return Promise.all([
    fetchAllPages('product', { fields: ['code', 'name'], sort: ['name'] }),
    fetchAllPages('konveksi', { fields: ['code', 'name'], sort: ['name'] }),
    fetchAllPages('sku_option', { fields: ['id', 'display'], sort: ['sort'] }),
    fetchAllPages('material_details', { fields: ['code'], sort: ['code'] }),
  ]).then(function(r) { _optsCache = { prods: r[0], konvs: r[1], skus: r[2], mats: r[3] }; return _optsCache; });
}

function fetchEditRecord(id) {
  return Promise.all([
    fetchAllPages('production', { filter: { id: id }, fields: ['fk_product_code', 'fk_konveksi_code', 'is_new', 'planning_rol', 'status', 'est_production_start', 'est_production_finish', 'remarks'], pageSize: 1 }),
    fetchAllPages('production_quantity_details', { filter: { fk_production_id: id }, fields: ['id', 'fk_sku_option_id', 'ratio', 'quantity', 'cut_quantity'], appends: ['sku_option'] }),
    fetchAllPages('production_material', { filter: { fk_production_id: id }, fields: ['id', 'fk_material_details_code', 'quantity_need'], sort: ['id'] }),
  ]).then(function(r) {
    const qds = (r[1] || []).map(function (q) {
      const sk = q.sku_option || {};
      return { id: q.id, sku_id: q.fk_sku_option_id, variant: sk.display || '', sku_sort: sk.sort || 0, ratio: q.ratio, quantity: q.quantity, cut_quantity: q.cut_quantity };
    }).sort(function (a, b) { return a.sku_sort - b.sku_sort; });
    const materials = (r[2] || []).map(function (m) {
      return { id: m.id, material_code: m.fk_material_details_code, quantity_need: m.quantity_need };
    });
    return { record: r[0][0] || {}, quantityDetails: qds, materials: materials };
  });
}

// =====================================================
// belongsTo relation field names — HARDCODED, confirmed from the schema
// dump, rather than resolved at runtime via ctx.api.resource('fields'),
// which non-admin roles can't read. Same reasoning as MARKER_RELS in
// ui_production_addmarker.js.
// =====================================================
const PRODUCTION_RELS = {
  fk_product_code:  { field: 'product_code', targetKey: 'code' }, // product's primary key is `code`
  fk_konveksi_code: { field: 'konveksi',     targetKey: 'code' }, // konveksi's primary key is `code`
};
const QD_RELS = {
  fk_production_id: { field: 'production',  targetKey: 'id' },
  fk_sku_option_id: { field: 'sku_option',  targetKey: 'id' },
};
// production_material has no belongsTo relations configured on its FK
// columns — writes below already use raw fk_production_id /
// fk_material_details_code values directly, no map needed.

function assocFragment(rels, fkColumn, value) {
  const rel = rels[fkColumn];
  const out = {};
  if (rel && value != null) { out[rel.field] = {}; out[rel.field][rel.targetKey] = value; }
  else { out[fkColumn] = value; }
  return out;
}

async function createProduction(form) {
  // brand, production_ref, uniqueness, production_material (BOM) and
  // production_sample are handled by the NocoBase workflow on insert.
  const values = { is_new: !!form.is_new, planning_rol: form.planning_rol, status: 'planning' };
  Object.assign(values, assocFragment(PRODUCTION_RELS, 'fk_product_code',  form.product));
  Object.assign(values, assocFragment(PRODUCTION_RELS, 'fk_konveksi_code', form.konveksi));
  const res = await ctx.api.resource('production').create({ values });
  const newId = (res && res.data && res.data.data && res.data.data.id) || (res && res.data && res.data.id);
  if (!newId) throw new Error('Production created but no id returned.');

  for (const row of (form.variants || [])) {
    if (!row.sku) continue;
    const v = { ratio: row.ratio };
    Object.assign(v, assocFragment(QD_RELS, 'fk_production_id', newId));
    Object.assign(v, assocFragment(QD_RELS, 'fk_sku_option_id', row.sku));
    await ctx.api.resource('production_quantity_details').create({ values: v });
  }
  return newId;
}

async function updateProduction(id, form) {
  const values = {
    is_new: !!form.is_new,
    planning_rol: form.planning_rol,
    status: form.status,
    est_production_start:  form.est_start  ? form.est_start.format('YYYY-MM-DD')  : null,
    est_production_finish: form.est_finish ? form.est_finish.format('YYYY-MM-DD') : null,
    remarks: form.remarks,
  };
  Object.assign(values, assocFragment(PRODUCTION_RELS, 'fk_product_code',  form.product));
  Object.assign(values, assocFragment(PRODUCTION_RELS, 'fk_konveksi_code', form.konveksi));
  await ctx.api.resource('production').update({ filterByTk: id, values });

  for (const qd of (form.quantityDetails || [])) {
    if (qd.id) {
      await ctx.api.resource('production_quantity_details').update({ filterByTk: qd.id, values: { ratio: qd.ratio, quantity: qd.quantity, cut_quantity: qd.cut_quantity } });
    } else if (qd.sku_id) {
      const v = { ratio: qd.ratio, quantity: qd.quantity, cut_quantity: qd.cut_quantity };
      Object.assign(v, assocFragment(QD_RELS, 'fk_production_id', id));
      Object.assign(v, assocFragment(QD_RELS, 'fk_sku_option_id', qd.sku_id));
      await ctx.api.resource('production_quantity_details').create({ values: v });
    }
  }
  for (const delId of (form.deletedQuantityIds || [])) {
    await ctx.api.resource('production_quantity_details').destroy({ filterByTk: delId });
  }
  for (const m of (form.materials || [])) {
    if (!m.material_code) continue;
    if (m.id) {
      await ctx.api.resource('production_material').update({ filterByTk: m.id, values: { fk_material_details_code: m.material_code, quantity_need: m.quantity_need } });
    } else {
      await ctx.api.resource('production_material').create({ values: { fk_production_id: id, fk_material_details_code: m.material_code, quantity_need: m.quantity_need, status: 'pending' } });
    }
  }
}

// =====================================================
// RICH TEXT EDITOR (uncontrolled after mount → no cursor jump)
// =====================================================
const RichTextEditor = function(props) {
  const ref = useRef(null);
  const docRef = useRef(null);
  useEffect(function() {
    if (ref.current) { docRef.current = ref.current.ownerDocument; ref.current.innerHTML = props.value || ''; }
  }, []);
  function sync() { if (props.onChange && ref.current) props.onChange(ref.current.innerHTML); }
  function exec(cmd, val) { const d = docRef.current; if (!d || !ref.current) return; ref.current.focus(); try { d.execCommand(cmd, false, val || null); } catch (e) {} sync(); }
  const btn = (label, cmd, val, title, style) => ce('button', {
    type: 'button', title: title || label, onMouseDown: e => e.preventDefault(), onClick: () => exec(cmd, val),
    style: Object.assign({ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 6, minWidth: 30, height: 28, padding: '0 8px', cursor: 'pointer', fontSize: 13, color: '#374151' }, style || {}),
  }, label);
  return ce('div', { style: { border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' } },
    ce('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, padding: 6, background: '#f8fafc', borderBottom: '1px solid #e5e7eb' } },
      btn('B', 'bold', null, 'Bold', { fontWeight: 800 }),
      btn('I', 'italic', null, 'Italic', { fontStyle: 'italic', fontWeight: 700 }),
      btn('U', 'underline', null, 'Underline', { textDecoration: 'underline', fontWeight: 700 }),
      btn('H', 'formatBlock', '<h3>', 'Heading', { fontWeight: 800 }),
      btn('P', 'formatBlock', '<p>', 'Paragraph'),
      btn('• List', 'insertUnorderedList', null, 'Bullet list'),
      btn('1. List', 'insertOrderedList', null, 'Numbered list'),
      btn('⨯', 'removeFormat', null, 'Clear formatting')),
    ce('div', { ref: ref, contentEditable: true, onInput: sync,
      style: { minHeight: 120, maxHeight: 280, overflowY: 'auto', padding: '10px 12px', fontSize: 13, color: '#374151', lineHeight: 1.6, outline: 'none' } })
  );
};

// =====================================================
// NEW DRAWER
// =====================================================
const ProductionNewDrawer = function(props) {
  const sO = useState({});    const opts = sO[0];      const setOpts = sO[1];
  const fp = useState(null);  const product = fp[0];   const setProduct = fp[1];
  const fn = useState(false); const isNew = fn[0];     const setIsNew = fn[1];
  const fk = useState(null);  const konveksi = fk[0];  const setKonveksi = fk[1];
  const fr = useState(null);  const rol = fr[0];       const setRol = fr[1];
  const fv = useState([{ sku: null, ratio: null }]); const variants = fv[0]; const setVariants = fv[1];
  const fb = useState(false); const busy = fb[0];      const setBusy = fb[1];
  const fe = useState({});    const errs = fe[0];      const setErrs = fe[1];

  // On open: fetch dropdown options, then apply initialValues (duplicate flow)
  // if given, else leave whatever is currently in state (reset() handles the
  // normal Add-button blank-slate case on close/submit).
  useEffect(function() {
    if (!props.open) return;
    fetchOptions().then(function(o) {
      setOpts(o);
      const iv = props.initialValues;
      if (iv) {
        setProduct(iv.product || null);
        setIsNew(!!iv.is_new);
        setKonveksi(iv.konveksi || null);
        setRol(iv.rol != null ? iv.rol : null);
        setVariants((iv.variants && iv.variants.length) ? iv.variants.map(function(v) { return { sku: v.sku, ratio: v.ratio }; }) : [{ sku: null, ratio: null }]);
      }
    }).catch(() => {});
  }, [props.open]);

  function reset() { setProduct(null); setIsNew(false); setKonveksi(null); setRol(null); setVariants([{ sku: null, ratio: null }]); setErrs({}); }
  function setVar(i, key, val) { setVariants(prev => prev.map((r, j) => j === i ? Object.assign({}, r, { [key]: val }) : r)); }
  async function submit() {
    const e = {};
    if (!product) e.product = true;
    if (!konveksi) e.konveksi = true;
    if (rol == null || rol === '') e.rol = true;
    const validVariants = (variants || []).filter(v => v.sku);
    if (!validVariants.length) e.variants = true;
    setErrs(e);
    if (Object.keys(e).length) return message.warning('Please fill the highlighted fields.');
    setBusy(true);
    try {
      const newId = await createProduction({ product, konveksi, is_new: isNew, planning_rol: rol, variants });
      message.success('Production created.');
      reset();
      props.onCreated(newId);
    } catch (e2) {
      message.error('Create failed: ' + ((e2 && e2.message) || e2));
    } finally {
      setBusy(false);
    }
  }

  const formFields = ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      ce(EditStyles, null),
      ce('div', null, fieldLabel('Product'),
        ce(Select, { showSearch: true, status: errs.product ? 'error' : '', value: product, onChange: v => { setProduct(v); setErrs(p => Object.assign({}, p, { product: false })); }, style: { width: '100%' }, placeholder: 'Search code or name…', filterOption: (i, o) => String(o.label).toLowerCase().includes(i.toLowerCase()), options: (opts.prods || []).map(p => ({ value: p.code, label: (p.code || '') + ' — ' + (p.name || '') })) })),
      ce('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } }, ce(Switch, { checked: isNew, onChange: setIsNew }), ce('span', { style: { fontSize: 13, color: '#374151' } }, 'Is new product')),
      ce('div', null, fieldLabel('Konveksi'),
        ce(Select, { showSearch: true, status: errs.konveksi ? 'error' : '', value: konveksi, onChange: v => { setKonveksi(v); setErrs(p => Object.assign({}, p, { konveksi: false })); }, style: { width: '100%' }, placeholder: 'Select konveksi…', filterOption: (i, o) => String(o.label).toLowerCase().includes(i.toLowerCase()), options: (opts.konvs || []).map(k => ({ value: k.code, label: k.name })) })),
      ce('div', null, fieldLabel('Planning ROL'), ce(InputNumber, { status: errs.rol ? 'error' : '', value: rol, onChange: v => { setRol(v); setErrs(p => Object.assign({}, p, { rol: false })); }, style: { width: '100%' }, min: 0, placeholder: '0' })),
      ce('div', null, ce('div', { style: { fontSize: 11, fontWeight: 600, color: errs.variants ? '#ef4444' : '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' } }, 'Variants (sku + ratio)'),
        ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          variants.map((v, i) =>
            ce('div', { key: i, style: { display: 'flex', gap: 8, alignItems: 'center' } },
              ce(Select, { showSearch: true, value: v.sku, onChange: val => setVar(i, 'sku', val), style: { flex: 1 }, placeholder: 'SKU', filterOption: (inp, o) => String(o.label).toLowerCase().includes(inp.toLowerCase()), options: (opts.skus || []).map(s => ({ value: s.id, label: s.display })) }),
              ce(InputNumber, { value: v.ratio, onChange: val => setVar(i, 'ratio', val), placeholder: 'ratio', min: 0, style: { width: 90 } }),
              ce('button', { onClick: () => setVariants(prev => prev.filter((_, j) => j !== i)), style: { border: 'none', background: '#fef2f2', color: '#ef4444', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 14 } }, '×'))),
          ce('button', { onClick: () => setVariants(prev => prev.concat([{ sku: null, ratio: null }])), style: { border: '1px dashed #cbd5e1', background: '#f8fafc', color: '#475569', borderRadius: 8, padding: '6px 0', cursor: 'pointer', fontSize: 12, fontWeight: 600 } }, '+ Add variant'))));

  const footerButtons = ce('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
    ce('button', { onClick: () => { reset(); props.onClose(); }, style: { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13 } }, 'Cancel'),
    ce('button', { onClick: submit, disabled: busy, style: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 } }, busy ? 'Creating…' : 'Create'));

  // inline=true → bare content for hosting inside Modal.confirm (duplicate flow,
  // openDuplicateDrawer below). Same fields, same submit() — just no antd
  // Drawer wrapper.
  if (props.inline) {
    return ce('div', { style: { padding: 4 } }, formFields, ce('div', { style: { marginTop: 16 } }, footerButtons));
  }

  // optional DrawerShell (from lib_drawer_shell) for callers that preload
  // it — falls back to the plain antd Drawer if not passed, so any existing
  // caller not passing DrawerShell is unaffected.
  if (props.DrawerShell) {
    return ce(props.DrawerShell, {
      open: props.open, onClose: () => { reset(); props.onClose(); }, title: 'New Production',
      width: 480, placement: 'right', rootClassName: 'pe-new-drawer', footer: footerButtons,
    }, formFields);
  }

  return ce(Drawer, {
    open: props.open, title: 'New Production', width: 480, placement: 'right', rootClassName: 'pe-new-drawer',
    onClose: () => { reset(); props.onClose(); },
    footer: footerButtons,
  }, formFields);
};

// =====================================================
// EDIT DRAWER (titled rounded section cards · responsive · zIndex 1100)
// =====================================================
const ProductionEditDrawer = function(props) {
  const id = props.productionId || null;
  const sL = useState(true);  const loading = sL[0];  const setLoading = sL[1];
  const sB = useState(false); const busy = sB[0];     const setBusy = sB[1];
  const sO = useState({});    const opts = sO[0];     const setOpts = sO[1];
  const sf = useState({});    const form = sf[0];     const setForm = sf[1];
  const sq = useState([]);    const qds = sq[0];      const setQds = sq[1];
  const sxm = useState([]);   const mats = sxm[0];    const setMats = sxm[1];
  const sDQ = useState([]);   const delQ = sDQ[0];    const setDelQ = sDQ[1];
  const sMM = useState(null); const MarkerMod = sMM[0]; const setMarkerMod = sMM[1];

  useEffect(function() {
    if (!props.open || !id) return;
    setLoading(true);
    Promise.all([fetchEditRecord(id), fetchOptions(), loadModule('ui_production_addmarker')]).then(function(r) {
      const d = r[0]; const rec = d.record || {};
      setOpts(r[1] || {});
      setMarkerMod(r[2] || null);
      setForm({
        product: rec.fk_product_code || null, konveksi: rec.fk_konveksi_code || null,
        is_new: rec.is_new === true || String(rec.is_new) === 'true' || rec.is_new === 1,
        rol: rec.planning_rol != null ? Number(rec.planning_rol) : null, status: rec.status || 'planning',
        est_start: rec.est_production_start ? dayjs(rec.est_production_start) : null,
        est_finish: rec.est_production_finish ? dayjs(rec.est_production_finish) : null,
        remarks: rec.remarks || '',
      });
      setQds((d.quantityDetails || []).map(q => ({ id: q.id, sku_id: q.sku_id, variant: q.variant, ratio: num(q.ratio), quantity: num(q.quantity), cut_quantity: num(q.cut_quantity) })));
      setDelQ([]);
      setMats((d.materials || []).map(m => ({ id: m.id, material_code: m.material_code, quantity_need: m.quantity_need != null ? Number(m.quantity_need) : null })));
      setLoading(false);
    }).catch(function(e) { message.error('Load failed: ' + ((e && e.message) || e)); setLoading(false); });
  }, [props.open, id]);

  function setF(key, val) { setForm(prev => Object.assign({}, prev, { [key]: val })); }
  function setQd(i, key, val) { setQds(prev => prev.map((r, j) => j === i ? Object.assign({}, r, { [key]: val }) : r)); }
  function addQd() { setQds(prev => prev.concat([{ id: null, sku_id: null, variant: '', ratio: 0, quantity: 0, cut_quantity: 0 }])); }
  function removeQd(i) { const row = qds[i]; if (row && row.id) setDelQ(d => d.concat([row.id])); setQds(prev => prev.filter((_, j) => j !== i)); }
  function setMat(i, key, val) { setMats(prev => prev.map((r, j) => j === i ? Object.assign({}, r, { [key]: val }) : r)); }
  async function submit() {
    if (!form.product) return message.warning('Select a product.');
    if (!form.konveksi) return message.warning('Select a konveksi.');
    setBusy(true);
    try { await updateProduction(id, { product: form.product, konveksi: form.konveksi, is_new: form.is_new, planning_rol: form.rol, status: form.status, est_start: form.est_start, est_finish: form.est_finish, remarks: form.remarks, quantityDetails: qds, deletedQuantityIds: delQ, materials: mats }); message.success('Production updated.'); props.onSaved(); }
    catch (e) { message.error('Update failed: ' + ((e && e.message) || e)); } finally { setBusy(false); }
  }

  function card(title, accent, body) {
    return ce('div', { style: { border: '1px solid #eef0f3', borderRadius: 14, background: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' } },
      ce('div', { style: { display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', background: '#f8fafc', borderBottom: '1px solid #eef0f3' } },
        ce('span', { style: { width: 9, height: 9, borderRadius: 999, background: accent } }),
        ce('span', { style: { fontSize: 12, fontWeight: 800, letterSpacing: '0.05em', color: '#0f172a', textTransform: 'uppercase' } }, title)),
      ce('div', { style: { padding: 14, display: 'flex', flexDirection: 'column', gap: 14 } }, body));
  }

  const detailsBody = ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
    ce('div', null, fieldLabel('Product'), ce(Select, { showSearch: true, value: form.product, onChange: v => setF('product', v), style: { width: '100%' }, filterOption: (i, o) => String(o.label).toLowerCase().includes(i.toLowerCase()), options: (opts.prods || []).map(p => ({ value: p.code, label: (p.code || '') + ' — ' + (p.name || '') })) })),
    ce('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } }, ce(Switch, { checked: !!form.is_new, onChange: v => setF('is_new', v) }), ce('span', { style: { fontSize: 13, color: '#374151' } }, 'Is new product')),
    ce('div', null, fieldLabel('Konveksi'), ce(Select, { showSearch: true, value: form.konveksi, onChange: v => setF('konveksi', v), style: { width: '100%' }, filterOption: (i, o) => String(o.label).toLowerCase().includes(i.toLowerCase()), options: (opts.konvs || []).map(k => ({ value: k.code, label: k.name })) })),
    ce('div', { className: 'pe-grid2' },
      ce('div', null, fieldLabel('Planning ROL'), ce(InputNumber, { value: form.rol, onChange: v => setF('rol', v), style: { width: '100%' }, min: 0 })),
      ce('div', null, fieldLabel('Status'), ce(Select, { value: form.status, onChange: v => setF('status', v), style: { width: '100%' }, options: STATUS_OPTIONS.map(s => ({ value: s, label: sLabel(s) })) }))),
    ce('div', { className: 'pe-grid2' },
      ce('div', null, fieldLabel('Est. start'), ce(DatePicker, { format: 'DD/MM/YYYY', value: form.est_start, onChange: v => setF('est_start', v), style: { width: '100%' } })),
      ce('div', null, fieldLabel('Est. finish'), ce(DatePicker, { format: 'DD/MM/YYYY', value: form.est_finish, onChange: v => setF('est_finish', v), style: { width: '100%' } }))));

  const remarksBody = ce('div', null,
    ce(RichTextEditor, { key: 'rte_' + (id || 'new'), value: form.remarks, onChange: v => setF('remarks', v) }),
    ce('div', { style: { fontSize: 10, color: '#cbd5e1', marginTop: 4 } }, 'Rich text — rendered in the detail view'));

  // Markers card body — embeds the SAME MarkerContent component used by the
  // standalone "Add Marker" modal (ui_production_addmarker.js), loaded
  // lazily. embedded:true hides its modal-only chrome. Marker
  // create/link/unlink and marker_remarks notes save immediately, wired to
  // props.onSaved so the host (list/detail) picks up the change too — same
  // as the standalone modal's behavior.
  const markersBody = !MarkerMod
    ? ce('div', { style: { padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading marker tools…')
    : ce(MarkerMod.MarkerContent, { ctx: ctx, productionId: id, onSaved: props.onSaved, embedded: true });

  const usedSkuIds = qds.map(q => q.sku_id).filter(Boolean);
  const skuOpt = (currentId) => (opts.skus || []).filter(s => s.id === currentId || usedSkuIds.indexOf(s.id) === -1).map(s => ({ value: s.id, label: s.display }));
  const qcol = { width: 70 };
  const qtyBody = ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
    ce('div', { style: { display: 'flex', gap: 8, fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', paddingLeft: 2 } },
      ce('div', { style: { flex: 1 } }, 'Variant'), ce('div', { style: { width: 70 } }, 'Ratio'), ce('div', { style: { width: 70 } }, 'Qty'), ce('div', { style: { width: 70 } }, 'Cut'), ce('div', { style: { width: 30 } }, '')),
    qds.length === 0 ? ce('div', { style: { fontSize: 12, color: '#d1d5db', fontStyle: 'italic' } }, 'No variants') : null,
    qds.map((q, i) => ce('div', { key: i, style: { display: 'flex', gap: 8, alignItems: 'center' } },
      q.id
        ? ce('div', { style: { flex: 1, fontSize: 13, color: '#374151', fontWeight: 600 } }, q.variant)
        : ce(Select, { showSearch: true, value: q.sku_id, onChange: v => setQd(i, 'sku_id', v), placeholder: 'SKU', style: { flex: 1 }, filterOption: (inp, o) => String(o.label).toLowerCase().includes(inp.toLowerCase()), options: skuOpt(q.sku_id) }),
      ce(InputNumber, { value: q.ratio, onChange: v => setQd(i, 'ratio', v), min: 0, style: qcol }),
      ce(InputNumber, { value: q.quantity, onChange: v => setQd(i, 'quantity', v), min: 0, style: qcol }),
      ce(InputNumber, { value: q.cut_quantity, onChange: v => setQd(i, 'cut_quantity', v), min: 0, style: qcol }),
      ce('button', { onClick: () => removeQd(i), style: { border: 'none', background: '#fef2f2', color: '#ef4444', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 14, flexShrink: 0 } }, '×'))),
    ce('button', { onClick: addQd, style: { border: '1px dashed #cbd5e1', background: '#f8fafc', color: '#475569', borderRadius: 8, padding: '6px 0', cursor: 'pointer', fontSize: 12, fontWeight: 600, marginTop: 2 } }, '+ Add variant'));

  const matBody = ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
    mats.map((m, i) => ce('div', { key: i, style: { display: 'flex', gap: 8, alignItems: 'center' } },
      ce(Select, { showSearch: true, value: m.material_code, onChange: v => setMat(i, 'material_code', v), style: { flex: 1 }, placeholder: 'material_details code', filterOption: (inp, o) => String(o.label).toLowerCase().includes(inp.toLowerCase()), options: (opts.mats || []).map(o => ({ value: o.code, label: o.code })) }),
      ce(InputNumber, { value: m.quantity_need, onChange: v => setMat(i, 'quantity_need', v), placeholder: 'need', min: 0, style: { width: 90 } }),
      ce('button', { onClick: () => setMats(prev => prev.filter((_, j) => j !== i)), style: { border: 'none', background: '#fef2f2', color: '#ef4444', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 14 } }, '×'))),
    ce('button', { onClick: () => setMats(prev => prev.concat([{ id: null, material_code: null, quantity_need: null }])), style: { border: '1px dashed #cbd5e1', background: '#f8fafc', color: '#475569', borderRadius: 8, padding: '6px 0', cursor: 'pointer', fontSize: 12, fontWeight: 600 } }, '+ Add material'));

  const footerNode = ce('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
    ce('button', { onClick: props.onClose, style: { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13 } }, 'Cancel'),
    ce('button', { onClick: submit, disabled: busy || loading, style: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 20px', fontSize: 13, fontWeight: 700, cursor: (busy || loading) ? 'not-allowed' : 'pointer', opacity: (busy || loading) ? 0.6 : 1, boxShadow: '0 1px 3px rgba(79,70,229,0.4)' } }, busy ? 'Saving…' : 'Save changes'));

  const contentNode = ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
    ce(EditStyles, null),
    card('Details',   '#6366f1', detailsBody),
    card('Materials', '#f97316', matBody),
    card('Quantity',  '#84cc16', qtyBody),
    card('Markers',   '#a855f7', markersBody),
    card('Remarks',   '#0ea5e9', remarksBody),
    ce('div', { style: { height: 24 } }));

  // optional DrawerShell (from lib_drawer_shell) — its own `loading` prop
  // shows a centered Spin and hides the footer while loading is true, same
  // as this drawer's fallback path below, so contentNode can be passed
  // unconditionally here.
  if (props.DrawerShell) {
    return ce(props.DrawerShell, {
      open: props.open, onClose: props.onClose, title: 'Edit Production',
      width: 580, placement: 'right', rootClassName: 'pe-edit-drawer', zIndex: 1100,
      loading: loading, footer: footerNode,
    }, contentNode);
  }

  return ce(Drawer, {
    open: props.open, title: 'Edit Production', width: 580, placement: 'right', onClose: props.onClose,
    rootClassName: 'pe-edit-drawer', zIndex: 1100,
    footer: footerNode,
  },
    loading
      ? ce('div', { style: { padding: 60, textAlign: 'center' } }, ce(Spin, null))
      : contentNode
  );
};

// =====================================================
// DUPLICATE — fetch a source production's template fields (product,
// konveksi, is_new, planning ROL, variant ratios) and open the New
// Production form pre-filled, so the user edits before saving. Nothing is
// written until Create is clicked — reuses createProduction, same as a
// normal Add. NOT copied: remarks, marker_remarks, quantity/cut_quantity
// (actual run figures), production_material (BOM), production_sample —
// BOM/sample are regenerated fresh by the on-insert workflow, same as any
// new production.
//
// Hosted via Modal.confirm content — the same proven pattern already used
// for the Material Out entry form (MaterialOutContent): a stateful React
// element passed as `content`, own Cancel/Create buttons, closed with
// Modal.destroyAll(). No portal/CSS tricks needed.
//
// RESTORED 2026-07: this function (and fetchDuplicateSource, and
// ProductionNewDrawer's initialValues/inline support) had been dropped from
// an earlier pass of this file, silently breaking the "Duplicate" bulk
// action in view_production.js (PE.openDuplicateDrawer was undefined). Not
// caught earlier since view_production.js wasn't live yet. Converted to
// ctx.api.resource() here rather than restoring the old raw-SQL version.
// =====================================================
function fetchDuplicateSource(sourceId) {
  return Promise.all([
    fetchAllPages('production', { filter: { id: sourceId }, fields: ['fk_product_code', 'fk_konveksi_code', 'is_new', 'planning_rol'], pageSize: 1 }),
    fetchAllPages('production_quantity_details', { filter: { fk_production_id: sourceId }, fields: ['fk_sku_option_id', 'ratio'], sort: ['id'] }),
  ]).then(function(r) {
    const rec = r[0][0];
    if (!rec) throw new Error('Source production not found.');
    return {
      product: rec.fk_product_code,
      konveksi: rec.fk_konveksi_code,
      is_new: rec.is_new === true || String(rec.is_new) === 'true' || rec.is_new === 1,
      rol: rec.planning_rol != null ? Number(rec.planning_rol) : null,
      variants: (r[1] || []).map(function(q) { return { sku: q.fk_sku_option_id, ratio: q.ratio }; }),
    };
  });
}

async function openDuplicateDrawer(sourceId, opts) {
  opts = opts || {};
  const initialValues = await fetchDuplicateSource(sourceId);
  Modal.confirm({
    title: 'Duplicate Production',
    width: 480,
    icon: null,
    content: ce(ProductionNewDrawer, {
      inline: true,
      open: true,
      initialValues: initialValues,
      onClose: function() { Modal.destroyAll(); if (opts.onClose) opts.onClose(); },
      onCreated: function(newId) {
        Modal.destroyAll();
        if (opts.onCreated) opts.onCreated(newId);
      },
    }),
    okButtonProps: { style: { display: 'none' } },
    cancelButtonProps: { style: { display: 'none' } },
    maskClosable: false,
    onCancel() {},
  });
}

return { ProductionNewDrawer, ProductionEditDrawer, openDuplicateDrawer };
