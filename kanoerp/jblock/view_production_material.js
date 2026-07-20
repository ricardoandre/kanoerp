// =====================================================
// jblock — PRODUCTION MATERIAL (runs on the ui_list_engine engine)
//
// Thin domain config: SQL, status colors, card layout, NEW form. The material
// DETAIL and EDIT both come from the shared ui_production_material_detail row
// (single source — same material detail/edit everywhere). Cross-record
// navigation is handled by the shared ui_record_nav host at the view root:
// production_ref ⇄ material row, each click CLOSES the current drawer and opens
// the target (replace, no stack).
//
// NOTE (2026-07): all raw ctx.sql usage (loadCode, runSql, fetchList,
// fetchSummaries, fetchImages, fetchExtra) converted to ctx.api.resource() —
// ctx.sql.save() is admin/root-gated and silently fails for non-admin roles
// (see README §3). This means the entire Production Material list was broken
// for non-admin roles until now, same as its sibling view_production.js. Do
// not revert to raw SQL. fetchImages uses appends:['image'] instead of
// introspecting the `fields` metadata table.
//
// NOTE (2026-07, cont'd): fetchList/fetchSummaries/fetchExtra now go through
// fetchAllPages() and fetchByIn() (see "scaling helpers" below) instead of
// single list() calls with large pageSize / large $in arrays. NocoBase's
// resource list() is a GET request, so a big filter (many IDs, or many
// string codes) gets JSON-encoded straight into the URL — past a few hundred
// items this blows nginx's `large_client_header_buffers` and throws
// 414 Request-URI Too Large, no matter how high that buffer is set. The
// fixes are (a) always paginate list() calls that don't filter by a small
// known set, and (b) chunk any $in array into batches before querying.
// Tested against 300 production_material rows; designed to hold at
// 10,000+.
// =====================================================
const { React, antd, dayjs } = ctx.libs;
const { useState, useEffect } = React;
const { Select, InputNumber, Modal, message } = antd;
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

// ── scaling helpers (2026-07) ──
// fetchAllPages: loops list() until a page comes back short, so no single
// request ever needs a huge pageSize. Safe for any table size.
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

// chunk: splits an array into fixed-size batches.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// fetchByIn: queries resourceName WHERE field IN (values), batching values
// into groups of BATCH_SIZE so no single request's $in filter grows large
// enough to blow the URL length limit (nginx 414). Each batch is itself
// paginated via fetchAllPages, since a batch of IDs/codes can still match
// more rows than the batch size (e.g. one-to-many joins). Batches run
// sequentially to avoid hammering the server with many large concurrent
// requests.
const BATCH_SIZE = 150;
function fetchByIn(resourceName, field, values, params) {
  const values2 = uniq(values);
  if (!values2.length) return Promise.resolve([]);
  const batches = chunk(values2, BATCH_SIZE);
  return batches.reduce(function (promise, batch) {
    return promise.then(function (acc) {
      const filter = Object.assign({}, (params && params.filter) || {});
      filter[field] = { $in: batch };
      return fetchAllPages(resourceName, Object.assign({}, params, { filter: filter }))
        .then(function (rows) { return acc.concat(rows); });
    });
  }, Promise.resolve([]));
}

// ── data layer ──
function fetchList() {
  return fetchAllPages('production_material', {
    fields: ['id', 'status', 'shipment_date', 'quantity_need', 'fk_material_details_code', 'fk_production_id'],
    sort: ['-id'],
  }).then(function (pmRows) {

    const productionIds = [...new Set(pmRows.map(r => r.fk_production_id).filter(Boolean))];
    const materialCodes = [...new Set(pmRows.map(r => r.fk_material_details_code).filter(Boolean))];

    const prodP = fetchByIn('production', 'id', productionIds, { fields: ['id', 'production_ref', 'planning_rol', 'fk_product_code', 'fk_konveksi_code'] });
    const mdP = fetchByIn('material_details', 'code', materialCodes, { fields: ['code', 'fk_material_code'] });

    return Promise.all([prodP, mdP]).then(function (r) {
      const prodRows = r[0], mdRows = r[1];
      const prodById = {}; prodRows.forEach(p => { prodById[p.id] = p; });
      const mdByCode = {}; mdRows.forEach(m => { mdByCode[m.code] = m; });

      const productCodes = [...new Set(prodRows.map(p => p.fk_product_code).filter(Boolean))];
      const konveksiCodes = [...new Set(prodRows.map(p => p.fk_konveksi_code).filter(Boolean))];
      const rawCodes = [...new Set(mdRows.map(m => m.fk_material_code).filter(Boolean))];

      const productP = fetchByIn('product', 'code', productCodes, { fields: ['code', 'name'] });
      const konveksiP = fetchByIn('konveksi', 'code', konveksiCodes, { fields: ['code', 'name'] });
      const rawP = fetchByIn('raw_material', 'code', rawCodes, { fields: ['code', 'type', 'default_content'] });

      return Promise.all([productP, konveksiP, rawP]).then(function (r2) {
        const productByCode = {}; r2[0].forEach(p => { productByCode[p.code] = p; });
        const konveksiByCode = {}; r2[1].forEach(k => { konveksiByCode[k.code] = k; });
        const rawByCode = {}; r2[2].forEach(rm => { rawByCode[rm.code] = rm; });

        // Original used INNER JOINs across all these — a row that doesn't
        // fully resolve is dropped, matching that behavior.
        return pmRows.map(function (pm) {
          const production = prodById[pm.fk_production_id];
          if (!production) return null;
          const product = productByCode[production.fk_product_code];
          const konveksi = konveksiByCode[production.fk_konveksi_code];
          if (!product || !konveksi) return null;
          const md = mdByCode[pm.fk_material_details_code];
          if (!md) return null;
          const rm = rawByCode[md.fk_material_code];
          if (!rm) return null;

          return {
            id: pm.id,
            status: pm.status,
            shipment_date: pm.shipment_date,
            quantity_need: pm.quantity_need,
            material_code: pm.fk_material_details_code,
            production_id: pm.fk_production_id,
            material_type: rm.type,
            default_content: rm.default_content,
            production_ref: production.production_ref,
            planning_rol: production.planning_rol,
            product_code: product.code,
            product_name: product.name,
            konveksi_name: konveksi.name,
          };
        }).filter(Boolean);
      });
    });
  });
}

