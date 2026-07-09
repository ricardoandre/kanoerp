// =====================================================
// ui_production_edit — shared production CREATE + EDIT drawers.
//
// Stored as a `source_code` row named 'ui_production_edit'.
// Loaded via loadCode('ui_production_edit'); compiled with
//   new Function('React','antd','dayjs','ctx', src)(React, antd, dayjs, ctx).
//
// EXPORTS (contract):
//   ProductionNewDrawer({ open, onClose, onCreated, initialValues? })
//       — self-contained "New Production" drawer. Self-fetches options.
//         onCreated(newId) fires after a successful insert (production + variants;
//         BOM/sample are written by the NocoBase workflow on insert).
//         initialValues (optional): { product, konveksi, is_new, rol, variants }
//         — pre-fills the form (used by openDuplicateDrawer). Omit for a blank form.
//
//   ProductionEditDrawer({ open, productionId, onClose, onSaved })
//       — self-contained "Edit Production" drawer. Self-fetches options + the
//         record for productionId (details, variants, materials). onSaved() fires
//         after a successful update. zIndex 1100 so it sits above a detail drawer.
//
//   openDuplicateDrawer(ctx, sourceId)
//       — fetches source production's fields + variant ratios, then opens
//         ProductionNewDrawer pre-filled so the user can edit before saving.
//         Nothing is written until the user clicks Create. Used by
//         act_duplicate_production.
//
// Both drawers resolve required belongsTo relations (product, konveksi, sku,
// production) at runtime from the `fields` config and send nested
// associations, with raw-FK fallback — fixes "X is required" 400s.
//
// Depends on: none.
// =====================================================
const { Drawer, Select, DatePicker, InputNumber, Switch, Spin, Modal, message } = antd;
const ce = React.createElement;
const { useState, useEffect, useRef } = React;

const num = v => Number(v == null ? 0 : v);
const STATUS_OPTIONS = ['planning', 'cutting', 'production', 'qc', 'permak', 'done'];
const STATUS_LABEL = { planning: 'Planning', cutting: 'Cutting', production: 'Production', qc: 'QC', permak: 'Permak', done: 'Done' };
const sLabel = v => STATUS_LABEL[String(v || '').toLowerCase()] || (v || '-');

