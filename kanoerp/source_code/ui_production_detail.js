// =====================================================
// ui_production_detail — shared production DETAIL (read-only view).
//
// Stored as a `source_code` row named 'ui_production_detail'.
// Loaded via loadCode('ui_production_detail'); compiled with
//   new Function('React','antd','dayjs','ctx', src)(React, antd, dayjs, ctx).
//
// EXPORTS (contract):
//   DetailBody({ productionId, refreshKey })
//       — the accordion of sections (Summary · Material · Quantity · Remarks
//         · Marker · History). SELF-FETCHES everything from productionId
//         (header, product image, materials, quantities, history). Renders no
//         outer chrome (no title/accent bar/spacer) so a host can wrap it.
//         This is what the list-engine's config.detailRender renders.
//
//   ProductionDetailDrawer({ open, productionId, onClose, onEdit, onDelete, refreshKey })
//       — STANDALONE right-drawer: title + status-accent + Edit/Delete chrome,
//         wrapping DetailBody. This is the handoff entry point so a production
//         detail can be opened from anywhere (e.g. production_material).
//         onEdit(productionId) / onDelete(productionId) are caller-supplied.
//
// Depends on: none.
//
// NOTE: status colors live HERE (the detail is now self-contained); each list
// view still keeps its own card status colors. Slight duplication is intended
// per the "status stays in the view" philosophy — the detail simply owns its.
//
// MARKER SECTION (updated): now reads the relational marker system —
// production_marker (link) → marker (length) → marker_details (per-size
// quantity, via sku_option) — instead of the old free-text `marker` HTML
// field on production. Fetched via ctx.api.resource (non-admin-safe), not
// ctx.sql, per the current standard (ctx.sql is admin/root-gated and fails
// silently for non-admin roles — see recent project notes). Includes an
// "Add marker" button that lazy-loads ui_production_addmarker and opens its
// modal, mirroring the pattern already used elsewhere (act_ shells that
// loadCode() a source_code row and call its openModal()).
// =====================================================
const { Drawer, Dropdown, Spin } = antd;
const ce = React.createElement;
const { useState, useEffect } = React;

