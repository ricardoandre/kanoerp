// =====================================================
// jblock — PRODUCTION  (runs on the ui_list_engine engine)
//
// Thin domain config: SQL, status colors, card layout, plus loaders that pull
// the shared production DETAIL (ui_production_detail) and NEW/EDIT drawers
// (ui_production_edit). Cross-record navigation (production → material and back)
// is handled by the shared ui_record_nav host mounted at the view root: every
// cross-link CLOSES the current drawer and opens the target (replace, no stack).
// =====================================================
const { React, antd, dayjs } = ctx.libs;
const { useState, useEffect } = React;
const { Modal, Spin, message } = antd;
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

// cross-record nav channel: detail bodies (deep in a drawer) → the RecordNav
// host mounted at the view root. navRef.open('material'|'production', id, helpers).
const navRef = { open: null };

// ── domain config: status (inline, not modular) ──
const STATUS = {
  planning:   { label: 'Planning',   color: '#f97316', bg: '#fff7ed' },
  cutting:    { label: 'Cutting',    color: '#d97706', bg: '#fffbeb' },
  production: { label: 'Production', color: '#d97706', bg: '#fffbeb' },
  qc:         { label: 'QC',         color: '#84cc16', bg: '#f7fee7' },
  permak:     { label: 'Permak',     color: '#ef4444', bg: '#fef2f2' },
  done:       { label: 'Done',       color: '#22c55e', bg: '#f0fdf4' },
};
const sColor = v => (STATUS[String(v || '').toLowerCase()] || {}).color || '#9ca3af';
const sBg    = v => (STATUS[String(v || '').toLowerCase()] || {}).bg    || '#f3f4f6';
const sLabel = v => (STATUS[String(v || '').toLowerCase()] || {}).label || (v || '-');

