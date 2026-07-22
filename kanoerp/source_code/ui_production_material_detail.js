// =====================================================
// ui_production_material_detail — shared production_material DETAIL + EDIT.
//
// Stored as a `source_code` row named 'ui_production_material_detail'.
//
// EXPORTS:
//   MaterialDetailBody({ pmId, refreshKey, onOpenProduction, onChanged })
//       — Summary, then Quantity need (full width), then Material out
//         (summary) and Material out details side by side below it.
//         Self-fetches from pmId. onOpenProduction(productionId) → production_ref
//         renders as a handoff link. onChanged() → fires after a material-out
//         save or cancel.
//   ProductionMaterialDetailDrawer({ open, pmId, refreshKey, onClose, onEdit, onDelete, onOpenProduction, onChanged, zIndex })
//       — standalone drawer (title = material code + status accent + Edit/⋯Delete).
//   MaterialEditDrawer({ open, pmId, onClose, onSaved })
//       — self-contained material edit drawer (self-fetches record + options).
//
// 2026-07 MIGRATION: every data-layer function moved off raw ctx.sql onto
// ctx.api.resource() (fetchAllPages/fetchByIn) — same fix already applied to
// ui_production_detail.js / ui_production_edit.js / ui_production_addmarker.js
// (README §3 — ctx.sql is admin/root-gated, silently fails for non-admin
// roles). `updateMaterial` was already on ctx.api.resource() and is
// unchanged. `fetchProductImage` no longer introspects the `fields`
// meta-collection — uses `appends: ['image']` instead, same fix as
// ui_production_detail.js. All rendering components (MaterialSummary,
// MaterialNeed, MaterialOutSummaryBox, MaterialOutDetailsSection,
// MaterialDetailBody, ProductionMaterialDetailDrawer, MaterialEditDrawer)
// are UNCHANGED — only the data-fetching functions above them were rewritten.
//
// Button vs. tag convention (kept consistent with ui_material_out):
//   clickable actions  → solid fill, white text, no border, subtle shadow (BTN_* below)
//   status/type tags   → soft tinted background, no border, no shadow, cursor default
//
// Depends on: ui_material_out (material-out summary/details + entry modal).
// =====================================================
const { Drawer, Dropdown, Select, DatePicker, InputNumber, Spin } = antd;
const ce = React.createElement;
const { useState, useEffect } = React;

// ── resource-based read helpers (non-admin-safe), same pattern used
// throughout the rest of this codebase ──
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
function chunk(arr, size) { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }
function uniqVals(a) { const out = [], seen = {}; a.forEach(x => { if (x == null) return; const k = String(x); if (!seen[k]) { seen[k] = 1; out.push(x); } }); return out; }
function fetchByIn(resourceName, field, values, params) {
  const values2 = uniqVals(values);
  if (!values2.length) return Promise.resolve([]);
  const batches = chunk(values2, 150);
  return batches.reduce(function (p, batch) {
    return p.then(function (acc) {
      const filter = Object.assign({}, (params && params.filter) || {});
      filter[field] = { $in: batch };
      return fetchAllPages(resourceName, Object.assign({}, params, { filter: filter })).then(rows => acc.concat(rows));
    });
  }, Promise.resolve([]));
}

// this row composes another shared row → its own loader (resource-based, non-admin-safe)
const _codeCache = {};
function loadCode(name) {
  if (_codeCache[name]) return Promise.resolve(_codeCache[name]);
  return ctx.api.resource('source_code').list({ filter: { name: name }, fields: ['code'], pageSize: 1 })
    .then(function (res) {
      const rows = (res && res.data && res.data.data) || [];
      const src = (rows[0] && rows[0].code) || '';
      _codeCache[name] = new Function('React', 'antd', 'dayjs', 'ctx', src)(React, antd, dayjs, ctx);
      return _codeCache[name];
    });
}

// ── button style (clickable — solid fill, no border, subtle shadow) ──
const BTN_PRIMARY = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  border: 'none', borderRadius: 8, padding: '6px 14px',
  fontSize: 12, fontWeight: 700, color: '#fff', background: '#16a34a',
  cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
};

