// =====================================================
// jblock — PRODUCTION  (runs on the ui_list_engine engine)
//
// Thin domain config: SQL, status colors, card layout, plus loaders that pull
// the shared production DETAIL (ui_production_detail) and NEW/EDIT drawers
// (ui_production_edit). Cross-record navigation (production → material and back)
// is handled by the shared ui_record_nav host mounted at the view root: every
// cross-link CLOSES the current drawer and opens the target (replace, no stack).
//
// NOTE (2026-07): all raw ctx.sql usage (loadCode, runSql, fetchList,
// fetchListSummaries, fetchProductImages) converted to ctx.api.resource() —
// ctx.sql.save() is admin/root-gated and silently fails for non-admin roles
// (see README §3). This means the entire Production list — the main list
// view, not just detail popups — was broken for non-admin roles until now.
// Do not revert to raw SQL. fetchProductImages uses appends:['image'] in a
// bulk .list() call instead of introspecting the `fields` metadata table.
// =====================================================
const { React, antd, dayjs } = ctx.libs;
const { useState, useEffect } = React;
const { Modal, Spin, message } = antd;
const ce = React.createElement;

// shared code loader
const _codeCache = {};
async function loadCode(name) {
  if (_codeCache[name]) return _codeCache[name];
  const res = await ctx.api.resource('source_code').list({
    filter: { name: name },
    fields: ['code'],
    pageSize: 1,
  });
  const rows = (res && res.data && res.data.data) || [];
  const src = (rows[0] && rows[0].code) || '';
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
const num = v => Number(v == null ? 0 : v);
const doneColor = (val, ref) => (ref > 0 && val === ref) ? '#22c55e' : '#f97316';
function fmtDate(d) { if (!d) return '—'; const p = dayjs(d); return p.isValid() ? p.format('DD MMM YYYY') : '—'; }
function daysLeft(d) { if (!d) return null; return Math.ceil((new Date(d) - new Date()) / 86400000); }

// ── data layer ──
function fetchList() {
  return ctx.api.resource('production').list({
    fields: ['id', 'production_ref', 'status', 'is_new', 'est_production_start', 'est_production_finish', 'created_at', 'fk_product_code', 'fk_konveksi_code'],
    sort: ['-created_at'],
    pageSize: 2000,
  }).then(function (prodRes) {
    const prodRows = (prodRes && prodRes.data && prodRes.data.data) || [];

    const productCodes = [...new Set(prodRows.map(r => r.fk_product_code).filter(Boolean))];
    const konveksiCodes = [...new Set(prodRows.map(r => r.fk_konveksi_code).filter(Boolean))];

    const productP = productCodes.length
      ? ctx.api.resource('product').list({ filter: { code: { $in: productCodes } }, fields: ['code', 'name'], pageSize: 2000 })
          .then(res => (res && res.data && res.data.data) || [])
      : Promise.resolve([]);
    const konveksiP = konveksiCodes.length
      ? ctx.api.resource('konveksi').list({ filter: { code: { $in: konveksiCodes } }, fields: ['code', 'name'], pageSize: 2000 })
          .then(res => (res && res.data && res.data.data) || [])
      : Promise.resolve([]);

    return Promise.all([productP, konveksiP]).then(function (r) {
      const productByCode = {}; r[0].forEach(p => { productByCode[p.code] = p; });
      const konveksiByCode = {}; r[1].forEach(k => { konveksiByCode[k.code] = k; });

      return prodRows.map(function (p) {
        const product = productByCode[p.fk_product_code] || {};
        const konveksi = konveksiByCode[p.fk_konveksi_code] || {};
        return {
          id: p.id,
          production_ref: p.production_ref,
          status: p.status,
          is_new: p.is_new,
          est_production_start: p.est_production_start,
          est_production_finish: p.est_production_finish,
          created_at: p.created_at,
          product_code: product.code,
          product_name: product.name,
          konveksi_name: konveksi.name,
        };
      });
    });
  });
}

function fetchListSummaries(rows) {
  const ids = (rows || []).map(r => r.id);
  if (!ids.length) return Promise.resolve({});

  const doP = ctx.api.resource('production_quantity_details').list({
    filter: { fk_production_id: { $in: ids } },
    fields: ['fk_production_id', 'quantity', 'cut_quantity'],
    pageSize: 5000,
  }).then(res => (res && res.data && res.data.data) || []);

  const sentP = ctx.api.resource('production_result').list({
    filter: { fk_production_id: { $in: ids } },
    fields: ['fk_production_id', 'quantity'],
    pageSize: 5000,
  }).then(res => (res && res.data && res.data.data) || []);

  const qcP = ctx.api.resource('qc_result').list({
    filter: { fk_production_id: { $in: ids } },
    fields: ['fk_production_id', 'quantity'],
    pageSize: 5000,
  }).then(res => (res && res.data && res.data.data) || []);

  const pmP = ctx.api.resource('production_material').list({
    filter: { fk_production_id: { $in: ids } },
    fields: ['id', 'fk_production_id', 'fk_material_details_code', 'status'],
    pageSize: 5000,
  }).then(res => (res && res.data && res.data.data) || []);

  const sampleP = ctx.api.resource('production_sample').list({
    filter: { fk_production_id: { $in: ids } },
    fields: ['fk_production_id', 'status'],
    pageSize: 5000,
  }).then(res => (res && res.data && res.data.data) || []);

  return Promise.all([doP, sentP, qcP, pmP, sampleP]).then(function (r) {
    const doRows = r[0], sentRows = r[1], qcRows = r[2], pmRows = r[3], sampleRows = r[4];

    // batched material_details -> raw_material lookup for the pm rows'
    // material types (fabric vs accessories), same pattern as other files
    const materialCodes = [...new Set(pmRows.map(m => m.fk_material_details_code).filter(Boolean))];
    const mdP = materialCodes.length
      ? ctx.api.resource('material_details').list({ filter: { code: { $in: materialCodes } }, fields: ['code', 'fk_material_code'], pageSize: 2000 })
          .then(res => (res && res.data && res.data.data) || [])
      : Promise.resolve([]);

    return mdP.then(function (mdRows) {
      const mdByCode = {}; mdRows.forEach(m => { mdByCode[m.code] = m; });
      const rawCodes = [...new Set(mdRows.map(m => m.fk_material_code).filter(Boolean))];
      const rmP = rawCodes.length
        ? ctx.api.resource('raw_material').list({ filter: { code: { $in: rawCodes } }, fields: ['code', 'type'], pageSize: 2000 })
            .then(res => (res && res.data && res.data.data) || [])
        : Promise.resolve([]);

      return rmP.then(function (rmRows) {
        const rmByCode = {}; rmRows.forEach(rm => { rmByCode[rm.code] = rm; });

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

        const doSums = {}, cutSums = {};
        doRows.forEach(function (x) {
          const pid = String(x.fk_production_id);
          doSums[pid] = (doSums[pid] || 0) + num(x.quantity);
          cutSums[pid] = (cutSums[pid] || 0) + num(x.cut_quantity);
        });
        Object.keys(Object.assign({}, doSums, cutSums)).forEach(function (pid) {
          const m = ensure(pid); m.do = doSums[pid] || 0; m.cut = cutSums[pid] || 0;
        });

        const sentSums = {};
        sentRows.forEach(function (x) { const pid = String(x.fk_production_id); sentSums[pid] = (sentSums[pid] || 0) + num(x.quantity); });
        Object.keys(sentSums).forEach(function (pid) { ensure(pid).sent = sentSums[pid]; });

        const qcSums = {};
        qcRows.forEach(function (x) { const pid = String(x.fk_production_id); qcSums[pid] = (qcSums[pid] || 0) + num(x.quantity); });
        Object.keys(qcSums).forEach(function (pid) { ensure(pid).qc = qcSums[pid]; });

        pmRows.forEach(function (x) {
          const m = ensure(x.fk_production_id);
          const md = mdByCode[x.fk_material_details_code];
          const rm = md ? rmByCode[md.fk_material_code] : null;
          const mtype = rm ? String(rm.type || '').toLowerCase() : '';
          applyStatus(mtype === 'fabric' ? m.fabric : m.acc, x.status);
        });

        sampleRows.forEach(function (x) { applyStatus(ensure(x.fk_production_id).sample, x.status); });

        return map;
      });
    });
  }).catch(() => ({}));
}

function fetchProductImages() {
  return ctx.api.resource('product').list({
    fields: ['code'],
    appends: ['image'],
    pageSize: 2000,
  }).then(function (res) {
    const rows = (res && res.data && res.data.data) || [];
    const map = {};
    rows.forEach(function (p) {
      const img = p.image;
      const imgRow = Array.isArray(img) ? img[0] : img;
      if (!imgRow) return;
      map[p.code] = imgRow.url || (imgRow.filename ? '/storage/uploads/' + imgRow.filename : '');
    });
    return map;
  }).catch(function () { return {}; });
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
    { label: '📋 Duplicate', bg: '#6366f1', color: '#fff', run: function(ids, helpers) {
        if (ids.length !== 1) { message.warning('Select exactly one production to duplicate.'); return; }
        const sourceId = ids[0];
        Modal.confirm({
          title: 'Duplicate this production?',
          okText: 'Duplicate', cancelText: 'Cancel',
          onOk: function() {
            loadCode('ui_production_edit').then(function(PE) {
              return PE.openDuplicateDrawer(sourceId, {
                onCreated: function(newId) {
                  helpers.exitSelect();
                  if (helpers.reloadUntil) helpers.reloadUntil(newReadyPredicate(newId));
                  else helpers.reload();
                },
              });
            }).catch(function(e) { message.error('Duplicate failed: ' + ((e && e.message) || e)); });
          },
        });
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
