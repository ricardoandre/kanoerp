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
// 2026-07 MIGRATION: every data-layer function moved off raw ctx.sql onto
// ctx.api.resource() (fetchAllPages/fetchByIn) — ctx.sql is admin/root-gated
// and silently fails for non-admin roles (README §3). This was the shared
// detail view for BOTH the list-engine popup (view_production.js) and the
// native record popup (act_production_view) — non-admin users opening
// EITHER entry point would have seen a mostly-empty detail. All rendering
// logic (the Section* components, DetailBody, ProductionDetailDrawer) is
// UNCHANGED — only the data-fetching functions above them were rewritten.
//
// FIX (marker_remarks): fetchDetailMeta selected a `marker` column that does
// not exist — the real column is `marker_remarks` (same bug already fixed in
// ui_production_edit.js and ui_production_addmarker.js).
//
// FIX (product image): fetchProductImage used to manually introspect the
// `fields` meta-collection to find product.image's junction table — same
// admin-gating problem as a getRels()-style lookup, just for an attachment
// relation instead of a belongsTo. Replaced with `appends: ['image']`, the
// same proven pattern already used in view_production.js's
// fetchProductImages.
//
// Depends on: none.
//
// NOTE: status colors live HERE (the detail is now self-contained); each list
// view still keeps its own card status colors. Slight duplication is intended
// per the "status stays in the view" philosophy — the detail simply owns its.
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
  return fetchAllPages('production', {
    filter: { id: id },
    appends: ['product_code', 'konveksi'],
    pageSize: 1,
  }).then(function (rows) {
    const p = rows[0];
    if (!p) return {};
    const product = p.product_code || {};
    const konveksi = p.konveksi || {};
    return {
      id: p.id, production_ref: p.production_ref, status: p.status, is_new: p.is_new,
      est_production_start: p.est_production_start, est_production_finish: p.est_production_finish,
      product_code: product.code, product_name: product.name, konveksi_name: konveksi.name,
    };
  });
}

// image via appends:['image'] — same proven pattern as view_production.js's
// fetchProductImages, instead of introspecting the `fields` meta-collection
// (admin-gated, same problem class as a getRels()-style lookup).
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

// marker_remarks — NOT `marker` (that column doesn't exist; see FIX note at
// top of file).
function fetchDetailMeta(id) {
  return fetchAllPages('production', { filter: { id: id }, fields: ['remarks', 'marker_remarks', 'planning_rol', 'brand'], pageSize: 1 })
    .then(function (rows) { return rows[0] || {}; });
}

function fetchMaterial(id) {
  return Promise.all([
    fetchAllPages('production', { filter: { id: id }, fields: ['planning_rol'], pageSize: 1 }),
    fetchAllPages('production_material', {
      filter: { fk_production_id: id },
      fields: ['id', 'fk_material_details_code', 'status', 'shipment_date', 'quantity_need'],
      appends: ['material_details'],
    }),
    fetchAllPages('production_sample', { filter: { fk_production_id: id }, fields: ['fk_sample_product_code', 'status', 'shipment_date', 'returned_date'] }),
    fetchAllPages('production_quantity_details', { filter: { fk_production_id: id }, fields: ['quantity'] }),
  ]).then(function (r) {
    const planningRol = num(r[0][0] && r[0][0].planning_rol);
    const pmRows = r[1] || [];
    const samples = r[2] || [];
    const totalDo = (r[3] || []).reduce(function (s, x) { return s + num(x.quantity); }, 0);

    const materialCodes = uniqVals(pmRows.map(m => m.fk_material_details_code));
    return fetchByIn('material_details', 'code', materialCodes, { fields: ['code', 'fk_material_code'] }).then(function (mdRows) {
      const mdByCode = {}; mdRows.forEach(m => { mdByCode[m.code] = m; });
      const rawCodes = uniqVals(mdRows.map(m => m.fk_material_code));
      return fetchByIn('raw_material', 'code', rawCodes, { fields: ['code', 'type', 'default_content'] }).then(function (rmRows) {
        const rmByCode = {}; rmRows.forEach(rm => { rmByCode[rm.code] = rm; });

        const materialRows = pmRows.map(function (m) {
          const md = m.material_details || mdByCode[m.fk_material_details_code] || {};
          const rmResolved = rmByCode[md.fk_material_code] || {};
          return {
            id: m.id, material_code: m.fk_material_details_code, status: m.status, shipment_date: m.shipment_date, quantity_need: m.quantity_need,
            material_type: rmResolved.type, default_content: rmResolved.default_content,
          };
        });
        const fabrics = materialRows.filter(m => String(m.material_type || '').toLowerCase() === 'fabric');
        const accs = materialRows.filter(m => String(m.material_type || '').toLowerCase() !== 'fabric');

        const allMatIds = materialRows.map(m => m.id);
        return fetchByIn('material_ledger', 'fk_production_material_id', allMatIds, { fields: ['id', 'fk_production_material_id'] }).then(function (ledgerRows) {
          const ledgerIdsByMatId = {};
          ledgerRows.forEach(function (l) {
            const key = String(l.fk_production_material_id);
            (ledgerIdsByMatId[key] = ledgerIdsByMatId[key] || []).push(l.id);
          });
          const allLedgerIds = ledgerRows.map(l => l.id);
          return fetchByIn('material_ledger_details', 'fk_material_ledger_id', allLedgerIds, { fields: ['fk_material_ledger_id', 'details'] }).then(function (detailRows) {
            const detailsByLedgerId = {};
            detailRows.forEach(function (d) {
              const key = String(d.fk_material_ledger_id);
              (detailsByLedgerId[key] = detailsByLedgerId[key] || []).push(d.details);
            });
            function withDetails(rows) {
              return rows.map(function (m) {
                const ledgerIds = ledgerIdsByMatId[String(m.id)] || [];
                const details = [];
                ledgerIds.forEach(function (lid) { (detailsByLedgerId[String(lid)] || []).forEach(function (d) { details.push(d); }); });
                return Object.assign({}, m, { details: details });
              });
            }
            return { fabrics: withDetails(fabrics), accessories: withDetails(accs), samples: samples, totalDo: totalDo, planningRol: planningRol };
          });
        });
      });
    });
  });
}