// ── status (material) ──
const STATUS_DEFAULTS = ['planning', 'po', 'ready', 'sent', 'cancel'];
function statusColor(s) {
  s = String(s || '').toLowerCase();
  if (s === 'sent') return '#22c55e';
  if (s === 'ready') return '#84cc16';
  if (s === 'po' || s === 'ordered') return '#d97706';
  if (s === 'planning' || s === 'pending') return '#f97316';
  if (s === 'cancel' || s === 'cancelled') return '#ef4444';
  return '#9ca3af';
}
const statusBg = s => statusColor(s) + '1a';
const statusLabel = s => s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '—';
function isFabric(t) { return String(t || '').toLowerCase() === 'fabric'; }

const num = v => Number(v == null ? 0 : v);
function fmtDateNumeric(d) { if (!d) return ''; const p = dayjs(d); return p.isValid() ? p.format('DD/MM/YYYY') : ''; }
const M_TO_YARD = 1.0936;
function numVal(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function fmtVal(v) { const n = numVal(v); return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100); }
function buildNeed(material, isAcc, planningRol, totalDo) {
  const qn = material.quantity_need; const hasQty = qn !== null && qn !== undefined && qn !== '';
  if (isAcc) { const xx = numVal(qn), yy = numVal(totalDo); return { rows: [['quantity/pcs', xx, 'pcs'], ['quantity do', yy, 'pcs']], total: ['total', xx * yy, 'pcs'] }; }
  if (!hasQty) { const xx = numVal(planningRol), yy = numVal(material.default_content); return { rows: [['planning', xx, 'rol'], ['default 1 rol', yy, 'yard']], total: ['total', xx * yy, 'yard'] }; }
  const xx = numVal(qn), yy = numVal(totalDo); return { rows: [['quantity/pcs', xx, 'meter'], ['quantity do', yy, 'pcs']], total: ['total', xx * yy * M_TO_YARD, 'yard'] };
}
function renderNeed(need) {
  const children = need.rows.map((r, i) => ce('div', { key: 'r' + i, style: { display: 'flex', justifyContent: 'space-between', fontSize: 11 } },
    ce('span', { style: { color: '#9ca3af' } }, r[0]), ce('span', { style: { fontWeight: 600, color: '#374151' } }, fmtVal(r[1]) + ' ' + r[2])));
  children.push(ce('div', { key: 'total', style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#166534', borderTop: '1px solid #e2e8f0', paddingTop: 3, marginTop: 2 } },
    ce('span', null, need.total[0]), ce('span', null, fmtVal(need.total[1]) + ' ' + need.total[2])));
  return ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', background: '#fff', border: '1px solid #f0f0f0', borderRadius: 6 } }, children);
}
const fieldLabel = t => ce('div', { style: { fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' } }, t);
function metaItem(label, value) {
  return ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
    ce('div', { style: { fontSize: 11, color: '#9ca3af', fontWeight: 500 } }, label),
    ce('div', { style: { fontSize: 13, color: '#111827', fontWeight: 500 } }, value || '—'));
}
function metaItemLink(label, value, onClick) {
  return ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
    ce('div', { style: { fontSize: 11, color: '#9ca3af', fontWeight: 500 } }, label),
    (value && onClick)
      ? ce('button', { onClick: onClick, title: 'Open production', style: { display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', border: 'none', background: 'none', padding: 0, fontSize: 13, color: '#4338ca', fontWeight: 700, cursor: 'pointer' } },
          value, ce('span', { style: { fontSize: 14 } }, '›'))
      : ce('div', { style: { fontSize: 13, color: '#111827', fontWeight: 500 } }, value || '—'));
}
// tag/badge style — flat, no border, no shadow, cursor default (not a button)
function pill(text, bg, color) { return ce('span', { style: { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: bg, color: color, cursor: 'default' } }, text); }

const PMD_CSS =
  ".pmd-detail-drawer .ant-drawer-content-wrapper{width:min(900px,92vw) !important;}" +
  "@media (max-width:700px){.pmd-detail-drawer .ant-drawer-content-wrapper{width:100% !important;}}" +
  ".pmd-edit-drawer .ant-drawer-content-wrapper{width:min(540px,100vw) !important;}" +
  "@media (max-width:700px){.pmd-edit-drawer .ant-drawer-content-wrapper{width:100% !important;}}" +
  ".pmd-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}" +
  "@media (max-width:700px){.pmd-grid2{grid-template-columns:1fr;}}" +
  ".pmd-grid-asym{display:grid;grid-template-columns:1fr 1.2fr;gap:16px;align-items:start;}" +
  "@media (max-width:700px){.pmd-grid-asym{grid-template-columns:1fr;}}" +
  ".pmd-sum2{display:grid;grid-template-columns:1fr 1fr;gap:16px 24px;}" +
  ".pmd-sum-layout{display:flex;flex-direction:column;gap:16px;}" +
  ".pmd-sum-img{width:100%;border-radius:12px;overflow:hidden;background:#f3f4f6;display:flex;align-items:center;justify-content:center;}" +
  "@media(min-width:760px){.pmd-sum-layout{flex-direction:row;align-items:flex-start;gap:24px;}.pmd-sum-img{width:260px;flex-shrink:0;}.pmd-sum-meta{flex:1;min-width:0;}}";
const MaterialDetailStyles = () => ce('style', null, PMD_CSS);

// ── data ──
function fetchPmHeader(pmId) {
  return fetchAllPages('production_material', {
    filter: { id: pmId },
    fields: ['id', 'status', 'shipment_date', 'quantity_need', 'fk_material_details_code', 'fk_production_id'],
    appends: ['material_details', 'production'],
    pageSize: 1,
  }).then(function (rows) {
    const pm = rows[0];
    if (!pm) return null;
    const md = pm.material_details || {};
    const prod = pm.production || {};
    return Promise.all([
      md.fk_material_code ? fetchAllPages('raw_material', { filter: { code: md.fk_material_code }, fields: ['type', 'default_content'], pageSize: 1 }) : Promise.resolve([]),
      prod.fk_product_code ? fetchAllPages('product', { filter: { code: prod.fk_product_code }, fields: ['code', 'name'], pageSize: 1 }) : Promise.resolve([]),
      prod.fk_konveksi_code ? fetchAllPages('konveksi', { filter: { code: prod.fk_konveksi_code }, fields: ['name'], pageSize: 1 }) : Promise.resolve([]),
    ]).then(function (r) {
      const rm = r[0][0] || {};
      const product = r[1][0] || {};
      const konv = r[2][0] || {};
      return {
        id: pm.id, status: pm.status, shipment_date: pm.shipment_date, quantity_need: pm.quantity_need,
        material_code: pm.fk_material_details_code, production_id: pm.fk_production_id,
        material_type: rm.type, default_content: rm.default_content,
        production_ref: prod.production_ref, planning_rol: prod.planning_rol,
        product_code: product.code, product_name: product.name, konveksi_name: konv.name,
      };
    });
  });
}
function fetchLightHeader(pmId) {
  return fetchAllPages('production_material', { filter: { id: pmId }, fields: ['id', 'status', 'fk_material_details_code'], pageSize: 1 })
    .then(function (rows) {
      const pm = rows[0];
      return pm ? { id: pm.id, status: pm.status, material_code: pm.fk_material_details_code } : null;
    });
}
function fetchProductionDo(productionId) {
  return fetchAllPages('production_quantity_details', { filter: { fk_production_id: productionId }, fields: ['quantity'] })
    .then(function (rows) { return rows.reduce(function (s, x) { return s + num(x.quantity); }, 0); });
}
// image via appends:['image'] — same fix as ui_production_detail.js, instead
// of introspecting the `fields` meta-collection (admin-gated).
function fetchProductImage(productCode) {
  if (!productCode) return Promise.resolve('');
  return fetchAllPages('product', { filter: { code: productCode }, fields: ['code'], appends: ['image'], pageSize: 1 })
    .then(function (rows) {
      const p = rows[0];
      if (!p) return '';
      const img = p.image;
      const imgRow = Array.isArray(img) ? img[0] : img;
      if (!imgRow) return '';
      return imgRow.url || (imgRow.filename ? '/storage/uploads/' + imgRow.filename : '');
    }).catch(() => '');
}
function fetchEditRecord(pmId) {
  return fetchAllPages('production_material', { filter: { id: pmId }, fields: ['fk_production_id', 'fk_material_details_code', 'quantity_need', 'status', 'shipment_date'], pageSize: 1 })
    .then(function (rows) { return rows[0] || {}; });
}
let _editOpts = null;
function fetchEditOptions() {
  if (_editOpts) return Promise.resolve(_editOpts);
  return Promise.all([
    fetchAllPages('production', { fields: ['id', 'production_ref'], appends: ['product_code', 'konveksi'], sort: ['-created_at'] }),
    fetchAllPages('material_details', { fields: ['code'], sort: ['code'] }),
  ]).then(function (r) {
    const productions = (r[0] || []).map(function (p) {
      const product = p.product_code || {};
      const konv = p.konveksi || {};
      return { id: p.id, ref: p.production_ref, pcode: product.code, pname: product.name, kname: konv.name };
    });
    _editOpts = { productions: productions, materials: r[1] };
    return _editOpts;
  });
}
function updateMaterial(pmId, form) {
  return ctx.api.resource('production_material').update({ filterByTk: pmId, values: {
    fk_production_id: form.production, fk_material_details_code: form.material_code, quantity_need: form.quantity_need,
    status: form.status, shipment_date: form.shipment_date ? form.shipment_date.format('YYYY-MM-DD') : null } });
}

// ── sections ──
const MaterialSummary = function(props) {
  const r = props.header, img = props.image, acc = !isFabric(r.material_type), sc = statusColor(r.status);
  // flat status chip — soft tint, no border, cursor default (not a button)
  const statusBlock = ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
    ce('div', { style: { fontSize: 11, color: '#9ca3af', fontWeight: 500 } }, 'Status'),
    ce('span', { style: { alignSelf: 'flex-start', background: statusBg(r.status), color: sc, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600, cursor: 'default' } }, statusLabel(r.status)));
  const typeBlock = ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' } },
    ce('div', { style: { fontSize: 11, color: '#9ca3af', fontWeight: 500 } }, 'Type'),
    acc ? pill('Accessories', '#f3e8ff', '#a855f7') : pill('Fabric', '#e0f2fe', '#0ea5e9'));
  return ce('div', { className: 'pmd-sum-layout' },
    ce('div', { className: 'pmd-sum-img', style: { padding: img ? 0 : 30 } },
      img ? ce('img', { src: img, style: { maxWidth: '100%', maxHeight: 320, width: 'auto', height: 'auto', display: 'block', borderRadius: 12 } }) : ce('span', { style: { fontSize: 42, color: '#cbd5e1' } }, '🧵')),
    ce('div', { className: 'pmd-sum-meta' },
      ce('div', { className: 'pmd-sum2' },
        ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } }, statusBlock, metaItem('Material code', r.material_code), typeBlock, metaItem('Shipment date', fmtDateNumeric(r.shipment_date) || '—')),
        ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } }, metaItemLink('Production ref', r.production_ref, props.onOpenProduction), metaItem('Product code', r.product_code), metaItem('Product name', r.product_name), metaItem('Konveksi', r.konveksi_name)))));
};