function fetchSummaries(rows) {
  const pmIds = rows.map(r => r.id), prodIds = uniq(rows.map(r => r.production_id));
  if (!pmIds.length) return Promise.resolve({ out: {}, doMap: {} });

  const doP = fetchByIn('production_quantity_details', 'fk_production_id', prodIds, { fields: ['fk_production_id', 'quantity'] });
  const ledgerP = fetchByIn('material_ledger', 'fk_production_material_id', pmIds, { fields: ['id', 'fk_production_material_id'] });

  return Promise.all([doP, ledgerP]).then(function (r) {
    const doRows = r[0], ledgerRows = r[1];

    const doMap = {};
    doRows.forEach(function (x) {
      const pid = String(x.fk_production_id);
      doMap[pid] = (doMap[pid] || 0) + num(x.quantity);
    });

    const ledgerToPm = {};
    ledgerRows.forEach(function (h) { ledgerToPm[String(h.id)] = String(h.fk_production_material_id); });
    const ledgerIds = ledgerRows.map(h => h.id).filter(Boolean);

    if (!ledgerIds.length) return { out: {}, doMap: doMap };

    return fetchByIn('material_ledger_details', 'fk_material_ledger_id', ledgerIds, { fields: ['fk_material_ledger_id', 'details'] })
      .then(function (detRows) {
        const out = {};
        detRows.forEach(function (d) {
          const pm = ledgerToPm[String(d.fk_material_ledger_id)];
          if (!pm) return;
          if (!out[pm]) out[pm] = { count: 0, total: 0 };
          out[pm].count += 1;
          out[pm].total += num(d.details);
        });
        return { out: out, doMap: doMap };
      });
  }).catch(() => ({ out: {}, doMap: {} }));
}

function fetchImages() {
  return fetchAllPages('product', {
    fields: ['code'],
    appends: ['image'],
  }).then(function (rows) {
    const map = {};
    rows.forEach(function (p) {
      const img = p.image;
      const imgRow = Array.isArray(img) ? img[0] : img;
      if (!imgRow) return;
      map[p.code] = imgRow.url || (imgRow.filename ? '/storage/uploads/' + imgRow.filename : '');
    });
    return map;
  }).catch(() => ({}));
}

function fetchExtra() {
  const productionsP = fetchAllPages('production', {
    fields: ['id', 'production_ref', 'fk_product_code', 'fk_konveksi_code', 'created_at'],
    sort: ['-created_at'],
  });

  const materialsP = fetchAllPages('material_details', {
    fields: ['code'],
    sort: ['code'],
  });

  return Promise.all([productionsP, materialsP]).then(function (r) {
    const productions = r[0], materials = r[1];

    const productCodes = [...new Set(productions.map(p => p.fk_product_code).filter(Boolean))];
    const konveksiCodes = [...new Set(productions.map(p => p.fk_konveksi_code).filter(Boolean))];

    const productLookupP = fetchByIn('product', 'code', productCodes, { fields: ['code', 'name'] });
    const konveksiLookupP = fetchByIn('konveksi', 'code', konveksiCodes, { fields: ['code', 'name'] });

    return Promise.all([productLookupP, konveksiLookupP]).then(function (r2) {
      const productByCode = {}; r2[0].forEach(p => { productByCode[p.code] = p; });
      const konveksiByCode = {}; r2[1].forEach(k => { konveksiByCode[k.code] = k; });

      const prodRows = productions.map(function (p) {
        const product = productByCode[p.fk_product_code] || {};
        const konveksi = konveksiByCode[p.fk_konveksi_code] || {};
        return { id: p.id, ref: p.production_ref, pcode: product.code, pname: product.name, kname: konveksi.name };
      });

      return { productions: prodRows, materials: materials };
    });
  });
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