function fetchQuantity(id) {
  return Promise.all([
    fetchAllPages('production_quantity_details', { filter: { fk_production_id: id }, fields: ['fk_sku_option_id', 'ratio', 'quantity', 'cut_quantity'], appends: ['sku_option'] }),
    fetchAllPages('production_result', { filter: { fk_production_id: id }, fields: ['fk_sku_option_id', 'quantity'] }),
    fetchAllPages('qc_result', { filter: { fk_production_id: id }, fields: ['fk_sku_option_id', 'quantity'] }),
    fetchAllPages('production_result', { filter: { fk_production_id: id, is_permakan: true }, fields: ['quantity'] }),
    fetchAllPages('production_result', { filter: { fk_production_id: id }, fields: ['shipment_date', 'checking_pic', 'quantity', 'is_permakan', 'remarks', 'fk_sku_option_id'], appends: ['sku_option'] }),
    fetchAllPages('qc_result', { filter: { fk_production_id: id }, fields: ['qc_date', 'qc_person', 'is_defect', 'quantity', 'fk_sku_option_id'], appends: ['sku_option'] }),
  ]).then(function (r) {
    const base = r[0], sentR = r[1], qcR = r[2], permR = r[3], histDelRaw = r[4], histQcRaw = r[5];
    const sentMap = {}, qcMap = {};
    sentR.forEach(x => { const k = String(x.fk_sku_option_id); sentMap[k] = (sentMap[k] || 0) + num(x.quantity); });
    qcR.forEach(x => { const k = String(x.fk_sku_option_id); qcMap[k] = (qcMap[k] || 0) + num(x.quantity); });
    const sortedBase = base.slice().sort(function (a, b) { return ((a.sku_option && a.sku_option.sort) || 0) - ((b.sku_option && b.sku_option.sort) || 0); });
    const rows = sortedBase.map(function (b) {
      const sid = String(b.fk_sku_option_id);
      return { sku_id: sid, variant: (b.sku_option && b.sku_option.display) || '(none)', ratio: num(b.ratio), do: num(b.quantity), cut: num(b.cut_quantity), sent: sentMap[sid] || 0, qc: qcMap[sid] || 0 };
    });

    const sentPermakan = permR.reduce(function (s, x) { const q = num(x.quantity); return s + (q < 0 ? -q : 0); }, 0);
    const returnPermakan = permR.reduce(function (s, x) { const q = num(x.quantity); return s + (q > 0 ? q : 0); }, 0);

    const histDel = histDelRaw.map(function (x) { return { event_date: x.shipment_date, checking_pic: x.checking_pic, quantity: x.quantity, is_permakan: x.is_permakan, remarks: x.remarks, fk_sku_option_id: x.fk_sku_option_id, variant: (x.sku_option && x.sku_option.display) }; });
    const histQc = histQcRaw.map(function (x) { return { event_date: x.qc_date, qc_person: x.qc_person, is_defect: x.is_defect, quantity: x.quantity, fk_sku_option_id: x.fk_sku_option_id, variant: (x.sku_option && x.sku_option.display) }; });
    const delMap = {}, qcHistMap = {};
    histDel.forEach(e => { const sid = String(e.fk_sku_option_id); (delMap[sid] = delMap[sid] || []).push(Object.assign({}, e, { _type: 'delivery' })); });
    histQc.forEach(e => { const sid = String(e.fk_sku_option_id); (qcHistMap[sid] = qcHistMap[sid] || []).push(Object.assign({}, e, { _type: 'qc' })); });

    return {
      rows, delMap, qcHistMap, perm: { sent_permakan: sentPermakan, return_permakan: returnPermakan },
      totDo: rows.reduce((s, x) => s + x.do, 0), totCut: rows.reduce((s, x) => s + x.cut, 0),
      totSent: rows.reduce((s, x) => s + x.sent, 0), totQc: rows.reduce((s, x) => s + x.qc, 0),
    };
  });
}