// ── status ──
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
// this row composes another shared row → its own loader (ctx is injected)
const _codeCache = {};
function loadCode(name) {
  if (_codeCache[name]) return Promise.resolve(_codeCache[name]);
  const uid = 'code_' + name;
  return ctx.sql.save({ uid, dataSourceKey: 'main', sql: "SELECT code FROM source_code WHERE name='" + name + "'" })
    .then(() => ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' }))
    .then(rows => {
      const src = (rows && rows[0] && rows[0].code) || '';
      _codeCache[name] = new Function('React', 'antd', 'dayjs', 'ctx', src)(React, antd, dayjs, ctx);
      return _codeCache[name];
    });
}

function runSql(uid, sql) {
  return ctx.sql.save({ uid, sql, dataSourceKey: 'main' })
    .then(() => ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' }))
    .then(r => r || []);
}
const num = v => Number(v == null ? 0 : v);
const diffColor = v => v < 0 ? '#ef4444' : v > 0 ? '#22c55e' : '#9ca3af';
const diffLabel = v => v > 0 ? '+' + v : String(v);
const doneColor = (val, ref) => (ref > 0 && val === ref) ? '#22c55e' : '#f97316';
const doneBg    = (val, ref) => (ref > 0 && val === ref) ? '#f0fdf4' : '#fff7ed';
function fmtDate(d) { if (!d) return '—'; const p = dayjs(d); return p.isValid() ? p.format('DD MMM YYYY') : '—'; }
function fmtDateNumeric(d) { if (!d) return ''; const p = dayjs(d); return p.isValid() ? p.format('DD/MM/YYYY') : ''; }
function fmtDateTime(d) { if (!d) return ''; return String(d).substring(0, 16).replace('T', ' '); }
function htmlIsEmpty(s) { return !s || !String(s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim(); }

const M_TO_YARD = 1.0936;
function numVal(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function fmtVal(v) { const n = numVal(v); return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100); }
function capitalize(s) { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function buildNeed(material, isAccessories, planningRol, totalDo) {
  const qn = material.quantity_need;
  const hasQty = qn !== null && qn !== undefined && qn !== '';
  if (isAccessories) {
    const xx = numVal(qn), yy = numVal(totalDo);
    return { rows: [['quantity/pcs', xx, 'pcs'], ['quantity do', yy, 'pcs']], total: ['total', xx * yy, 'pcs'] };
  } else if (!hasQty) {
    const xx = numVal(planningRol), yy = numVal(material.default_content);
    return { rows: [['planning', xx, 'rol'], ['default 1 rol', yy, 'yard']], total: ['total', xx * yy, 'yard'] };
  } else {
    const xx = numVal(qn), yy = numVal(totalDo);
    return { rows: [['quantity/pcs', xx, 'meter'], ['quantity do', yy, 'pcs']], total: ['total', xx * yy * M_TO_YARD, 'yard'] };
  }
}
function renderNeed(need) {
  const children = need.rows.map((r, i) =>
    ce('div', { key: 'r' + i, style: { display: 'flex', justifyContent: 'space-between', fontSize: 11 } },
      ce('span', { style: { color: '#9ca3af' } }, r[0]),
      ce('span', { style: { fontWeight: 600, color: '#374151' } }, fmtVal(r[1]) + ' ' + r[2])));
  children.push(ce('div', { key: 'total', style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#166534', borderTop: '1px solid #e2e8f0', paddingTop: 3, marginTop: 2 } },
    ce('span', null, need.total[0]), ce('span', null, fmtVal(need.total[1]) + ' ' + need.total[2])));
  return ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6, marginBottom: 6, padding: '6px 8px', background: '#fff', border: '1px solid #f0f0f0', borderRadius: 6 } }, children);
}
function renderOutLine(status, count, total, unitItem, unitTotal) {
  return ce('div', { style: { fontSize: 11, color: '#9ca3af', marginBottom: 4 } },
    capitalize(status) + ': ',
    ce('span', { style: { fontWeight: 700, color: '#3b82f6' } }, count + ' ' + unitItem + ' (' + fmtVal(total) + ' ' + unitTotal + ')'));
}
function renderOutChips(details) {
  return ce('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 } },
    details.map((v, j) => ce('span', { key: j, style: { background: '#eff6ff', color: '#3b82f6', border: '1px solid #bfdbfe', borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600 } }, v)));
}

const secTitle = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af', marginBottom: 12 };
function metaItem(label, value) {
  return ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
    ce('div', { style: { fontSize: 11, color: '#9ca3af', fontWeight: 500 } }, label),
    ce('div', { style: { fontSize: 13, color: '#111827', fontWeight: 500 } }, value || '—'));
}
function pill(text, bg, color) {
  return ce('span', { style: { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: bg, color: color } }, text);
}

// ── per-module CSS (pd- prefix; rules unscoped because drawer content portals
//    to <body>). Injected by DetailStyles, rendered in both host paths. ──
const DETAIL_CSS =
  ".pd-detail-drawer .ant-drawer-content-wrapper{width:min(980px,92vw) !important;}" +
  "@media (max-width:700px){.pd-detail-drawer .ant-drawer-content-wrapper{width:100% !important;}}" +
  ".pd-sum2{display:grid;grid-template-columns:1fr 1fr;gap:16px 24px;}" +
  ".pd-qexp{display:grid;grid-template-columns:1fr 1fr;gap:10px;}" +
  "@media (max-width:560px){.pd-qexp{grid-template-columns:1fr;}}" +
  ".pd-remarks{font-size:13px;color:#374151;line-height:1.7;}" +
  ".pd-remarks p{margin:0 0 8px;}" +
  ".pd-remarks ul,.pd-remarks ol{margin:0 0 8px;padding-left:20px;}" +
  ".pd-remarks img{max-width:100%;height:auto;border-radius:8px;}" +
  ".pd-sum-layout{display:flex;flex-direction:column;gap:16px;}" +
  ".pd-sum-img{width:100%;border-radius:12px;overflow:hidden;background:#f3f4f6;display:flex;align-items:center;justify-content:center;}" +
  "@media(min-width:760px){.pd-sum-layout{flex-direction:row;align-items:flex-start;gap:24px;}.pd-sum-img{width:300px;flex-shrink:0;}.pd-sum-meta{flex:1;min-width:0;}}" +
  ".pd-matgrid{display:grid;grid-template-columns:1fr;column-gap:12px;}" +
  "@media(min-width:760px){.pd-matgrid{grid-template-columns:repeat(2,minmax(0,1fr));}}" +
  ".pd-permak{display:flex;flex-direction:column;gap:16px;}" +
  ".pd-permak-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;max-width:340px;}" +
  "@media(min-width:760px){.pd-permak-hist{max-width:50%;}}";
const DetailStyles = () => ce('style', null, DETAIL_CSS);

// =====================================================
// DATA LAYER (all keyed by productionId)
// =====================================================
function fetchHeader(id) {
  return runSql('pd_hdr_' + id,
    "SELECT production.id AS id, production.production_ref, production.status, production.is_new, " +
    "  production.est_production_start, production.est_production_finish, " +
    "  product.code AS product_code, product.name AS product_name, konveksi.name AS konveksi_name " +
    "FROM production " +
    "JOIN product  ON production.fk_product_code  = product.code " +
    "JOIN konveksi ON production.fk_konveksi_code = konveksi.code " +
    "WHERE production.id = '" + id + "'"
  ).then(r => r[0] || {});
}

// image: attachment fields aren't SQL columns. Introspect product.image's
// through-table + keys from `fields`, then join `attachments` for one product.
function fetchProductImage(productCode) {
  if (!productCode) return Promise.resolve('');
  return runSql('pd_imgmeta',
    "SELECT CAST(options AS CHAR) AS options FROM fields WHERE collection_name='product' AND name='image'"
  ).then(function(rows) {
    if (!rows.length) return '';
    let opt = {}; try { opt = JSON.parse(rows[0].options || '{}'); } catch (e) { return ''; }
    const through = opt.through, fk = opt.foreignKey, ok = opt.otherKey, sk = opt.sourceKey || 'id';
    if (!through || !fk || !ok) return '';
    return runSql('pd_imgjoin_' + productCode,
      "SELECT attachments.url AS url, attachments.filename AS filename FROM product " +
      "JOIN " + through + " ON " + through + "." + fk + " = product." + sk + " " +
      "JOIN attachments ON attachments.id = " + through + "." + ok + " " +
      "WHERE product.code = '" + productCode + "' ORDER BY attachments.id ASC LIMIT 1"
    ).then(function(irows) { const r = irows[0]; return r ? (r.url || (r.filename ? '/storage/uploads/' + r.filename : '')) : ''; });
  }).catch(() => '');
}

function fetchDetailMeta(id) {
  // marker_remarks: free-text notes field on production (what the old
  // `marker` column became). Distinct from the relational marker system
  // (production_marker / marker / marker_details) read by fetchMarkers().
  return runSql('pd_dmeta_' + id, "SELECT remarks, marker_remarks, planning_rol, brand FROM production WHERE id = '" + id + "'").then(r => r[0] || {});
}

function fetchMaterial(id) {
  return Promise.all([
    runSql('pd_dmeta2_' + id, "SELECT planning_rol FROM production WHERE id = '" + id + "'"),
    runSql('pd_dmat_' + id,
      "SELECT pm.id AS id, pm.fk_material_details_code AS material_code, " +
      "  pm.status AS status, pm.shipment_date AS shipment_date, pm.quantity_need AS quantity_need, " +
      "  raw_material.type AS material_type, raw_material.default_content AS default_content " +
      "FROM production_material pm " +
      "JOIN material_details ON pm.fk_material_details_code = material_details.code " +
      "JOIN raw_material ON material_details.fk_material_code = raw_material.code " +
      "WHERE pm.fk_production_id = '" + id + "'"),
    runSql('pd_dsamp_' + id, "SELECT fk_sample_product_code, status, shipment_date, returned_date FROM production_sample WHERE fk_production_id = '" + id + "'"),
    runSql('pd_ddo_' + id, "SELECT COALESCE(SUM(quantity),0) AS total_do FROM production_quantity_details WHERE fk_production_id = '" + id + "'"),
  ]).then(function(meta) {
    const planningRol = num(meta[0] && meta[0][0] && meta[0][0].planning_rol);
    const materialRows = meta[1] || [];
    const samples = meta[2] || [];
    const totalDo = num(meta[3] && meta[3][0] && meta[3][0].total_do);
    const fabrics = materialRows.filter(m => String(m.material_type || '').toLowerCase() === 'fabric');
    const accs    = materialRows.filter(m => String(m.material_type || '').toLowerCase() !== 'fabric');

    function withDetails(rows) {
      return Promise.all(rows.map(function(m) {
        return runSql('pd_dlhdr_' + m.id, "SELECT id FROM material_ledger WHERE fk_production_material_id = '" + m.id + "'").then(function(hdr) {
          const ids = hdr.map(h => h.id).filter(Boolean);
          if (!ids.length) return Object.assign({}, m, { details: [] });
          return runSql('pd_dldet_' + m.id, "SELECT details FROM material_ledger_details WHERE fk_material_ledger_id IN (" + ids.join(',') + ")")
            .then(det => Object.assign({}, m, { details: det.map(d => d.details) }));
        });
      }));
    }

    return Promise.all([withDetails(fabrics), withDetails(accs)]).then(function(r) {
      return { fabrics: r[0], accessories: r[1], samples: samples, totalDo: totalDo, planningRol: planningRol };
    });
  });
}

function fetchQuantity(id) {
  const sqlBase =
    "SELECT sku_option.id AS sku_id, sku_option.display AS variant, pqd.ratio AS ratio, pqd.quantity AS do_quantity, pqd.cut_quantity AS cut_quantity " +
    "FROM production_quantity_details AS pqd, sku_option " +
    "WHERE pqd.fk_production_id = '" + id + "' AND pqd.fk_sku_option_id = sku_option.id ORDER BY sku_option.sort ASC";
  const sqlSent = "SELECT fk_sku_option_id, COALESCE(SUM(quantity),0) AS sent_qty FROM production_result WHERE fk_production_id = '" + id + "' GROUP BY fk_sku_option_id";
  const sqlQc   = "SELECT fk_sku_option_id, COALESCE(SUM(quantity),0) AS qc_qty FROM qc_result WHERE fk_production_id = '" + id + "' GROUP BY fk_sku_option_id";
  const sqlPerm = "SELECT SUM(CASE WHEN quantity<0 THEN quantity*-1 ELSE 0 END) AS sent_permakan, SUM(CASE WHEN quantity>0 THEN quantity ELSE 0 END) AS return_permakan FROM production_result WHERE fk_production_id = '" + id + "' AND is_permakan = TRUE";
  const sqlHistDel =
    "SELECT production_result.shipment_date AS event_date, production_result.checking_pic, production_result.quantity, production_result.is_permakan, production_result.remarks, production_result.fk_sku_option_id, sku_option.display AS variant " +
    "FROM production_result, sku_option WHERE production_result.fk_production_id = '" + id + "' AND production_result.fk_sku_option_id = sku_option.id ORDER BY production_result.shipment_date ASC";
  const sqlHistQc =
    "SELECT qc_result.qc_date AS event_date, qc_result.qc_person, qc_result.is_defect, qc_result.quantity, qc_result.fk_sku_option_id, sku_option.display AS variant " +
    "FROM qc_result, sku_option WHERE qc_result.fk_production_id = '" + id + "' AND qc_result.fk_sku_option_id = sku_option.id ORDER BY qc_result.qc_date ASC";

  return Promise.all([
    runSql('pd_qbase_' + id, sqlBase),
    runSql('pd_qsent_' + id, sqlSent),
    runSql('pd_qqc_'   + id, sqlQc),
    runSql('pd_qperm_' + id, sqlPerm),
    runSql('pd_qhd_'   + id, sqlHistDel),
    runSql('pd_qhq_'   + id, sqlHistQc),
  ]).then(function(r) {
    const base = r[0], sentR = r[1], qcR = r[2], permR = r[3], histDel = r[4], histQc = r[5];
    const sentMap = {}, qcMap = {};
    sentR.forEach(x => { sentMap[String(x.fk_sku_option_id)] = num(x.sent_qty); });
    qcR.forEach(x => { qcMap[String(x.fk_sku_option_id)] = num(x.qc_qty); });
    const rows = base.map(function(b) {
      const sid = String(b.sku_id);
      return { sku_id: sid, variant: b.variant || '(none)', ratio: num(b.ratio), do: num(b.do_quantity), cut: num(b.cut_quantity), sent: sentMap[sid] || 0, qc: qcMap[sid] || 0 };
    });
    const delMap = {}, qcHistMap = {};
    histDel.forEach(e => { const sid = String(e.fk_sku_option_id); (delMap[sid] = delMap[sid] || []).push(Object.assign({}, e, { _type: 'delivery' })); });
    histQc.forEach(e => { const sid = String(e.fk_sku_option_id); (qcHistMap[sid] = qcHistMap[sid] || []).push(Object.assign({}, e, { _type: 'qc' })); });
    return {
      rows, delMap, qcHistMap, perm: permR[0] || {},
      totDo: rows.reduce((s, x) => s + x.do, 0), totCut: rows.reduce((s, x) => s + x.cut, 0),
      totSent: rows.reduce((s, x) => s + x.sent, 0), totQc: rows.reduce((s, x) => s + x.qc, 0),
    };
  });
}

function fetchHistory(id) {
  return runSql('pd_dhist_' + id,
    "SELECT users.nickname AS name, history.create_date AS history_date, history.status, history.message, history.category, history.table_name AS source " +
    "FROM history, users WHERE history.fk_user_id = users.id AND ( " +
    "  (history.table_name='production' AND history.table_id=" + id + ") " +
    "  OR (history.table_name='production_sample' AND history.table_id IN (SELECT id FROM production_sample WHERE fk_production_id=" + id + ")) " +
    "  OR (history.table_name='production_material' AND history.table_id IN (SELECT id FROM production_material WHERE fk_production_id=" + id + ")) " +
    ") ORDER BY history_date DESC LIMIT 30"
  );
}

// Markers — resource-API reads (non-admin-safe), NOT ctx.sql, per current
// standard. production_marker (link table) → marker (length) → marker_details
// (per-size quantity, via sku_option). Returns [{ id, length, sizes: [{display,
// sort, quantity}] }], sorted by marker id ascending (BigInt-safe — snowflake
// ids can exceed Number.MAX_SAFE_INTEGER).
function fetchMarkers(id) {
  return ctx.api.resource('production_marker').list({
    filter: { fk_production_id: id },
    fields: ['fk_marker_id'],
    pageSize: 100,
  }).then(function(res) {
    const links = (res && res.data && res.data.data) || [];
    const markerIds = links.map(l => l.fk_marker_id).filter(Boolean);
    if (!markerIds.length) return [];
    return ctx.api.resource('marker').list({
      filter: { id: { $in: markerIds } },
      fields: ['id', 'length'],
      pageSize: 100,
    }).then(function(mres) {
      const markers = (mres && mres.data && mres.data.data) || [];
      markers.sort(function(a, b) {
        const ba = BigInt(a.id), bb = BigInt(b.id);
        return ba < bb ? -1 : ba > bb ? 1 : 0;
      });
      return ctx.api.resource('marker_details').list({
        filter: { fk_marker_id: { $in: markerIds } },
        fields: ['fk_marker_id', 'quantity'],
        appends: ['sku_option'],
        pageSize: 500,
      }).then(function(dres) {
        const details = (dres && dres.data && dres.data.data) || [];
        const byMarker = {};
        details.forEach(function(d) {
          const key = String(d.fk_marker_id);
          const so = d.sku_option || {};
          (byMarker[key] = byMarker[key] || []).push({ display: so.display || '-', sort: so.sort || 0, quantity: d.quantity });
        });
        Object.keys(byMarker).forEach(function(k) {
          byMarker[k].sort(function(a, b) { return a.sort - b.sort; });
        });
        return markers.map(function(mk) {
          return { id: mk.id, length: mk.length, sizes: byMarker[String(mk.id)] || [] };
        });
      });
    });
  });
}

// =====================================================
// SECTIONS
// =====================================================
const Section1Summary = function(props) {
  const h = props.header;
  if (!h) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  const img = props.image;
  const statusBlock = ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
    ce('div', { style: { fontSize: 11, color: '#9ca3af', fontWeight: 500 } }, 'Status'),
    ce('span', { style: { alignSelf: 'flex-start', background: sBg(h.status), color: sColor(h.status), border: '1px solid ' + sColor(h.status) + '44', borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 } }, sLabel(h.status)));
  const typeBlock = ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' } },
    ce('div', { style: { fontSize: 11, color: '#9ca3af', fontWeight: 500 } }, 'Type'),
    h.is_new ? pill('New', '#dcfce7', '#16a34a') : pill('Repeat', '#f3f4f6', '#6b7280'));
  return ce('div', { className: 'pd-sum-layout' },
    ce('div', { className: 'pd-sum-img', style: { padding: img ? 0 : 30 } },
      img
        ? ce('img', { src: img, style: { maxWidth: '100%', maxHeight: 360, width: 'auto', height: 'auto', display: 'block', borderRadius: 12 } })
        : ce('span', { style: { fontSize: 42, color: '#cbd5e1' } }, '👕')),
    ce('div', { className: 'pd-sum-meta' },
      ce('div', { className: 'pd-sum2' },
        ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } }, metaItem('Product code', h.product_code), metaItem('Product name', h.product_name), typeBlock, metaItem('Konveksi', h.konveksi_name)),
        ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } }, metaItem('ID', h.id), statusBlock, metaItem('Est. start', fmtDate(h.est_production_start)), metaItem('Est. finish', fmtDate(h.est_production_finish))))));
};