// ── helpers ──
function runSql(uid, sql) {
  return ctx.sql.save({ uid, sql, dataSourceKey: 'main' })
    .then(() => ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' }))
    .then(r => r || []);
}
const num = v => Number(v == null ? 0 : v);
const doneColor = (val, ref) => (ref > 0 && val === ref) ? '#22c55e' : '#f97316';
function fmtDate(d) { if (!d) return '—'; const p = dayjs(d); return p.isValid() ? p.format('DD MMM YYYY') : '—'; }
function daysLeft(d) { if (!d) return null; return Math.ceil((new Date(d) - new Date()) / 86400000); }

// ── data layer ──
function fetchList() {
  return runSql('pjb_list_v1',
    "SELECT production.id AS id, production.production_ref, production.status, " +
    "  production.is_new, production.est_production_start, production.est_production_finish, production.created_at AS created_at, " +
    "  product.code AS product_code, product.name AS product_name, konveksi.name AS konveksi_name " +
    "FROM production " +
    "JOIN product  ON production.fk_product_code  = product.code " +
    "JOIN konveksi ON production.fk_konveksi_code = konveksi.code " +
    "ORDER BY production.created_at DESC"
  );
}
function fetchListSummaries(rows) {
  const ids = (rows || []).map(r => r.id);
  if (!ids.length) return Promise.resolve({});
  const inList = ids.map(x => "'" + x + "'").join(',');
  return Promise.all([
    runSql('pjb_sum_doc',  "SELECT fk_production_id AS pid, COALESCE(SUM(quantity),0) AS do_q, COALESCE(SUM(cut_quantity),0) AS cut_q FROM production_quantity_details WHERE fk_production_id IN (" + inList + ") GROUP BY pid"),
    runSql('pjb_sum_sent', "SELECT fk_production_id AS pid, COALESCE(SUM(quantity),0) AS sent_q FROM production_result WHERE fk_production_id IN (" + inList + ") GROUP BY pid"),
    runSql('pjb_sum_qc',   "SELECT fk_production_id AS pid, COALESCE(SUM(quantity),0) AS qc_q FROM qc_result WHERE fk_production_id IN (" + inList + ") GROUP BY pid"),
    runSql('pjb_sum_mat',
      "SELECT pm.fk_production_id AS pid, pm.status AS status, raw_material.type AS mtype " +
      "FROM production_material pm " +
      "JOIN material_details ON pm.fk_material_details_code = material_details.code " +
      "JOIN raw_material ON material_details.fk_material_code = raw_material.code " +
      "WHERE pm.fk_production_id IN (" + inList + ")"),
    runSql('pjb_sum_samp', "SELECT fk_production_id AS pid, status FROM production_sample WHERE fk_production_id IN (" + inList + ")"),
  ]).then(function(r) {
    const map = {};
    function grp() { return { total: 0, done: 0, rank: 99, status: null }; }
    function ensure(pid) { pid = String(pid); if (!map[pid]) map[pid] = { do: 0, cut: 0, sent: 0, qc: 0, fabric: grp(), acc: grp(), sample: grp() }; return map[pid]; }
    const rank = { planning: 0, po: 1, sent: 2, returned: 3, cancelled: 4 };
    function applyStatus(g, status) {
      g.total++;
      const s = String(status || '').toLowerCase();
      if (s === 'sent' || s === 'returned' || s === 'cancelled') g.done++;
      const rk = rank[s] != null ? rank[s] : 0;
      if (rk < g.rank) { g.rank = rk; g.status = s; }
    }
    (r[0] || []).forEach(x => { const m = ensure(x.pid); m.do = num(x.do_q); m.cut = num(x.cut_q); });
    (r[1] || []).forEach(x => { const m = ensure(x.pid); m.sent = num(x.sent_q); });
    (r[2] || []).forEach(x => { const m = ensure(x.pid); m.qc = num(x.qc_q); });
    (r[3] || []).forEach(x => { const m = ensure(x.pid); applyStatus(String(x.mtype || '').toLowerCase() === 'fabric' ? m.fabric : m.acc, x.status); });
    (r[4] || []).forEach(x => { const m = ensure(x.pid); applyStatus(m.sample, x.status); });
    return map;
  }).catch(() => ({}));
}
function fetchProductImages() {
  return runSql('pjb_imgmeta',
    "SELECT CAST(options AS CHAR) AS options FROM fields WHERE collection_name='product' AND name='image'"
  ).then(function(rows) {
    if (!rows.length) return {};
    let opt = {};
    try { opt = JSON.parse(rows[0].options || '{}'); } catch (e) { return {}; }
    const through = opt.through, fk = opt.foreignKey, ok = opt.otherKey, sk = opt.sourceKey || 'id';
    if (!through || !fk || !ok) return {};
    return runSql('pjb_imgjoin',
      "SELECT product.code AS code, attachments.url AS url, attachments.filename AS filename " +
      "FROM product " +
      "JOIN " + through + " ON " + through + "." + fk + " = product." + sk + " " +
      "JOIN attachments ON attachments.id = " + through + "." + ok + " " +
      "ORDER BY attachments.id ASC"
    ).then(function(irows) {
      const map = {};
      irows.forEach(function(r) { if (!map[r.code]) map[r.code] = r.url || (r.filename ? '/storage/uploads/' + r.filename : ''); });
      return map;
    });
  }).catch(function() { return {}; });
}

// ── actions ──
function deleteProduction(id) { return ctx.api.resource('production').destroy({ filterByTk: id }); }

// ── card helpers ──
function matRollupColor(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'sent' || s === 'returned') return '#22c55e';
  if (s === 'cancelled') return '#ef4444';
  return '#9ca3af';
}
function miniStat(label, value, color) {
  return ce('div', { style: { textAlign: 'center', minWidth: 40 } },
    ce('div', { style: { fontSize: 8, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 } }, label),
    ce('div', { style: { fontSize: 14, fontWeight: 700, color: color || '#111827' } }, value));
}
function matLine(label, g) {
  const labelEl = ce('span', { style: { fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, width: 46, flexShrink: 0 } }, label);
  if (!g || !g.total) {
    return ce('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, labelEl, ce('span', { style: { fontSize: 11, color: '#cbd5e1' } }, '—'));
  }
  const c = matRollupColor(g.status);
  return ce('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, labelEl,
    ce('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, background: c + '18', color: c, border: '1px solid ' + c + '55', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 700 } },
      g.status || 'unknown',
      ce('span', { style: { fontSize: 10, fontWeight: 600, opacity: 0.8 } }, g.done + '/' + g.total)));
}

// ── card renderer ──
function renderCard(o) {
  const row = o.row;
  const summary = o.summary && o.summary[row.id];
  const selectMode = o.selectMode, selected = o.selected;
  const img = (o.imgMap && o.imgMap[row.product_code]) || '';
  const dl = daysLeft(row.est_production_finish);
  const overdue = dl !== null && dl < 0 && String(row.status).toLowerCase() !== 'done';

  return ce('div', { className: 'pjb-cardbody' },
    ce('div', { className: 'pjb-col-summary' },
      selectMode
        ? ce('div', { style: { width: 22, height: 22, borderRadius: 6, flexShrink: 0, border: '2px solid ' + (selected ? '#6366f1' : '#cbd5e1'), background: selected ? '#6366f1' : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 } }, selected ? '✓' : '')
        : null,
      ce('div', { style: { width: 56, height: 56, borderRadius: 10, flexShrink: 0, background: '#f3f4f6', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
        img ? ce('img', { src: img, style: { width: '100%', height: '100%', objectFit: 'cover' } }) : ce('span', { style: { fontSize: 20, color: '#cbd5e1' } }, '👕')),
      ce('div', { style: { flex: 1, minWidth: 0 } },
        ce('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 } },
          ce('span', { style: { fontWeight: 700, fontSize: 14, color: '#111827' } }, row.product_code || '—'),
          ce('span', { style: { background: sBg(row.status), color: sColor(row.status), border: '1px solid ' + sColor(row.status) + '44', borderRadius: 20, padding: '1px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' } }, sLabel(row.status))),
        ce('div', { style: { fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, row.product_name || '—'),
        ce('div', { style: { fontSize: 11, color: '#9ca3af', marginTop: 2 } }, row.konveksi_name || '—'),
        row.created_at ? ce('div', { style: { fontSize: 10, color: '#9ca3af', marginTop: 3, fontWeight: 600 } }, fmtDate(row.created_at)) : null)),
    ce('div', { className: 'pjb-col-material' },
      matLine('Fabric', summary && summary.fabric),
      matLine('Acc', summary && summary.acc),
      matLine('Sample', summary && summary.sample)),
    ce('div', { className: 'pjb-col-qty' },
      summary
        ? ce('div', { style: { display: 'inline-flex', gap: 12 } },
            ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              miniStat('DO', summary.do, '#111827'),
              miniStat('Cut', summary.cut, (summary.do > 0 && summary.cut === summary.do) ? '#22c55e' : '#111827')),
            ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              miniStat('Sent', summary.sent, doneColor(summary.sent, summary.cut)),
              miniStat('QC', summary.qc, doneColor(summary.qc, summary.sent))))
        : ce('span', { style: { fontSize: 11, color: '#cbd5e1' } }, 'loading…')),
    ce('div', { className: 'pjb-col-dates' },
      ce('div', { className: 'pjb-date-start' },
        ce('div', { style: { fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Start'),
        ce('div', { style: { fontSize: 12, fontWeight: 600, color: '#374151' } }, fmtDate(row.est_production_start))),
      ce('div', null,
        ce('div', { style: { fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Finish'),
        ce('div', { style: { fontSize: 12, fontWeight: 600, color: overdue ? '#ef4444' : '#374151' } }, fmtDate(row.est_production_finish)),
        overdue ? ce('div', { style: { fontSize: 10, color: '#ef4444', fontWeight: 700 } }, Math.abs(dl) + 'd late') : null)));
}

// ── shared detail loader (entry from the list) ──
const ProductionDetailBody = function(props) {
  const sC = useState(null); const Mod = sC[0]; const setMod = sC[1];
  useEffect(function() { loadCode('ui_production_detail').then(function(m) { setMod(m && m.DetailBody ? m : false); }).catch(function() { setMod(false); }); }, []);
  const helpers = props.helpers;
  if (Mod === null) return ce('div', { style: { padding: 50, textAlign: 'center' } }, ce(Spin, null));
  if (!Mod) return ce('div', { style: { padding: 24, color: '#ef4444', fontSize: 13 } }, 'Could not load the detail view (ui_production_detail).');
  return ce(Mod.DetailBody, {
    productionId: props.productionId, refreshKey: props.refreshKey,
    onOpenMaterial: function(pmId) {
      // handoff: close THIS production detail, then open the material detail at root.
      if (helpers && helpers.closeDetail) helpers.closeDetail();
      if (navRef.open) navRef.open('material', pmId, helpers);
    },
  });
};
const NewDrawerLoader = function(props) {
  const sC = useState(null); const Mod = sC[0]; const setMod = sC[1];
  useEffect(function() { loadCode('ui_production_edit').then(setMod).catch(function() { setMod(false); }); }, []);
  if (!Mod || !Mod.ProductionNewDrawer) return null;
  return ce(Mod.ProductionNewDrawer, { open: props.open, onClose: props.onClose, onCreated: props.onCreated });
};
const EditDrawerLoader = function(props) {
  const sC = useState(null); const Mod = sC[0]; const setMod = sC[1];
  useEffect(function() { loadCode('ui_production_edit').then(setMod).catch(function() { setMod(false); }); }, []);
  if (!Mod || !Mod.ProductionEditDrawer) return null;
  return ce(Mod.ProductionEditDrawer, { open: props.open, productionId: props.productionId, onClose: props.onClose, onSaved: props.onSaved });
};

// ── record nav host (cross-record replace navigation + edit/delete) ──
const RecordNavHost = function() {
  const sC = useState(null); const Mod = sC[0]; const setMod = sC[1];
  useEffect(function() { loadCode('ui_record_nav').then(setMod).catch(function() {}); }, []);
  if (!Mod || !Mod.RecordNav) return null;
  return ce(Mod.RecordNav, { navRef: navRef });
};

// ── per-view CSS (layout only; engine owns the swipe-frame CSS) ──
const VIEW_CSS =
  ".pjb-cardbody{display:flex;gap:12px;padding:12px;align-items:center;}" +
  ".pjb-col-summary{flex:1;min-width:0;display:flex;gap:12px;align-items:center;}" +
  ".pjb-col-dates{flex-shrink:0;display:flex;flex-direction:column;gap:6px;align-items:flex-end;text-align:right;}" +
  ".pjb-col-material,.pjb-col-qty,.pjb-date-start{display:none;}" +
  "@media(min-width:760px){" +
    ".pjb-cardbody{display:grid;grid-template-columns:minmax(0,1fr) 200px 150px 120px;gap:20px;}" +
    ".pjb-col-material{display:flex;flex-direction:column;gap:5px;align-items:flex-start;}" +
    ".pjb-col-qty{display:block;}" +
    ".pjb-date-start{display:block;}" +
  "}" +
  ".kano-detail-drawer .ant-drawer-content-wrapper{width:min(980px,92vw) !important;}" +
  "@media (max-width:700px){.kano-detail-drawer .ant-drawer-content-wrapper{width:100% !important;}}";

// after-create: poll until the workflow-written sample row appears
function newReadyPredicate(newId) {
  return function(rows, sum) {
    const s = (newId != null && sum) ? sum[String(newId)] : null;
    return !!(s && s.sample && s.sample.total > 0);
  };
}

// ── CONFIG ──
const config = {
  title: 'Productions',
  css: VIEW_CSS,
  searchPlaceholder: 'Search code, name, konveksi, ref…',
  emptyText: 'No productions match this filter',
  pageSize: 15,

  fetchList: fetchList,
  fetchSummaries: fetchListSummaries,
  fetchImages: fetchProductImages,
  getImage: (row, map) => (map && map[row.product_code]) || '',

  searchText: r => [r.product_code, r.product_name, r.konveksi_name, r.production_ref],

  mainTabs: {
    allLabel: 'All',
    tabs: [
      { key: 'planning',   label: 'Planning',   color: sColor('planning'),   bg: sBg('planning') },
      { key: 'production', label: 'Production', color: sColor('production'), bg: sBg('production') },
      { key: 'qc',         label: 'QC',         color: sColor('qc'),         bg: sBg('qc') },
      { key: 'permak',     label: 'Permak',     color: sColor('permak'),     bg: sBg('permak') },
      { key: 'done',       label: 'Done',       color: sColor('done'),       bg: sBg('done') },
    ],
    classify: function(r) { const s = String(r.status || '').toLowerCase(); return (s === 'cutting' || s === 'production') ? 'production' : s; },
  },

  secondaryFilters: [
    { key: 'konveksi', label: 'Konveksi', kind: 'select', field: 'konveksi_name', search: true },
    { key: 'start',  label: 'Est. start',  kind: 'dateRange', field: 'est_production_start' },
    { key: 'finish', label: 'Est. finish', kind: 'dateRange', field: 'est_production_finish' },
  ],

  sortOptions: [
    { key: 'created_desc', label: 'Newest' },
    { key: 'start_asc',    label: 'Start ↑' },
    { key: 'start_desc',   label: 'Start ↓' },
    { key: 'finish_asc',   label: 'Finish ↑' },
    { key: 'finish_desc',  label: 'Finish ↓' },
  ],
  sortComparator: function(key) {
    if (key === 'created_desc') return null;
    const field = key.indexOf('start') === 0 ? 'est_production_start' : 'est_production_finish';
    const dir = key.indexOf('_asc') !== -1 ? 1 : -1;
    return function(a, b) {
      const av = a[field] ? new Date(a[field]).getTime() : (dir === 1 ? Infinity : -Infinity);
      const bv = b[field] ? new Date(b[field]).getTime() : (dir === 1 ? Infinity : -Infinity);
      return (av - bv) * dir;
    };
  },

  renderCard: renderCard,

  detailTitle: r => r.production_ref || ('#' + r.id),
  statusAccent: r => sColor(r.status),
  detailRender: (row, rk, helpers) => ce(ProductionDetailBody, { productionId: row.id, refreshKey: rk, helpers: helpers }),

  renderNewDrawer: function(api) {
    return ce(NewDrawerLoader, {
      open: api.open, onClose: api.onClose,
      onCreated: function(newId) { api.onClose(); api.helpers.reloadUntil(newReadyPredicate(newId)); },
    });
  },
  renderEditDrawer: function(api) {
    return ce(EditDrawerLoader, {
      open: api.open, productionId: api.row ? api.row.id : null, onClose: api.onClose,
      onSaved: function() { api.onClose(); api.helpers.refresh(); api.helpers.reloadKeepOpen(); },
    });
  },

  deleteRow: deleteProduction,
  deleteTitle: 'Delete production?',
  deleteLabel: row => row.production_ref || row.product_code || ('#' + row.id),

  bulkActions: [
    { label: '🧵 Prepare fabric', bg: '#0ea5e9', color: '#fff', run: function(ids, helpers) {
        loadCode('ui_prepare_fabric').then(function(PF) {
          return PF.fetchFabricRows(ctx, ids).then(function(data) {
            if (!data.length) { message.warning('No fabric records found for the selected productions.'); return; }
            return PF.openFabricModal(data, ids.length);
          });
        }).catch(function(e) { message.error('Failed: ' + ((e && e.message) || e)); });
      } },
    { label: '🗑 Delete', bg: '#ef4444', color: '#fff', run: function(ids, helpers) {
        Modal.confirm({ title: 'Delete ' + ids.length + ' production(s)?', content: 'This cannot be undone.', okText: 'Delete', okButtonProps: { danger: true },
          onOk: () => Promise.all(ids.map(id => deleteProduction(id))).then(() => { message.success('Deleted ' + ids.length + '.'); helpers.exitSelect(); helpers.reload(); }).catch(e => message.error('Bulk delete failed: ' + ((e && e.message) || e))) });
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