// enum label resolver (single-select fields: checking_pic, qc_person) — show
// label, not value. Unrelated to the `fields` meta-collection REST endpoint —
// this is ctx.dataSourceManager, the documented-safe introspection API
// (README §4) — left unchanged.
function pdEnumLabelMap(collectionName, fieldName) {
  try {
    const ds = ctx.dataSourceManager.getDataSource('main');
    const col = ds && ds.getCollection(collectionName);
    const field = col && col.getField(fieldName);
    const opts = (field && field.enum) || [];
    const map = {};
    opts.forEach(function(o) { if (o && typeof o === 'object' && o.value != null) map[String(o.value)] = (o.label != null ? o.label : o.value); });
    return map;
  } catch (e) { return {}; }
}
const _pdPicLabels = pdEnumLabelMap('production_result', 'checking_pic');
const _pdQcLabels = pdEnumLabelMap('qc_result', 'qc_person');
function pdLabel(map, v) { if (v == null || v === '') return ''; const k = String(v); return map[k] != null ? map[k] : v; }

// result history: production_result (Sent) + qc_result (QC), all variants, date desc.
function fetchResultHistory(id) {
  return Promise.all([
    fetchAllPages('production_result', { filter: { fk_production_id: id }, fields: ['shipment_date', 'quantity', 'checking_pic', 'is_permakan', 'remarks'], appends: ['sku_option'] }),
    fetchAllPages('qc_result', { filter: { fk_production_id: id }, fields: ['qc_date', 'quantity', 'qc_person', 'is_defect'], appends: ['sku_option'] }),
  ]).then(function(r) {
    const sent = (r[0] || []).map(function(x) { return { kind: 'sent', date: x.shipment_date, quantity: num(x.quantity), pic: pdLabel(_pdPicLabels, x.checking_pic), is_permakan: !!x.is_permakan, is_defect: false, variant: x.sku_option && x.sku_option.display, remarks: x.remarks }; });
    const qc = (r[1] || []).map(function(x) { return { kind: 'qc', date: x.qc_date, quantity: num(x.quantity), pic: pdLabel(_pdQcLabels, x.qc_person), is_permakan: false, is_defect: !!x.is_defect, variant: x.sku_option && x.sku_option.display }; });
    const all = sent.concat(qc);
    all.sort(function(a, b) { const av = a.date ? new Date(a.date).getTime() : 0; const bv = b.date ? new Date(b.date).getTime() : 0; return bv - av; });
    return all;
  });
}