function materialStatusColor(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'sent') return '#22c55e';
  if (s === 'ready') return '#84cc16';
  if (s === 'ordered' || s === 'pending') return '#f97316';
  return '#9ca3af';
}
const Section2Material = function(props) {
  const sL = useState(true); const loading = sL[0]; const setLoading = sL[1];
  const sD = useState(null); const data = sD[0]; const setData = sD[1];
  useEffect(function() { setLoading(true); fetchMaterial(props.id).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false)); }, [props.id, props.refreshKey]);
  if (loading) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  if (!data) return null;

  const matBadge = (status) => { const c = materialStatusColor(status); return ce('span', { style: { display: 'inline-block', background: c + '22', color: c, border: '1px solid ' + c + '66', borderRadius: 3, padding: '0 6px', fontSize: 10, fontWeight: 600, lineHeight: '18px' } }, status || 'unknown'); };
  const subTitle = t => ce('div', { style: { fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' } }, t);
  const empty = t => ce('div', { style: { fontSize: 12, color: '#d1d5db', marginBottom: 16, fontStyle: 'italic' } }, t);
  const clickable = !!props.onOpenMaterial;

  function matRow(m, isAcc) {
    const details = m.details || [];
    const unitItem = isAcc ? 'pack' : 'rol';
    const unitTotal = isAcc ? 'pcs' : 'yard';
    const outTotal = details.reduce((s, v) => s + Number(v || 0), 0);
    return ce('div', { onClick: clickable ? () => props.onOpenMaterial(m.id) : undefined, title: clickable ? 'View material detail' : undefined,
        style: { borderRadius: 8, border: '1px solid #f0f0f0', padding: '10px 12px', marginBottom: 8, background: '#fafafa', cursor: clickable ? 'pointer' : 'default' } },
      ce('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 2 } },
        ce('div', { style: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 } },
          ce('span', { style: { fontWeight: 600, fontSize: 13, color: clickable ? '#4338ca' : '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, m.material_code || '—'),
          clickable ? ce('span', { style: { color: '#4338ca', fontSize: 14, flexShrink: 0 } }, '›') : null),
        ce('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } },
          m.shipment_date ? ce('span', { style: { fontSize: 11, color: '#64748b' } }, fmtDateNumeric(m.shipment_date)) : null,
          matBadge(m.status))),
      renderNeed(buildNeed(m, isAcc, data.planningRol, data.totalDo)),
      details.length
        ? ce('div', null,
            renderOutLine(m.status, details.length, outTotal, unitItem, unitTotal),
            renderOutChips(details))
        : null);
  }

  return ce('div', null,
    subTitle('Fabric'),
    data.fabrics.length
      ? ce('div', { className: 'pd-matgrid' }, data.fabrics.map((m, i) => ce('div', { key: i }, matRow(m, false))))
      : empty('No fabric records'),
    subTitle('Accessories'),
    data.accessories.length
      ? ce('div', { className: 'pd-matgrid' }, data.accessories.map((m, i) => ce('div', { key: i }, matRow(m, true))))
      : empty('No accessories records'),
    subTitle('Sample'),
    data.samples.length
      ? ce('div', { className: 'pd-matgrid' }, data.samples.map((s, i) => ce('div', { key: i, style: { borderRadius: 8, border: '1px solid #f0f0f0', padding: '10px 12px', marginBottom: 8, background: '#fafafa' } },
          ce('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: s.returned_date ? 6 : 0 } },
            ce('div', { style: { fontWeight: 600, fontSize: 13, color: '#111827' } }, s.fk_sample_product_code || '—'),
            ce('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } }, s.shipment_date ? ce('span', { style: { fontSize: 11, color: '#64748b' } }, fmtDateNumeric(s.shipment_date)) : null, matBadge(s.status))),
          s.returned_date ? ce('div', { style: { fontSize: 11, color: '#9ca3af' } }, 'Returned: ' + fmtDateNumeric(s.returned_date)) : null)))
      : ce('div', { style: { fontSize: 12, color: '#d1d5db', fontStyle: 'italic' } }, 'No sample record')
  );
};

function historyEntryRow(e, i) {
  const isQc = e._type === 'qc'; const isPm = !isQc && !!e.is_permakan; const qty = num(e.quantity); const isNeg = qty < 0;
  let label, c;
  if (isQc) { label = e.is_defect ? 'DEFECT' : 'QC OK'; c = e.is_defect ? '#dc2626' : '#16a34a'; }
  else if (isPm) { label = isNeg ? 'PERMAK OUT' : 'PERMAK IN'; c = isNeg ? '#dc2626' : '#16a34a'; }
  else { label = 'DELIVERY'; c = '#0284c7'; }
  const person = isQc ? e.qc_person : e.checking_pic;
  return ce('div', { key: i, style: { display: 'grid', gridTemplateColumns: '46px 72px 46px 1fr', alignItems: 'center', columnGap: 6, fontSize: 11, marginBottom: 4 } },
    ce('span', { style: { color: '#64748b', fontWeight: 600 } }, fmtDateNumeric(e.event_date) || '—'),
    ce('span', { style: { justifySelf: 'start', background: c + '18', color: c, border: '1px solid ' + c + '40', borderRadius: 10, padding: '0 6px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' } }, label),
    ce('span', { style: { textAlign: 'right', fontWeight: 700, color: c } }, qty > 0 ? '+' + qty : String(qty)),
    ce('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 } },
      person ? ce('span', { style: { background: '#e0e7ff', color: '#4338ca', borderRadius: 10, padding: '0 7px', fontSize: 10, fontWeight: 600 } }, person) : null,
      e.remarks ? ce('span', { style: { color: '#94a3b8', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.remarks) : null));
}

const VariantHistoryPanel = function(props) {
  const entries = props.entries || [];
  return ce('div', { style: { background: props.bg, border: '1px solid ' + props.accent + '22', borderRadius: 8, padding: '8px 10px' } },
    ce('div', { style: { fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: props.accent, marginBottom: 6 } }, props.title),
    entries.length ? entries.map((e, i) => historyEntryRow(e, i)) : ce('div', { style: { fontSize: 11, color: '#94a3b8', fontStyle: 'italic' } }, 'No records yet'));
};

const Section3Quantity = function(props) {
  const sL = useState(true); const loading = sL[0]; const setLoading = sL[1];
  const sD = useState(null); const data = sD[0]; const setData = sD[1];
  const sX = useState({});   const exp = sX[0];   const setExp = sX[1];
  useEffect(function() { setLoading(true); fetchQuantity(props.id).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false)); }, [props.id, props.refreshKey]);
  if (loading) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  if (!data) return null;
  const rows = data.rows, delMap = data.delMap, qcHistMap = data.qcHistMap, perm = data.perm, totDo = data.totDo, totCut = data.totCut, totSent = data.totSent, totQc = data.totQc;
  const sentPerm = num(perm.sent_permakan), returnPerm = num(perm.return_permakan), pendPerm = sentPerm - returnPerm;

  const permakHistory = [];
  Object.keys(delMap || {}).forEach(sid => (delMap[sid] || []).forEach(e => { if (e.is_permakan) permakHistory.push(e); }));
  permakHistory.sort((a, b) => String(a.event_date || '').localeCompare(String(b.event_date || '')));
  let _runOut = 0;
  const permakRows = permakHistory.map(function(e) {
    const qty = num(e.quantity);
    _runOut -= qty;
    return { date: e.event_date, variant: e.variant, qty: qty, out: _runOut };
  });

  function metric(label, value, color) { return ce('div', { style: { flex: '0 0 auto', minWidth: 62, background: '#f9fafb', borderRadius: 10, padding: '8px 12px', textAlign: 'center' } }, ce('div', { style: { fontSize: 9, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' } }, label), ce('div', { style: { fontSize: 18, fontWeight: 700, color: color || '#111827' } }, value)); }
  function arrow(val) { return ce('div', { style: { flex: '0 0 auto', textAlign: 'center', minWidth: 30 } }, ce('div', { style: { fontSize: 12, fontWeight: 700, color: diffColor(val) } }, diffLabel(val)), ce('div', { style: { fontSize: 8, color: '#d1d5db', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'diff')); }
  function metricCard(label, value, valueColor) { return ce('div', { style: { background: '#f9fafb', borderRadius: 8, padding: '7px 9px', display: 'flex', flexDirection: 'column', gap: 1 } }, ce('div', { style: { fontSize: 9, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' } }, label), ce('div', { style: { fontSize: 16, fontWeight: 700, color: valueColor || '#111827' } }, value)); }
  const th = { padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#9ca3af', borderBottom: '2px solid #f3f4f6', textAlign: 'right', whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', fontSize: 12, borderBottom: '1px solid #f3f4f6', textAlign: 'right', color: '#374151' };
  const tdL = Object.assign({}, td, { textAlign: 'left', fontWeight: 600, color: '#111827' });
  const pmTh = { padding: '6px 10px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right', whiteSpace: 'nowrap' };
  const pmTd = { padding: '6px 10px', fontSize: 12, textAlign: 'right', color: '#374151' };
  const pmTdL = Object.assign({}, pmTd, { textAlign: 'left', color: '#64748b' });
  function toggle(sid) { setExp(prev => Object.assign({}, prev, { [sid]: !prev[sid] })); }

  return ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
    ce('div', null, ce('div', { style: secTitle }, 'Quantity summary'),
      ce('div', { style: { display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingBottom: 4 } },
        metric('DO', totDo, '#111827'), arrow(totCut - totDo), metric('Cut', totCut, '#111827'), arrow(totSent - totCut),
        metric('Sent', totSent, doneColor(totSent, totCut)), arrow(totQc - totSent), metric('QC', totQc, doneColor(totQc, totSent)))),
    rows.length > 0 ? ce('div', null, ce('div', { style: secTitle }, 'Quantity by variant'),
      ce('div', { style: { overflowX: 'auto' } },
        ce('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
          ce('thead', null, ce('tr', null,
            ce('th', { style: Object.assign({}, th, { textAlign: 'left', color: '#111827' }) }, 'Variant'),
            ce('th', { style: th }, 'Ratio'), ce('th', { style: th }, 'DO'), ce('th', { style: th }, 'Cut'), ce('th', { style: th }, 'Sent'), ce('th', { style: th }, 'QC'))),
          ce('tbody', null,
            rows.map(function(r, i) {
              const open = !!exp[r.sku_id]; const sentC = doneColor(r.sent, r.cut), qcC = doneColor(r.qc, r.sent);
              const main = ce('tr', { key: 'r' + i, onClick: () => toggle(r.sku_id), style: { background: i % 2 === 0 ? '#fff' : '#fafafa', cursor: 'pointer' } },
                ce('td', { style: tdL }, ce('span', { style: { display: 'inline-block', width: 14, color: '#94a3b8', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s' } }, '›'), ' ' + r.variant),
                ce('td', { style: td }, r.ratio), ce('td', { style: td }, r.do), ce('td', { style: td }, r.cut),
                ce('td', { style: Object.assign({}, td, { color: sentC, fontWeight: 600, background: doneBg(r.sent, r.cut) }) }, r.sent),
                ce('td', { style: Object.assign({}, td, { color: qcC, fontWeight: 600, background: doneBg(r.qc, r.sent) }) }, r.qc));
              if (!open) return main;
              const expanded = ce('tr', { key: 'h' + i }, ce('td', { colSpan: 6, style: { background: '#fafcff', borderBottom: '1px solid #f3f4f6', padding: '8px 10px' } },
                ce('div', { className: 'pd-qexp' },
                  ce(VariantHistoryPanel, { entries: delMap[r.sku_id], title: 'Sent · deliveries', accent: '#0284c7', bg: '#f0f9ff' }),
                  ce(VariantHistoryPanel, { entries: qcHistMap[r.sku_id], title: 'QC results', accent: '#16a34a', bg: '#f0fdf4' }))));
              return [main, expanded];
            })),
          ce('tfoot', null, ce('tr', { style: { background: '#f9fafb' } },
            ce('td', { style: Object.assign({}, tdL, { borderTop: '2px solid #f3f4f6' }) }, 'Total'),
            ce('td', { style: Object.assign({}, td, { borderTop: '2px solid #f3f4f6', color: '#9ca3af', fontWeight: 700 }) }, rows.reduce((s, x) => s + x.ratio, 0)),
            ce('td', { style: Object.assign({}, td, { borderTop: '2px solid #f3f4f6', fontWeight: 700 }) }, totDo),
            ce('td', { style: Object.assign({}, td, { borderTop: '2px solid #f3f4f6', fontWeight: 700 }) }, totCut),
            ce('td', { style: Object.assign({}, td, { borderTop: '2px solid #f3f4f6', fontWeight: 700, color: doneColor(totSent, totCut), background: doneBg(totSent, totCut) }) }, totSent),
            ce('td', { style: Object.assign({}, td, { borderTop: '2px solid #f3f4f6', fontWeight: 700, color: doneColor(totQc, totSent), background: doneBg(totQc, totSent) }) }, totQc)))))) : null,
    ce('div', { className: 'pd-permak' },
      ce('div', null,
        ce('div', { style: secTitle }, 'Permakan'),
        ce('div', { className: 'pd-permak-sum' },
          metricCard('Pending', pendPerm, pendPerm === 0 ? '#22c55e' : '#f97316'),
          metricCard('Sent', sentPerm, '#374151'),
          metricCard('Returned', returnPerm, '#374151'))),
      ce('div', { className: 'pd-permak-hist' },
        ce('div', { style: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af', marginBottom: 12 } }, 'Permakan history'),
        permakRows.length
          ? ce('div', { style: { border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' } },
              ce('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
                ce('thead', null, ce('tr', { style: { background: '#fafafa' } },
                  ce('th', { style: Object.assign({}, pmTh, { textAlign: 'left' }) }, 'Date'),
                  ce('th', { style: Object.assign({}, pmTh, { textAlign: 'left' }) }, 'Variant'),
                  ce('th', { style: pmTh }, 'Qty'),
                  ce('th', { style: pmTh }, 'Still out'))),
                ce('tbody', null, permakRows.map(function(e, i) {
                  const c = e.qty < 0 ? '#dc2626' : '#16a34a';
                  return ce('tr', { key: i, style: { borderTop: '1px solid #f3f4f6' } },
                    ce('td', { style: pmTdL }, fmtDateNumeric(e.date) || '—'),
                    ce('td', { style: Object.assign({}, pmTdL, { color: '#374151' }) }, e.variant || '—'),
                    ce('td', { style: Object.assign({}, pmTd, { color: c, fontWeight: 700 }) }, e.qty > 0 ? '+' + e.qty : String(e.qty)),
                    ce('td', { style: Object.assign({}, pmTd, { color: e.out === 0 ? '#9ca3af' : '#f97316', fontWeight: e.out === 0 ? 400 : 700 }) }, e.out));
                }))))
          : ce('div', { style: { fontSize: 12, color: '#d1d5db', fontStyle: 'italic' } }, 'No permakan records'))
    )
  );
};

// SectionMarker — shows THREE things:
//   1. marker_remarks — free-text notes field on production, specific to markers.
//   2. remarks — the same production.remarks field Section4Remarks shows,
//      surfaced here too per request.
//   3. the actual relational marker breakdown (production_marker → marker →
//      marker_details), with an "Add marker" button that lazy-loads
//      ui_production_addmarker and opens its modal.
// Both text fields and the marker breakdown come from the same reload() call.
// On save, re-fetches locally (updates immediately without waiting on a
// host-level refreshKey bump), and also nudges ctx.resource.refresh() if
// available so other embedding contexts pick up the change too.
const SectionMarker = function(props) {
  const sL = useState(true);  const loading = sL[0];  const setLoading = sL[1];
  const sM = useState([]);    const markers = sM[0];  const setMarkers = sM[1];
  const sMR = useState('');   const markerRemarks = sMR[0]; const setMarkerRemarks = sMR[1];
  const sRM = useState('');   const remarks = sRM[0]; const setRemarks = sRM[1];
  const sB = useState(false); const busy = sB[0];     const setBusy = sB[1];

  function reload() {
    setLoading(true);
    return Promise.all([fetchMarkers(props.id), fetchDetailMeta(props.id)])
      .then(function(r) {
        setMarkers(r[0] || []);
        setMarkerRemarks((r[1] && r[1].marker_remarks) || '');
        setRemarks((r[1] && r[1].remarks) || '');
        setLoading(false);
      })
      .catch(function() { setLoading(false); });
  }
  useEffect(function() { reload(); }, [props.id, props.refreshKey]);

  async function handleAddMarker() {
    if (busy || props.id == null) return;
    setBusy(true);
    const hideLoading = ctx.message.loading('Opening marker…', 0);
    try {
      const PM = await loadCode('ui_production_addmarker');
      if (!PM || !PM.openModal) {
        ctx.message.error('Marker module loaded but openModal was not found.');
        return;
      }
      await PM.openModal({
        ctx: ctx,
        productionId: props.id,
        onSaved: function() {
          reload();
          try { if (ctx.resource && ctx.resource.refresh) ctx.resource.refresh(); } catch (e) {}
        },
      });
    } catch (e) {
      ctx.message.error('Failed to load marker: ' + ((e && e.message) || e));
    } finally {
      hideLoading();
      setBusy(false);
    }
  }

  const addBtn = ce('button', {
    onClick: handleAddMarker, disabled: busy,
    style: { fontSize: 11, fontWeight: 600, color: '#4338ca', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 6, padding: '4px 10px', cursor: busy ? 'default' : 'pointer', marginBottom: 10 },
  }, busy ? 'Loading…' : '+ Add marker');
  const subTitle = t => ce('div', { style: { fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' } }, t);

  if (loading) {
    return ce('div', null, addBtn, ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…'));
  }

  const markerNotesBlock = ce('div', { style: { marginBottom: 16 } },
    subTitle('Marker Notes'),
    htmlIsEmpty(markerRemarks)
      ? ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No marker notes')
      : ce('div', { className: 'pd-remarks', dangerouslySetInnerHTML: { __html: markerRemarks } })
  );

  const remarksBlock = ce('div', { style: { marginBottom: 16 } },
    subTitle('Remarks'),
    htmlIsEmpty(remarks)
      ? ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No remarks')
      : ce('div', { className: 'pd-remarks', dangerouslySetInnerHTML: { __html: remarks } })
  );

  const markerListBlock = ce('div', null,
    subTitle('Markers'),
    addBtn,
    !markers.length
      ? ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No marker')
      : ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          markers.map(function(mk, i) {
            const sizesText = mk.sizes.map(function(s) { return s.display + ':' + s.quantity; }).join('  ');
            return ce('div', { key: mk.id != null ? mk.id : i, style: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, borderRadius: 6, background: '#fafafa', border: '1px solid #f0f0f0', padding: '6px 10px' } },
              ce('span', { style: { fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' } }, (mk.length != null ? mk.length : '—') + 'cm'),
              ce('span', { style: { color: '#8c8c8c' } }, sizesText || '—'));
          })
        )
  );

  return ce('div', null, markerNotesBlock, remarksBlock, markerListBlock);
};

const Section4Remarks = function(props) {
  const sL = useState(true); const loading = sL[0]; const setLoading = sL[1];
  const sR = useState('');   const remarks = sR[0]; const setRemarks = sR[1];
  useEffect(function() { setLoading(true); fetchDetailMeta(props.id).then(m => { setRemarks(m.remarks || ''); setLoading(false); }).catch(() => setLoading(false)); }, [props.id, props.refreshKey]);
  if (loading) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  if (htmlIsEmpty(remarks)) return ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No remarks');
  return ce('div', { className: 'pd-remarks', dangerouslySetInnerHTML: { __html: remarks } });
};
const SRC = { production: { label: 'Production', color: '#64748b' }, production_sample: { label: 'Sample', color: '#6366f1' }, production_material: { label: 'Material', color: '#0891b2' } };
const Section5History = function(props) {
  const sL = useState(true); const loading = sL[0]; const setLoading = sL[1];
  const sH = useState([]);   const rows = sH[0];    const setRows = sH[1];
  useEffect(function() { setLoading(true); fetchHistory(props.id).then(r => { setRows(r); setLoading(false); }).catch(() => setLoading(false)); }, [props.id, props.refreshKey]);
  if (loading) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  if (!rows.length) return ce('div', { style: { color: '#d1d5db', fontSize: 12 } }, 'No history');
  function tag(text, color) { return ce('span', { style: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: color, background: color + '1a', border: '1px solid ' + color + '40', borderRadius: 10, padding: '0 6px', whiteSpace: 'nowrap' } }, text); }
  return ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
    rows.map(function(row, i) {
      const src = SRC[row.source] || { label: row.source || '', color: '#94a3b8' };
      const cat = (row.category != null && String(row.category).trim() !== '') ? String(row.category) : '';
      return ce('div', { key: i, style: { borderLeft: '2px solid #e2e8f0', padding: '3px 0 3px 7px' } },
        ce('div', { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 1 } }, ce('span', { style: { fontSize: 11, fontWeight: 700, color: '#1e293b' } }, row.name || '—'), tag(src.label, src.color), cat ? tag(cat, '#475569') : null),
        ce('span', { style: { fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 2 } }, fmtDateTime(row.history_date) + ' - ' + (row.status || '')),
        ce('div', { style: { fontSize: 11, color: '#374151', lineHeight: 1.5, wordBreak: 'break-word' } }, row.message || ''));
    })
  );
};

// ── accordion shell ──
const AccordionItem = function(props) {
  return ce('div', { style: { borderTop: '1px solid #f1f5f9' } },
    ce('div', { onClick: props.onToggle, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 4px', cursor: 'pointer', userSelect: 'none' } },
      ce('span', { style: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: props.open ? '#0f172a' : '#64748b' } }, props.title),
      ce('span', { style: { display: 'inline-block', color: '#94a3b8', fontSize: 18, transform: props.open ? 'rotate(90deg)' : 'none', transition: 'transform .2s' } }, '›')),
    props.open ? ce('div', { style: { padding: '0 4px 18px' } }, props.children) : null
  );
};

// =====================================================
// DetailBody — accordion only; self-fetches header + image. No outer chrome.
// =====================================================
const DetailBody = function(props) {
  const id = props.productionId;
  const rk = props.refreshKey;
  const sH = useState(null); const header = sH[0]; const setHeader = sH[1];
  const sI = useState('');   const image = sI[0];  const setImage = sI[1];
  const sO = useState(0);    const openIdx = sO[0]; const setOpenIdx = sO[1];

  useEffect(function() { setOpenIdx(0); }, [id]);
  useEffect(function() {
    let alive = true;
    setHeader(null); setImage('');
    if (id == null) return;
    fetchHeader(id).then(function(hd) {
      if (!alive) return;
      setHeader(hd);
      fetchProductImage(hd.product_code).then(function(u) { if (alive) setImage(u); });
    }).catch(function() {});
    return function() { alive = false; };
  }, [id, rk]);

  function toggle(i) { setOpenIdx(openIdx === i ? -1 : i); }
  const sections = [
    { title: 'Summary',  body: ce(Section1Summary, { header: header, image: image }) },
    { title: 'Material', body: ce(Section2Material, { id: id, refreshKey: rk, onOpenMaterial: props.onOpenMaterial }) },
    { title: 'Quantity', body: ce(Section3Quantity, { id: id, refreshKey: rk }) },
    { title: 'Remarks',  body: ce(Section4Remarks,  { id: id, refreshKey: rk }) },
    { title: 'Marker',   body: ce(SectionMarker,    { id: id, refreshKey: rk }) },
    { title: 'History',  body: ce(Section5History,  { id: id, refreshKey: rk }) },
  ];
  return ce('div', null,
    ce(DetailStyles, null),
    sections.map((s, i) => ce(AccordionItem, { key: i, title: s.title, open: openIdx === i, onToggle: () => toggle(i) }, s.body)));
};

// =====================================================
// ProductionDetailDrawer — standalone handoff drawer (title + accent + chrome).
// Self-fetches a light header for title/accent; DetailBody fetches the rest.
// =====================================================
const ProductionDetailDrawer = function(props) {
  const id = props.productionId;
  const sH = useState(null); const header = sH[0]; const setHeader = sH[1];
  useEffect(function() {
    if (!props.open || id == null) { return; }
    let alive = true;
    setHeader(null);
    fetchHeader(id).then(h => { if (alive) setHeader(h); }).catch(() => {});
    return function() { alive = false; };
  }, [props.open, id, props.refreshKey]);

  const iconBtn = { border: '1px solid #e2e8f0', background: '#fff', borderRadius: 8, height: 30, padding: '0 10px', fontSize: 13, color: '#475569', cursor: 'pointer' };
  const accent = sColor(header && header.status);
  const overflowMenu = {
    items: [{ key: 'delete', danger: true, label: '🗑  Delete production' }],
    onClick: function(e) { if (e.key === 'delete' && props.onDelete) props.onDelete(id); },
  };

  return ce(Drawer, {
    open: !!props.open, placement: 'right', rootClassName: 'pd-detail-drawer',
    zIndex: props.zIndex || 1050,
    title: header ? (header.production_ref || ('#' + id)) : '',
    onClose: props.onClose,
    extra: (props.open && id != null) ? ce('div', { style: { display: 'flex', gap: 6 } },
      props.onEdit ? ce('button', { onClick: () => props.onEdit(id), style: Object.assign({}, iconBtn, { fontWeight: 600, color: '#4f46e5', borderColor: '#c7d2fe', background: '#eef2ff' }) }, '✏️ Edit') : null,
      ce(Dropdown, { menu: overflowMenu, trigger: ['click'], placement: 'bottomRight' },
        ce('button', { style: Object.assign({}, iconBtn, { width: 34, padding: 0, fontSize: 16 }) }, '⋯'))
    ) : null,
  },
    (props.open && id != null) ? ce('div', { style: { fontFamily: "'Segoe UI', sans-serif" } },
      ce(DetailStyles, null),
      ce('div', { style: { height: 4, borderRadius: 999, background: accent, marginBottom: 6, opacity: 0.85 } }),
      ce(DetailBody, { productionId: id, refreshKey: props.refreshKey, onOpenMaterial: props.onOpenMaterial }),
      ce('div', { style: { height: 120 } })
    ) : null
  );
};

return { DetailBody, ProductionDetailDrawer, DetailStyles };
