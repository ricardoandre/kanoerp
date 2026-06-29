// =====================================================
// jblock — PRODUCTION MATERIAL (runs on the ui_list_engine engine)
//
// Thin domain config: SQL, status colors, card layout, NEW form. The material
// DETAIL and EDIT both come from the shared ui_production_material_detail row
// (single source — same material detail/edit everywhere). Cross-record
// navigation is handled by the shared ui_record_nav host at the view root:
// production_ref ⇄ material row, each click CLOSES the current drawer and opens
// the target (replace, no stack).
// =====================================================
const { React, antd, dayjs } = ctx.libs;
const { useState, useEffect } = React;
const { Select, InputNumber, Modal, message } = antd;
const ce = React.createElement;

// shared code loader
const _codeCache = {};
async function loadCode(name) {
  if (_codeCache[name]) return _codeCache[name];
  const uid = 'code_' + name;
  const rows = await ctx.sql.save({ uid, dataSourceKey: 'main', sql: "SELECT code FROM source_code WHERE name='" + name + "'" })
    .then(() => ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' }));
  const src = (rows && rows[0] && rows[0].code) || '';
  _codeCache[name] = new Function('React', 'antd', 'dayjs', 'ctx', src)(React, antd, dayjs, ctx);
  return _codeCache[name];
}

// cross-record nav channel → RecordNav host at the view root.
const navRef = { open: null };

// ── domain config: status (inline, not modular) ──
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

// ── helpers ──
function runSql(uid, sql) {
  return ctx.sql.save({ uid, sql, dataSourceKey: 'main' })
    .then(() => ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' }))
    .then(r => r || []);
}
const num = v => Number(v == null ? 0 : v);
function uniq(a) { const out = [], seen = {}; a.forEach(x => { if (x == null) return; const k = String(x); if (!seen[k]) { seen[k] = 1; out.push(x); } }); return out; }
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
function pill(text, bg, color) { return ce('span', { style: { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: bg, color: color } }, text); }

// ── data layer ──
function fetchList() {
  return runSql('pjm_list_v1',
    "SELECT pm.id AS id, pm.status AS status, pm.shipment_date AS shipment_date, pm.quantity_need AS quantity_need, " +
    "  pm.fk_material_details_code AS material_code, pm.fk_production_id AS production_id, " +
    "  raw_material.type AS material_type, raw_material.default_content AS default_content, " +
    "  production.production_ref AS production_ref, production.planning_rol AS planning_rol, " +
    "  product.code AS product_code, product.name AS product_name, konveksi.name AS konveksi_name " +
    "FROM production_material pm " +
    "JOIN production ON pm.fk_production_id = production.id " +
    "JOIN product  ON production.fk_product_code  = product.code " +
    "JOIN konveksi ON production.fk_konveksi_code = konveksi.code " +
    "JOIN material_details ON pm.fk_material_details_code = material_details.code " +
    "JOIN raw_material ON material_details.fk_material_code = raw_material.code " +
    "ORDER BY pm.id DESC");
}
function fetchSummaries(rows) {
  const pmIds = rows.map(r => r.id), prodIds = uniq(rows.map(r => r.production_id));
  if (!pmIds.length) return Promise.resolve({ out: {}, doMap: {} });
  const pmIn = pmIds.map(x => "'" + x + "'").join(','), prodIn = prodIds.map(x => "'" + x + "'").join(',');
  return Promise.all([
    runSql('pjm_sum_do', "SELECT fk_production_id AS pid, COALESCE(SUM(quantity),0) AS do_q FROM production_quantity_details WHERE fk_production_id IN (" + prodIn + ") GROUP BY pid"),
    runSql('pjm_sum_hdr', "SELECT id, fk_production_material_id AS pmid FROM material_ledger WHERE fk_production_material_id IN (" + pmIn + ")"),
  ]).then(function(r) {
    const doMap = {}; (r[0] || []).forEach(x => { doMap[String(x.pid)] = num(x.do_q); });
    const hdr = r[1] || [], ledgerToPm = {}; hdr.forEach(h => { ledgerToPm[String(h.id)] = String(h.pmid); });
    const ledgerIds = hdr.map(h => h.id).filter(Boolean);
    if (!ledgerIds.length) return { out: {}, doMap };
    return runSql('pjm_sum_det', "SELECT fk_material_ledger_id AS lid, COUNT(*) AS cnt, COALESCE(SUM(details),0) AS total FROM material_ledger_details WHERE fk_material_ledger_id IN (" + ledgerIds.join(',') + ") GROUP BY lid")
      .then(function(det) {
        const out = {}; (det || []).forEach(d => { const pm = ledgerToPm[String(d.lid)]; if (!pm) return; if (!out[pm]) out[pm] = { count: 0, total: 0 }; out[pm].count += num(d.cnt); out[pm].total += num(d.total); });
        return { out, doMap };
      });
  }).catch(() => ({ out: {}, doMap: {} }));
}
function fetchImages() {
  return runSql('pjm_imgmeta', "SELECT CAST(options AS CHAR) AS options FROM fields WHERE collection_name='product' AND name='image'")
    .then(function(rows) {
      if (!rows.length) return {};
      let opt = {}; try { opt = JSON.parse(rows[0].options || '{}'); } catch (e) { return {}; }
      const through = opt.through, fk = opt.foreignKey, ok = opt.otherKey, sk = opt.sourceKey || 'id';
      if (!through || !fk || !ok) return {};
      return runSql('pjm_imgjoin',
        "SELECT product.code AS code, attachments.url AS url, attachments.filename AS filename FROM product " +
        "JOIN " + through + " ON " + through + "." + fk + " = product." + sk + " " +
        "JOIN attachments ON attachments.id = " + through + "." + ok + " ORDER BY attachments.id ASC")
        .then(function(irows) { const map = {}; irows.forEach(r => { if (!map[r.code]) map[r.code] = r.url || (r.filename ? '/storage/uploads/' + r.filename : ''); }); return map; });
    }).catch(() => ({}));
}
function fetchExtra() {
  return Promise.all([
    runSql('pjm_opt_prod', "SELECT production.id AS id, production.production_ref AS ref, product.code AS pcode, product.name AS pname, konveksi.name AS kname FROM production JOIN product ON production.fk_product_code = product.code JOIN konveksi ON production.fk_konveksi_code = konveksi.code ORDER BY production.created_at DESC"),
    runSql('pjm_opt_mat', "SELECT code FROM material_details ORDER BY code ASC"),
  ]).then(r => ({ productions: r[0], materials: r[1] }));
}

// ── actions ──
function deleteMaterial(id) { return ctx.api.resource('production_material').destroy({ filterByTk: id }); }
function createMaterial(form) { return ctx.api.resource('production_material').create({ values: { fk_production_id: form.production, fk_material_details_code: form.material_code, quantity_need: form.quantity_need, status: 'planning' } }); }
function addMaterialOut(row, helpers) {
  loadCode('ui_material_out').then(MO => MO.openModal({ ctx, pmId: row.id, onSaved: () => { helpers.refresh(); helpers.reloadKeepOpen(); } }))
    .catch(e => message.error('Failed: ' + ((e && e.message) || e)));
}

// ── shared material detail loader (entry from the list) ──
const MaterialDetailLoader = function(props) {
  const sC = useState(null); const Mod = sC[0]; const setMod = sC[1];
  useEffect(function() { loadCode('ui_production_material_detail').then(function(m) { setMod(m && m.MaterialDetailBody ? m : false); }).catch(function() { setMod(false); }); }, []);
  const row = props.row, helpers = props.helpers;
  function openProduction(productionId) {
    // handoff: close THIS material detail, then open the production detail at root.
    if (helpers && helpers.closeDetail) helpers.closeDetail();
    if (navRef.open) navRef.open('production', productionId, helpers);
  }
  if (Mod === null) return ce('div', { style: { padding: 40, textAlign: 'center', color: '#9ca3af' } }, 'Loading…');
  if (!Mod) return ce('div', { style: { padding: 24, color: '#ef4444', fontSize: 13 } }, 'Could not load material detail (ui_production_material_detail).');
  return ce(Mod.MaterialDetailBody, {
    pmId: row.id, refreshKey: props.refreshKey,
    onOpenProduction: openProduction,
    onChanged: function() { if (helpers) { helpers.refresh(); helpers.reloadKeepOpen(); } },
  });
};

// ── shared material edit loader (engine swipe-edit + detail-edit use the same) ──
const MatEditLoader = function(props) {
  const sC = useState(null); const Mod = sC[0]; const setMod = sC[1];
  useEffect(function() { loadCode('ui_production_material_detail').then(setMod).catch(function() { setMod(false); }); }, []);
  if (!Mod || !Mod.MaterialEditDrawer) return null;
  return ce(Mod.MaterialEditDrawer, { open: props.open, pmId: props.pmId, onClose: props.onClose, onSaved: props.onSaved });
};

// ── record nav host (cross-record replace navigation + edit/delete) ──
const RecordNavHost = function() {
  const sC = useState(null); const Mod = sC[0]; const setMod = sC[1];
  useEffect(function() { loadCode('ui_record_nav').then(setMod).catch(function() {}); }, []);
  if (!Mod || !Mod.RecordNav) return null;
  return ce(Mod.RecordNav, { navRef: navRef });
};

// ── card renderer ──
function renderCard(o) {
  const row = o.row, summary = o.summary, selectMode = o.selectMode, selected = o.selected;
  const img = (o.imgMap && o.imgMap[row.product_code]) || '';
  const acc = !isFabric(row.material_type), sc = statusColor(row.status);
  const totalDo = (summary && summary.doMap && summary.doMap[String(row.production_id)]) || 0;
  const needEl = renderNeed(buildNeed({ quantity_need: row.quantity_need, default_content: row.default_content }, acc, row.planning_rol, totalDo));
  const out = summary && summary.out && summary.out[String(row.id)];
  const outEl = out
    ? ce('div', { style: { fontSize: 11, color: '#374151', display: 'flex', flexDirection: 'column', gap: 2 } },
        ce('div', { style: { display: 'flex', justifyContent: 'space-between' } }, ce('span', { style: { color: '#9ca3af' } }, 'out'), ce('span', { style: { fontWeight: 700, color: '#166534' } }, out.count + (acc ? ' pack' : ' roll'))),
        ce('div', { style: { display: 'flex', justifyContent: 'space-between' } }, ce('span', { style: { color: '#9ca3af' } }, 'total'), ce('span', { style: { fontWeight: 700, color: '#166534' } }, fmtVal(out.total) + (acc ? ' pcs' : ' yard'))))
    : ce('div', { style: { fontSize: 11, color: '#cbd5e1', fontStyle: 'italic' } }, 'No material out');
  return ce('div', { className: 'pjm-cardbody' },
    ce('div', { className: 'pjm-col-summary' },
      selectMode ? ce('div', { style: { width: 22, height: 22, borderRadius: 6, flexShrink: 0, border: '2px solid ' + (selected ? '#6366f1' : '#cbd5e1'), background: selected ? '#6366f1' : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 } }, selected ? '✓' : '') : null,
      ce('div', { style: { width: 56, height: 56, borderRadius: 10, flexShrink: 0, background: '#f3f4f6', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
        img ? ce('img', { src: img, style: { width: '100%', height: '100%', objectFit: 'cover' } }) : ce('span', { style: { fontSize: 20, color: '#cbd5e1' } }, '🧵')),
      ce('div', { style: { flex: 1, minWidth: 0 } },
        ce('div', { style: { fontWeight: 700, fontSize: 14, color: '#111827', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, row.material_code || '—'),
        ce('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 } },
          pill(acc ? 'Acc' : 'Fabric', acc ? '#f3e8ff' : '#e0f2fe', acc ? '#a855f7' : '#0ea5e9'),
          ce('span', { style: { background: statusBg(row.status), color: sc, border: '1px solid ' + sc + '44', borderRadius: 20, padding: '1px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' } }, statusLabel(row.status))),
        ce('div', { style: { fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, row.production_ref || '—'),
        ce('div', { style: { fontSize: 11, color: '#9ca3af', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (row.product_code || '') + ' · ' + (row.product_name || '')),
        row.shipment_date ? ce('div', { style: { fontSize: 10, color: '#9ca3af', marginTop: 3, fontWeight: 600 } }, fmtDateNumeric(row.shipment_date)) : null)),
    ce('div', { className: 'pjm-col-need' }, needEl),
    ce('div', { className: 'pjm-col-out' }, outEl),
    ce('div', { className: 'pjm-col-meta' },
      ce('div', null,
        ce('div', { style: { fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Shipment'),
        ce('div', { style: { fontSize: 12, fontWeight: 600, color: '#374151' } }, fmtDateNumeric(row.shipment_date) || '—'))));
}

// ── new-form body ──
function prodOptions(extra) {
  return (extra.productions || []).map(p => ({ value: p.id, label: (p.ref || ('#' + p.id)) + ' · ' + (p.pcode || '') + ' — ' + (p.pname || '') + ' · ' + (p.kname || '') }));
}
function matOptions(extra) { return (extra.materials || []).map(m => ({ value: m.code, label: m.code })); }
function renderNewBody(form, setF, extra) {
  return [
    ce('div', { key: 'p' }, fieldLabel('Production'),
      ce(Select, { showSearch: true, value: form.production, onChange: v => setF('production', v), style: { width: '100%' }, placeholder: 'Search ref, product code, name, konveksi…', filterOption: (i, o) => String(o.label).toLowerCase().includes(i.toLowerCase()), options: prodOptions(extra) })),
    ce('div', { key: 'm' }, fieldLabel('Material Code'),
      ce(Select, { showSearch: true, value: form.material_code, onChange: v => setF('material_code', v), style: { width: '100%' }, placeholder: 'Search material code', filterOption: (i, o) => String(o.label).toLowerCase().includes(i.toLowerCase()), options: matOptions(extra) })),
    ce('div', { key: 'q' }, fieldLabel('Quantity Need'),
      ce(InputNumber, { value: form.quantity_need, onChange: v => setF('quantity_need', v), style: { width: '100%' }, min: 0, placeholder: 'Quantity per pcs (pcs/meter). Leave blank for main fabric' })),
  ];
}

// ── per-view CSS (layout only; engine owns the swipe-frame CSS; detail/edit CSS
//    lives in the shared ui_production_material_detail row) ──
const VIEW_CSS =
  ".pjm-cardbody{display:flex;gap:12px;padding:12px;align-items:center;}" +
  ".pjm-col-summary{flex:1;min-width:0;display:flex;gap:12px;align-items:center;}" +
  ".pjm-col-meta{flex-shrink:0;display:flex;flex-direction:column;gap:6px;align-items:flex-end;text-align:right;}" +
  ".pjm-col-need,.pjm-col-out{display:none;}" +
  "@media(min-width:760px){.pjm-cardbody{display:grid;grid-template-columns:minmax(0,1fr) 180px 170px 120px;gap:18px;}.pjm-col-need{display:block;}.pjm-col-out{display:block;}}";

// ── CONFIG ──
const config = {
  title: 'Production Materials',
  css: VIEW_CSS,
  searchPlaceholder: 'Search material, ref, code, name…',
  emptyText: 'No materials match this filter',
  pageSize: 15,

  fetchList: fetchList,
  fetchSummaries: fetchSummaries,
  fetchImages: fetchImages,
  fetchExtra: fetchExtra,
  getImage: (row, map) => (map && map[row.product_code]) || '',

  searchText: r => [r.material_code, r.production_ref, r.product_code, r.product_name],

  mainTabs: {
    allLabel: 'All',
    tabs: [
      { key: 'fabric', label: 'Fabric', color: '#0ea5e9' },
      { key: 'accessories', label: 'Accessories', color: '#a855f7' },
    ],
    classify: r => isFabric(r.material_type) ? 'fabric' : 'accessories',
  },

  secondaryFilters: [
    { key: 'status', label: 'Status', kind: 'select', multi: true, default: ['planning', 'po', 'ready'], field: 'status', normalize: 'lower', optionLabel: statusLabel, placeholder: 'Any status' },
    { key: 'production', label: 'Production', kind: 'select', field: 'production_ref', search: true },
    { key: 'shipment', label: 'Shipment date', kind: 'dateRange', field: 'shipment_date' },
  ],

  sortOptions: [
    { key: 'created_desc', label: 'Newest' },
    { key: 'ship_asc', label: 'Shipment ↑' },
    { key: 'ship_desc', label: 'Shipment ↓' },
  ],
  sortComparator: function(key) {
    if (key === 'created_desc') return null;
    const dir = key === 'ship_asc' ? 1 : -1;
    return function(a, b) {
      const av = a.shipment_date ? new Date(a.shipment_date).getTime() : (dir === 1 ? Infinity : -Infinity);
      const bv = b.shipment_date ? new Date(b.shipment_date).getTime() : (dir === 1 ? Infinity : -Infinity);
      return (av - bv) * dir;
    };
  },

  renderCard: renderCard,

  detailTitle: r => r.material_code + ' · ' + (r.production_ref || ('#' + r.id)),
  statusAccent: r => statusColor(r.status),
  detailRender: (row, rk, helpers) => ce(MaterialDetailLoader, { row: row, refreshKey: rk, helpers: helpers }),

  newForm: { title: 'New Production Material', width: 480, initial: () => ({ production: null, material_code: null, quantity_need: null }),
    validate: f => !f.production ? 'Select a production.' : (!f.material_code ? 'Select a material.' : null),
    render: renderNewBody, submit: createMaterial, successMsg: 'Production material created.' },
  // edit comes from the shared row, so the list swipe-edit and the detail Edit
  // button use the exact same MaterialEditDrawer.
  renderEditDrawer: function(api) {
    return ce(MatEditLoader, {
      open: !!api.open, pmId: api.row ? api.row.id : null, onClose: api.onClose,
      onSaved: function() { api.onClose(); api.helpers.refresh(); api.helpers.reloadKeepOpen(); },
    });
  },

  deleteRow: deleteMaterial,
  deleteTitle: 'Delete production material?',
  deleteLabel: row => row.material_code || ('#' + row.id),
  bulkActions: [
    { label: '🗑 Delete', bg: '#ef4444', color: '#fff', run: (ids, helpers) => {
        Modal.confirm({ title: 'Delete ' + ids.length + ' material(s)?', content: 'This cannot be undone.', okText: 'Delete', okButtonProps: { danger: true },
          onOk: () => Promise.all(ids.map(id => deleteMaterial(id))).then(() => { message.success('Deleted ' + ids.length + '.'); helpers.exitSelect(); helpers.reload(); }).catch(e => message.error('Bulk delete failed: ' + ((e && e.message) || e))) });
      } },
  ],
};

// ── root: engine list + record nav host sibling ──
const Root = function() {
  const sLV = useState(null); const LV = sLV[0]; const setLV = sLV[1];
  const sErr = useState(null); const err = sErr[0]; const setErr = sErr[1];
  useEffect(function() {
    loadCode('ui_list_engine').then(function(M) { setLV(function() { return M.createListView(config); }); })
      .catch(function(e) { setErr((e && e.message) || String(e)); });
  }, []);
  if (err) return ce('div', { style: { color: '#ef4444', padding: 16 } }, 'Failed to load ui_list_engine: ' + err);
  if (!LV) return ce('div', { style: { padding: 40, textAlign: 'center', color: '#9ca3af' } }, 'Loading…');
  return ce('div', null, ce(LV), ce(RecordNavHost, null));
};

ctx.render(ce(Root));