// history entries can belong to production directly, or to a
// production_sample / production_material that belongs to this production —
// three separate queries (can't OR-across-different-field-values in one
// resource filter), merged + sorted + capped client-side.
function fetchHistory(id) {
  return Promise.all([
    fetchAllPages('production_sample', { filter: { fk_production_id: id }, fields: ['id'] }),
    fetchAllPages('production_material', { filter: { fk_production_id: id }, fields: ['id'] }),
  ]).then(function (r) {
    const sampleIds = r[0].map(x => x.id);
    const materialIds = r[1].map(x => x.id);
    const histFields = ['create_date', 'status', 'message', 'category', 'table_name'];
    const queries = [
      fetchAllPages('history', { filter: { table_name: 'production', table_id: id }, fields: histFields, appends: ['user'], sort: ['-create_date'] }),
    ];
    if (sampleIds.length) queries.push(fetchByIn('history', 'table_id', sampleIds, { filter: { table_name: 'production_sample' }, fields: histFields, appends: ['user'] }));
    if (materialIds.length) queries.push(fetchByIn('history', 'table_id', materialIds, { filter: { table_name: 'production_material' }, fields: histFields, appends: ['user'] }));
    return Promise.all(queries).then(function (results) {
      let all = [];
      results.forEach(function (rows) { all = all.concat(rows); });
      all.sort(function (a, b) { return new Date(b.create_date).getTime() - new Date(a.create_date).getTime(); });
      return all.slice(0, 30).map(function (row) {
        return { name: row.user && row.user.nickname, history_date: row.create_date, status: row.status, message: row.message, category: row.category, source: row.table_name };
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

// =====================================================
// SectionResultHistory — combined production_result (Sent) + qc_result (QC),
// all variants merged, chronological DESC. Columns: Date · Sent · QC · Details.
// =====================================================
const SectionResultHistory = function(props) {
  const sL = useState(true); const loading = sL[0]; const setLoading = sL[1];
  const sD = useState([]);   const rows = sD[0];    const setRows = sD[1];
  useEffect(function() { setLoading(true); fetchResultHistory(props.id).then(function(d) { setRows(d); setLoading(false); }).catch(function() { setLoading(false); }); }, [props.id, props.refreshKey]);
  if (loading) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  if (!rows.length) return ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No result history');

  const rhTh = { padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#9ca3af', borderBottom: '2px solid #f3f4f6', whiteSpace: 'nowrap' };
  const rhThR = Object.assign({}, rhTh, { textAlign: 'right' });
  const rhTd = { padding: '7px 10px', fontSize: 12, borderBottom: '1px solid #f3f4f6', color: '#374151', verticalAlign: 'top' };
  const rhTdR = Object.assign({}, rhTd, { textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' });
  function tag(text, color) { return ce('span', { style: { background: color + '18', color: color, border: '1px solid ' + color + '40', borderRadius: 10, padding: '0 7px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' } }, text); }

  return ce('div', { style: { overflowX: 'auto' } },
    ce('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
      ce('thead', null, ce('tr', null,
        ce('th', { style: Object.assign({}, rhTh, { textAlign: 'left' }) }, 'Date'),
        ce('th', { style: rhThR }, 'Sent'),
        ce('th', { style: rhThR }, 'QC'),
        ce('th', { style: Object.assign({}, rhTh, { textAlign: 'left' }) }, 'Details'))),
      ce('tbody', null, rows.map(function(e, i) {
        const isSent = e.kind === 'sent';
        const sentColor = e.quantity < 0 ? '#dc2626' : '#0284c7';
        const qcColor = e.is_defect ? '#dc2626' : '#16a34a';
        return ce('tr', { key: i, style: { background: i % 2 === 0 ? '#fff' : '#fafafa' } },
          ce('td', { style: Object.assign({}, rhTd, { fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }) }, fmtDateNumeric(e.date) || '—'),
          ce('td', { style: Object.assign({}, rhTdR, { color: isSent ? sentColor : '#e5e7eb' }) }, isSent ? (e.quantity > 0 ? '+' + e.quantity : String(e.quantity)) : '—'),
          ce('td', { style: Object.assign({}, rhTdR, { color: !isSent ? qcColor : '#e5e7eb' }) }, !isSent ? String(e.quantity) : '—'),
          ce('td', { style: Object.assign({}, rhTd, { textAlign: 'left' }) },
            ce('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
              e.variant ? ce('span', { style: { background: '#eef2ff', color: '#4338ca', borderRadius: 4, padding: '0 7px', fontSize: 10, fontWeight: 600 } }, e.variant) : null,
              e.pic ? ce('span', { style: { background: '#e0e7ff', color: '#4338ca', borderRadius: 10, padding: '0 7px', fontSize: 10, fontWeight: 600 } }, '👤 ' + e.pic) : null,
              (isSent && e.is_permakan) ? tag(e.quantity < 0 ? 'PERMAK OUT' : 'PERMAK IN', e.quantity < 0 ? '#dc2626' : '#16a34a') : null,
              (!isSent && e.is_defect) ? tag('DEFECT', '#dc2626') : null)));
      }))));
};

const SectionMarker = function(props) {
  const sL = useState(true);  const loading = sL[0]; const setLoading = sL[1];
  const sM = useState('');    const marker = sM[0];  const setMarker = sM[1];
  useEffect(function() { setLoading(true); fetchDetailMeta(props.id).then(m => { setMarker(m.marker_remarks || ''); setLoading(false); }).catch(() => setLoading(false)); }, [props.id, props.refreshKey]);
  if (loading) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  if (htmlIsEmpty(marker)) return ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No marker');
  return ce('div', { className: 'pd-remarks', dangerouslySetInnerHTML: { __html: marker } });
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
    { title: 'Result history', body: ce(SectionResultHistory, { id: id, refreshKey: rk }) },
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