const fieldLabel = t => ce('div', { style: { fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' } }, t);

function runSql(uid, sql) {
  return ctx.sql.save({ uid, sql, dataSourceKey: 'main' })
    .then(() => ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' }))
    .then(r => r || []);
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
    runSql('pe_opt_prod', "SELECT code, name FROM product ORDER BY name ASC"),
    runSql('pe_opt_konv', "SELECT code, name FROM konveksi ORDER BY name ASC"),
    runSql('pe_opt_sku',  "SELECT id, display FROM sku_option ORDER BY sort ASC"),
    runSql('pe_opt_mat',  "SELECT code FROM material_details ORDER BY code ASC"),
  ]).then(function(r) { _optsCache = { prods: r[0], konvs: r[1], skus: r[2], mats: r[3] }; return _optsCache; });
}

function fetchEditRecord(id) {
  return Promise.all([
    runSql('pe_erec_' + id, "SELECT fk_product_code, fk_konveksi_code, is_new, planning_rol, status, est_production_start, est_production_finish, remarks, marker FROM production WHERE id = '" + id + "'"),
    runSql('pe_eqd_' + id,
      "SELECT pqd.id AS id, pqd.fk_sku_option_id AS sku_id, sku_option.display AS variant, pqd.ratio AS ratio, pqd.quantity AS quantity, pqd.cut_quantity AS cut_quantity " +
      "FROM production_quantity_details pqd JOIN sku_option ON pqd.fk_sku_option_id = sku_option.id WHERE pqd.fk_production_id = '" + id + "' ORDER BY sku_option.sort ASC"),
    runSql('pe_emat_' + id, "SELECT id, fk_material_details_code AS material_code, quantity_need FROM production_material WHERE fk_production_id = '" + id + "' ORDER BY id ASC"),
  ]).then(function(r) { return { record: r[0][0] || {}, quantityDetails: r[1], materials: r[2] }; });
}

// =====================================================
// belongsTo resolution: { [foreignKey]: { field, targetKey } } per collection.
// Lets us send required associations as { <field>: { <targetKey>: value } } for
// BOTH product and konveksi, instead of raw FKs (which fail required-validation).
// =====================================================
const _relsCache = {};
function getRels(collection) {
  if (_relsCache[collection]) return Promise.resolve(_relsCache[collection]);
  return runSql('pe_rels_' + collection,
    "SELECT name, CAST(options AS CHAR) AS options FROM fields WHERE collection_name='" + collection + "' AND type='belongsTo'"
  ).then(function(rows) {
    const byFk = {};
    (rows || []).forEach(function(r) {
      let opt = {}; try { opt = JSON.parse(r.options || '{}'); } catch (e) {}
      if (opt.foreignKey) byFk[opt.foreignKey] = { field: r.name, targetKey: opt.targetKey || 'id' };
    });
    _relsCache[collection] = byFk;
    return byFk;
  }).catch(function() { _relsCache[collection] = {}; return {}; });
}
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
  const rels = await getRels('production');
  const values = { is_new: !!form.is_new, planning_rol: form.planning_rol, status: 'planning' };
  Object.assign(values, assocFragment(rels, 'fk_product_code',  form.product));
  Object.assign(values, assocFragment(rels, 'fk_konveksi_code', form.konveksi));
  const res = await ctx.api.resource('production').create({ values });
  const newId = (res && res.data && res.data.data && res.data.data.id) || (res && res.data && res.data.id);
  if (!newId) throw new Error('Production created but no id returned.');

  const qdRels = await getRels('production_quantity_details');
  for (const row of (form.variants || [])) {
    if (!row.sku) continue;
    const v = { ratio: row.ratio };
    Object.assign(v, assocFragment(qdRels, 'fk_production_id', newId));
    Object.assign(v, assocFragment(qdRels, 'fk_sku_option_id', row.sku));
    await ctx.api.resource('production_quantity_details').create({ values: v });
  }
  return newId;
}

async function updateProduction(id, form) {
  const rels = await getRels('production');
  const values = {
    is_new: !!form.is_new,
    planning_rol: form.planning_rol,
    status: form.status,
    est_production_start:  form.est_start  ? form.est_start.format('YYYY-MM-DD')  : null,
    est_production_finish: form.est_finish ? form.est_finish.format('YYYY-MM-DD') : null,
    remarks: form.remarks,
    marker: form.marker,
  };
  Object.assign(values, assocFragment(rels, 'fk_product_code',  form.product));
  Object.assign(values, assocFragment(rels, 'fk_konveksi_code', form.konveksi));
  await ctx.api.resource('production').update({ filterByTk: id, values });

  const qdRels = await getRels('production_quantity_details');
  for (const qd of (form.quantityDetails || [])) {
    if (qd.id) {
      await ctx.api.resource('production_quantity_details').update({ filterByTk: qd.id, values: { ratio: qd.ratio, quantity: qd.quantity, cut_quantity: qd.cut_quantity } });
    } else if (qd.sku_id) {
      const v = { ratio: qd.ratio, quantity: qd.quantity, cut_quantity: qd.cut_quantity };
      Object.assign(v, assocFragment(qdRels, 'fk_production_id', id));
      Object.assign(v, assocFragment(qdRels, 'fk_sku_option_id', qd.sku_id));
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
  // normal Add-button blank-slate case on close/submit, as before).
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

  // inline=true → bare content for hosting inside Modal.confirm (duplicate flow).
  // Same fields, same submit() — just no antd Drawer wrapper.
  if (props.inline) {
    return ce('div', { style: { padding: 4 } }, formFields, ce('div', { style: { marginTop: 16 } }, footerButtons));
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

  useEffect(function() {
    if (!props.open || !id) return;
    setLoading(true);
    Promise.all([fetchEditRecord(id), fetchOptions()]).then(function(r) {
      const d = r[0]; const rec = d.record || {};
      setOpts(r[1] || {});
      setForm({
        product: rec.fk_product_code || null, konveksi: rec.fk_konveksi_code || null,
        is_new: rec.is_new === true || String(rec.is_new) === 'true' || rec.is_new === 1,
        rol: rec.planning_rol != null ? Number(rec.planning_rol) : null, status: rec.status || 'planning',
        est_start: rec.est_production_start ? dayjs(rec.est_production_start) : null,
        est_finish: rec.est_production_finish ? dayjs(rec.est_production_finish) : null,
        remarks: rec.remarks || '',
        marker: rec.marker || '',
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
    try { await updateProduction(id, { product: form.product, konveksi: form.konveksi, is_new: form.is_new, planning_rol: form.rol, status: form.status, est_start: form.est_start, est_finish: form.est_finish, remarks: form.remarks, marker: form.marker, quantityDetails: qds, deletedQuantityIds: delQ, materials: mats }); message.success('Production updated.'); props.onSaved(); }
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
  const markerBody = ce('div', null,
    ce(RichTextEditor, { key: 'rte_marker_' + (id || 'new'), value: form.marker, onChange: v => setF('marker', v) }),
    ce('div', { style: { fontSize: 10, color: '#cbd5e1', marginTop: 4 } }, 'Rich text — rendered in the detail view'));

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

  return ce(Drawer, {
    open: props.open, title: 'Edit Production', width: 580, placement: 'right', onClose: props.onClose,
    rootClassName: 'pe-edit-drawer', zIndex: 1100,
    footer: ce('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
      ce('button', { onClick: props.onClose, style: { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13 } }, 'Cancel'),
      ce('button', { onClick: submit, disabled: busy || loading, style: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 20px', fontSize: 13, fontWeight: 700, cursor: (busy || loading) ? 'not-allowed' : 'pointer', opacity: (busy || loading) ? 0.6 : 1, boxShadow: '0 1px 3px rgba(79,70,229,0.4)' } }, busy ? 'Saving…' : 'Save changes')),
  },
    loading
      ? ce('div', { style: { padding: 60, textAlign: 'center' } }, ce(Spin, null))
      : ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          ce(EditStyles, null),
          card('Details',  '#6366f1', detailsBody),
          card('Remarks',  '#0ea5e9', remarksBody),
          card('Marker',   '#a855f7', markerBody),
          card('Quantity', '#84cc16', qtyBody),
          card('Materials','#f97316', matBody),
          ce('div', { style: { height: 24 } })
        )
  );
};

// =====================================================
// DUPLICATE — fetch a source production's template fields (product,
// konveksi, is_new, planning ROL, variant ratios) and open the New
// Production form pre-filled, so the user edits before saving. Nothing is
// written until Create is clicked — reuses createProduction, same as a
// normal Add. NOT copied: remarks, marker, quantity/cut_quantity (actual run
// figures), production_material (BOM), production_sample — BOM/sample are
// regenerated fresh by the on-insert workflow, same as any new production.
//
// Hosted via Modal.confirm content — the same proven pattern already used
// for the Material Out entry form (MaterialOutContent): a stateful React
// element passed as `content`, own Cancel/Create buttons, closed with
// Modal.destroyAll(). No portal/CSS tricks needed.
// =====================================================
function fetchDuplicateSource(sourceId) {
  return Promise.all([
    runSql('pe_dupsrc_' + sourceId, "SELECT fk_product_code, fk_konveksi_code, is_new, planning_rol FROM production WHERE id = '" + sourceId + "'"),
    runSql('pe_dupqd_' + sourceId, "SELECT fk_sku_option_id AS sku_id, ratio FROM production_quantity_details WHERE fk_production_id = '" + sourceId + "' ORDER BY id ASC"),
  ]).then(function(r) {
    const rec = r[0][0];
    if (!rec) throw new Error('Source production not found.');
    return {
      product: rec.fk_product_code,
      konveksi: rec.fk_konveksi_code,
      is_new: rec.is_new === true || String(rec.is_new) === 'true' || rec.is_new === 1,
      rol: rec.planning_rol != null ? Number(rec.planning_rol) : null,
      variants: (r[1] || []).map(function(q) { return { sku: q.sku_id, ratio: q.ratio }; }),
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