const MaterialNeed = function(props) {
  const r = props.header;
  const sL = useState(true); const loading = sL[0]; const setLoading = sL[1];
  const sD = useState(0); const totalDo = sD[0]; const setTotalDo = sD[1];
  useEffect(function() { setLoading(true); fetchProductionDo(r.production_id).then(d => { setTotalDo(d); setLoading(false); }).catch(() => setLoading(false)); }, [r.id, props.refreshKey]);
  if (loading) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  const acc = !isFabric(r.material_type);
  return ce('div', { style: { maxWidth: 360 } },
    renderNeed(buildNeed({ quantity_need: r.quantity_need, default_content: r.default_content }, acc, r.planning_rol, totalDo)));
};
 

// simple totals box + Add action
const MaterialOutSummaryBox = function(props) {
  const sL = useState(true); const loading = sL[0]; const setLoading = sL[1];
  const sE = useState(null); const el = sE[0]; const setEl = sE[1];
  useEffect(function() {
    setLoading(true);
    loadCode('ui_material_out').then(MO => MO.fetchSummary(ctx, props.pmId).then(d => { setEl(MO.renderSummary(d)); setLoading(false); })).catch(() => setLoading(false));
  }, [props.pmId, props.refreshKey]);
  if (loading) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  return ce('div', null,
    ce('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 10 } },
      ce('button', { onClick: () => props.onAdd(), style: BTN_PRIMARY }, '＋ Add material out')),
    el || ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No material out'));
};

// transaction-list view: one row per entry with breakdown + status + cancel — separate section
const MaterialOutDetailsSection = function(props) {
  const sL = useState(true); const loading = sL[0]; const setLoading = sL[1];
  const sD = useState(null); const data = sD[0]; const setData = sD[1];
  const sMO = useState(null); const MO = sMO[0]; const setMO = sMO[1];

  function load() {
    setLoading(true);
    return loadCode('ui_material_out').then(function(mod) {
      setMO(function() { return mod; });
      return mod.fetchSummary(ctx, props.pmId).then(function(d) {
        setData(d);
        setLoading(false);
        return mod;
      });
    }).catch(function() { setLoading(false); });
  }

  useEffect(function() { load(); }, [props.pmId, props.refreshKey]);

  function handleCancel(ledgerId) {
    if (!MO) return;
    MO.cancelLedger(ctx, ledgerId, function() {
      load();
      if (props.onChanged) props.onChanged();
    });
  }

  if (loading || !MO) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');

  return ce('div', { style: { border: '1px solid #f0f0f0', borderRadius: 10, padding: '4px 14px', background: '#fff' } },
    MO.renderDetails(data, { onCancel: handleCancel }));
};

// ── body ──
const MaterialDetailBody = function(props) {
  const pmId = props.pmId;
  const sH = useState(null); const header = sH[0]; const setHeader = sH[1];
  const sImg = useState(''); const image = sImg[0]; const setImage = sImg[1];
  const sLocal = useState(0); const localRk = sLocal[0]; const setLocalRk = sLocal[1];

  useEffect(function() {
    let alive = true;
    setHeader(null); setImage('');
    if (pmId == null) return;
    fetchPmHeader(pmId).then(function(h) {
      if (!alive) return;
      setHeader(h);
      if (h) fetchProductImage(h.product_code).then(function(u) { if (alive) setImage(u); });
    }).catch(function() {});
    return function() { alive = false; };
  }, [pmId, props.refreshKey]);

  function handleAdd() {
    loadCode('ui_material_out').then(function(MO) {
      MO.openModal({ ctx: ctx, pmId: pmId, onSaved: function() { setLocalRk(n => n + 1); if (props.onChanged) props.onChanged(); } });
    }).catch(function(e) { ctx.message.error('Failed: ' + ((e && e.message) || e)); });
  }
  function handleChanged() { setLocalRk(n => n + 1); if (props.onChanged) props.onChanged(); }

  const subLabel = t => ce('div', { style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', margin: '20px 0 10px' } }, t);
  if (!header) return ce('div', null, ce(MaterialDetailStyles, null), ce('div', { style: { padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…'));
  const combo = (props.refreshKey || 0) + localRk;
  return ce('div', null,
    ce(MaterialDetailStyles, null),
    ce(MaterialSummary, { header: header, image: image, onOpenProduction: props.onOpenProduction ? () => props.onOpenProduction(header.production_id) : null }),

    // quantity need — full width, on its own
    subLabel('Quantity need'),
    ce(MaterialNeed, { header: header, refreshKey: combo }),

    // material out + material out details — side by side, so they read as one group
    ce('div', { className: 'pmd-grid-asym', style: { marginTop: 8 } },
      ce('div', null, subLabel('Material out'), ce(MaterialOutSummaryBox, { pmId: pmId, refreshKey: combo, onAdd: handleAdd })),
      ce('div', null, subLabel('Material out details'), ce(MaterialOutDetailsSection, { pmId: pmId, refreshKey: combo, onChanged: handleChanged }))
    ));
};

// ── standalone detail drawer (Edit + ⋯Delete chrome) ──
const ProductionMaterialDetailDrawer = function(props) {
  const pmId = props.pmId;
  const sH = useState(null); const header = sH[0]; const setHeader = sH[1];
  const sRk = useState(0); const drawerRk = sRk[0]; const setDrawerRk = sRk[1];
  useEffect(function() {
    if (!props.open || pmId == null) return;
    let alive = true; setHeader(null);
    fetchLightHeader(pmId).then(h => { if (alive) setHeader(h); }).catch(() => {});
    return function() { alive = false; };
  }, [props.open, pmId]);
  const accent = statusColor(header && header.status);
  const iconBtn = { border: '1px solid #e2e8f0', background: '#fff', borderRadius: 8, height: 30, padding: '0 10px', fontSize: 13, color: '#475569', cursor: 'pointer' };
  function handleAddOut() {
    loadCode('ui_material_out').then(function(MO) {
      MO.openModal({ ctx: ctx, pmId: pmId, onSaved: function() { setDrawerRk(n => n + 1); if (props.onChanged) props.onChanged(); } });
    }).catch(function(e) { ctx.message.error('Failed: ' + ((e && e.message) || e)); });
  }
  const overflowMenu = {
    items: [
      { key: 'addout', label: '＋  Add material out' },
      { key: 'delete', danger: true, label: '🗑  Delete' },
    ],
    onClick: function(e) {
      if (e.key === 'addout') handleAddOut();
      else if (e.key === 'delete' && props.onDelete) props.onDelete(pmId);
    },
  };
  return ce(Drawer, {
    open: !!props.open, placement: 'right', rootClassName: 'pmd-detail-drawer',
    zIndex: props.zIndex || 1050,
    title: header ? (header.material_code || ('#' + pmId)) : '',
    onClose: props.onClose,
    extra: (props.open && pmId != null) ? ce('div', { style: { display: 'flex', gap: 6 } },
      props.onEdit ? ce('button', { onClick: () => props.onEdit(pmId), style: Object.assign({}, iconBtn, { fontWeight: 600, color: '#4f46e5', borderColor: '#c7d2fe', background: '#eef2ff' }) }, '✏️ Edit') : null,
      ce(Dropdown, { menu: overflowMenu, trigger: ['click'], placement: 'bottomRight' },
        ce('button', { style: Object.assign({}, iconBtn, { width: 34, padding: 0, fontSize: 16 }) }, '⋯'))) : null,
  },
    (props.open && pmId != null) ? ce('div', { style: { fontFamily: "'Segoe UI', sans-serif" } },
      ce(MaterialDetailStyles, null),
      ce('div', { style: { height: 4, borderRadius: 999, background: accent, marginBottom: 6, opacity: 0.85 } }),
      ce(MaterialDetailBody, { pmId: pmId, refreshKey: (props.refreshKey || 0) + drawerRk, onOpenProduction: props.onOpenProduction, onChanged: props.onChanged }),
      ce('div', { style: { height: 120 } })) : null);
};

// ── edit drawer (self-contained) ──
const MaterialEditDrawer = function(props) {
  const pmId = props.pmId;
  const sL = useState(true); const loading = sL[0]; const setLoading = sL[1];
  const sB = useState(false); const busy = sB[0]; const setBusy = sB[1];
  const sO = useState({}); const opts = sO[0]; const setOpts = sO[1];
  const sf = useState({}); const form = sf[0]; const setForm = sf[1];

  useEffect(function() {
    if (!props.open || pmId == null) return;
    setLoading(true);
    Promise.all([fetchEditRecord(pmId), fetchEditOptions()]).then(function(r) {
      const rec = r[0] || {};
      setOpts(r[1] || {});
      setForm({ production: rec.fk_production_id || null, material_code: rec.fk_material_details_code || null,
        quantity_need: rec.quantity_need != null ? Number(rec.quantity_need) : null,
        status: rec.status || 'planning', shipment_date: rec.shipment_date ? dayjs(rec.shipment_date) : null });
      setLoading(false);
    }).catch(function(e) { ctx.message.error('Load failed: ' + ((e && e.message) || e)); setLoading(false); });
  }, [props.open, pmId]);

  function setF(k, v) { setForm(prev => Object.assign({}, prev, { [k]: v })); }
  function submit() {
    if (!form.production) return ctx.message.warning('Select a production.');
    if (!form.material_code) return ctx.message.warning('Select a material.');
    setBusy(true);
    Promise.resolve(updateMaterial(pmId, form)).then(function() { ctx.message.success('Production material updated.'); props.onSaved(); })
      .catch(function(e) { ctx.message.error('Update failed: ' + ((e && e.message) || e)); })
      .finally(function() { setBusy(false); });
  }

  const statusOpts = STATUS_DEFAULTS.concat(form.status && STATUS_DEFAULTS.indexOf(form.status) === -1 ? [form.status] : []).map(s => ({ value: s, label: statusLabel(s) }));
  const prodOpts = (opts.productions || []).map(p => ({ value: p.id, label: (p.ref || ('#' + p.id)) + ' · ' + (p.pcode || '') + ' — ' + (p.pname || '') + ' · ' + (p.kname || '') }));
  const matOpts = (opts.materials || []).map(m => ({ value: m.code, label: m.code }));

  return ce(Drawer, {
    open: props.open, title: 'Edit Production Material', width: 540, placement: 'right', onClose: props.onClose,
    rootClassName: 'pmd-edit-drawer', zIndex: 1100,
    footer: ce('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
      ce('button', { onClick: props.onClose, style: { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13 } }, 'Cancel'),
      ce('button', { onClick: submit, disabled: busy || loading, style: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 20px', fontSize: 13, fontWeight: 700, cursor: (busy || loading) ? 'not-allowed' : 'pointer', opacity: (busy || loading) ? 0.6 : 1 } }, busy ? 'Saving…' : 'Save changes')),
  },
    loading ? ce('div', { style: { padding: 60, textAlign: 'center' } }, ce(Spin, null))
    : ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        ce(MaterialDetailStyles, null),
        ce('div', null, fieldLabel('Production'), ce(Select, { showSearch: true, value: form.production, onChange: v => setF('production', v), style: { width: '100%' }, filterOption: (i, o) => String(o.label).toLowerCase().includes(i.toLowerCase()), options: prodOpts })),
        ce('div', null, fieldLabel('Material details'), ce(Select, { showSearch: true, value: form.material_code, onChange: v => setF('material_code', v), style: { width: '100%' }, filterOption: (i, o) => String(o.label).toLowerCase().includes(i.toLowerCase()), options: matOpts })),
        ce('div', { className: 'pmd-grid2' },
          ce('div', null, fieldLabel('Quantity need'), ce(InputNumber, { value: form.quantity_need, onChange: v => setF('quantity_need', v), style: { width: '100%' }, min: 0 })),
          ce('div', null, fieldLabel('Status'), ce(Select, { value: form.status, onChange: v => setF('status', v), style: { width: '100%' }, options: statusOpts }))),
        ce('div', null, fieldLabel('Shipment date'), ce(DatePicker, { format: 'DD/MM/YYYY', value: form.shipment_date, onChange: v => setF('shipment_date', v), style: { width: '100%' } }))));
};

return { MaterialDetailBody, ProductionMaterialDetailDrawer, MaterialEditDrawer, MaterialDetailStyles };
