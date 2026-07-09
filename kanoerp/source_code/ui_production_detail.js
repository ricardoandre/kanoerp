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
// NOTE (2026-07): all raw ctx.sql usage (loadCode + every fetch* function)
// converted to ctx.api.resource() — ctx.sql.save() is admin/root-gated and
// silently fails per-record for non-admin roles (see README §3). Do not
// revert to raw SQL. fetchProductImage uses appends:['image'] instead of
// introspecting the `fields` metadata table by hand. fetchMaterial's ledger
// lookups are now batched via {$in:[...]} instead of a Promise.all-per-row
// loop, which also removes a concurrent-ctx.sql-uid collision risk (§3) —
// moot now since ctx.api.resource doesn't use that uid mechanism, but noted
// in case this pattern gets copied elsewhere. fetchHistory assumes a
// `history` collection with fk_user_id — verify against the schema dump
// (§4.1) since this wasn't independently confirmed.
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
  return ctx.api.resource('source_code').list({
    filter: { name: name },
    fields: ['code'],
    pageSize: 1,
  }).then(function (res) {
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
  return ctx.api.resource('production').get({
    filterByTk: id,
    fields: ['id', 'production_ref', 'status', 'is_new', 'est_production_start', 'est_production_finish', 'fk_product_code', 'fk_konveksi_code'],
  }).then(function (prodRes) {
    const prod = prodRes && prodRes.data && prodRes.data.data;
    if (!prod) return {};

    return Promise.all([
      prod.fk_product_code ? ctx.api.resource('product').get({ filterByTk: prod.fk_product_code, fields: ['code', 'name'] }).catch(() => null) : Promise.resolve(null),
      prod.fk_konveksi_code ? ctx.api.resource('konveksi').get({ filterByTk: prod.fk_konveksi_code, fields: ['name'] }).catch(() => null) : Promise.resolve(null),
    ]).then(function (r) {
      const product = (r[0] && r[0].data && r[0].data.data) || {};
      const konveksi = (r[1] && r[1].data && r[1].data.data) || {};
      return {
        id: prod.id,
        production_ref: prod.production_ref,
        status: prod.status,
        is_new: prod.is_new,
        est_production_start: prod.est_production_start,
        est_production_finish: prod.est_production_finish,
        product_code: product.code,
        product_name: product.name,
        konveksi_name: konveksi.name,
      };
    });
  }).catch(() => ({}));
}

// image: attachment fields aren't SQL columns. Uses appends (README §4's
// documented path) instead of introspecting `fields` metadata by hand.
function fetchProductImage(productCode) {
  if (!productCode) return Promise.resolve('');
  return ctx.api.resource('product').get({
    filterByTk: productCode,
    appends: ['image'],
  }).then(function (res) {
    const product = res && res.data && res.data.data;
    const img = product && product.image;
    const imgRow = Array.isArray(img) ? img[0] : img;
    if (!imgRow) return '';
    return imgRow.url || (imgRow.filename ? '/storage/uploads/' + imgRow.filename : '');
  }).catch(() => '');
}

function fetchDetailMeta(id) {
  return ctx.api.resource('production').get({
    filterByTk: id,
    fields: ['remarks', 'marker', 'planning_rol', 'brand'],
  }).then(res => (res && res.data && res.data.data) || {}).catch(() => ({}));
}

function fetchMaterial(id) {
  return ctx.api.resource('production').get({ filterByTk: id, fields: ['planning_rol'] })
    .then(res => num(res && res.data && res.data.data && res.data.data.planning_rol))
    .then(function (planningRol) {

      return ctx.api.resource('production_material').list({
        filter: { fk_production_id: id },
        fields: ['id', 'fk_material_details_code', 'status', 'shipment_date', 'quantity_need'],
        pageSize: 500,
      }).then(function (pmRes) {
        const pmRows = (pmRes && pmRes.data && pmRes.data.data) || [];

        const materialCodes = [...new Set(pmRows.map(m => m.fk_material_details_code).filter(Boolean))];
        const mdP = materialCodes.length
          ? ctx.api.resource('material_details').list({ filter: { code: { $in: materialCodes } }, fields: ['code', 'fk_material_code'], pageSize: 500 })
              .then(res => (res && res.data && res.data.data) || [])
          : Promise.resolve([]);

        return mdP.then(function (mdRows) {
          const mdByCode = {}; mdRows.forEach(m => { mdByCode[m.code] = m; });

          const rawCodes = [...new Set(mdRows.map(m => m.fk_material_code).filter(Boolean))];
          const rmP = rawCodes.length
            ? ctx.api.resource('raw_material').list({ filter: { code: { $in: rawCodes } }, fields: ['code', 'type', 'default_content'], pageSize: 500 })
                .then(res => (res && res.data && res.data.data) || [])
            : Promise.resolve([]);

          return rmP.then(function (rmRows) {
            const rmByCode = {}; rmRows.forEach(r => { rmByCode[r.code] = r; });

            // Original used INNER JOINs (material_details, raw_material) — a
            // pm row that doesn't fully resolve is dropped, same behavior.
            const materialRows = pmRows.map(function (m) {
              const md = mdByCode[m.fk_material_details_code];
              if (!md) return null;
              const rm = rmByCode[md.fk_material_code];
              if (!rm) return null;
              return {
                id: m.id,
                material_code: m.fk_material_details_code,
                status: m.status,
                shipment_date: m.shipment_date,
                quantity_need: m.quantity_need,
                material_type: rm.type,
                default_content: rm.default_content,
              };
            }).filter(Boolean);

            const samplesP = ctx.api.resource('production_sample').list({
              filter: { fk_production_id: id },
              fields: ['fk_sample_product_code', 'status', 'shipment_date', 'returned_date'],
              pageSize: 200,
            }).then(res => (res && res.data && res.data.data) || []);

            const totalDoP = ctx.api.resource('production_quantity_details').list({
              filter: { fk_production_id: id },
              fields: ['quantity'],
              pageSize: 1000,
            }).then(res => ((res && res.data && res.data.data) || []).reduce((s, r) => s + (Number(r.quantity) || 0), 0));

            const allPmIds = materialRows.map(m => m.id);
            const ledgerP = allPmIds.length
              ? ctx.api.resource('material_ledger').list({
                  filter: { fk_production_material_id: { $in: allPmIds } },
                  fields: ['id', 'fk_production_material_id'],
                  pageSize: 1000,
                }).then(res => (res && res.data && res.data.data) || [])
              : Promise.resolve([]);

            return Promise.all([samplesP, totalDoP, ledgerP]).then(function (r2) {
              const samples = r2[0], totalDo = r2[1], ledgerRows = r2[2];

              const ledgerIdsByPm = {};
              ledgerRows.forEach(function (l) {
                const key = String(l.fk_production_material_id);
                (ledgerIdsByPm[key] = ledgerIdsByPm[key] || []).push(l.id);
              });

              const allLedgerIds = ledgerRows.map(l => l.id).filter(Boolean);
              const ledgerDetailP = allLedgerIds.length
                ? ctx.api.resource('material_ledger_details').list({
                    filter: { fk_material_ledger_id: { $in: allLedgerIds } },
                    fields: ['details', 'fk_material_ledger_id'],
                    pageSize: 2000,
                  }).then(res => (res && res.data && res.data.data) || [])
                : Promise.resolve([]);

              return ledgerDetailP.then(function (ledgerDetailRows) {
                const detailsByLedgerId = {};
                ledgerDetailRows.forEach(function (d) {
                  const key = String(d.fk_material_ledger_id);
                  (detailsByLedgerId[key] = detailsByLedgerId[key] || []).push(d.details);
                });

                function detailsForPm(pmId) {
                  const lIds = ledgerIdsByPm[String(pmId)] || [];
                  let out = [];
                  lIds.forEach(function (lid) { out = out.concat(detailsByLedgerId[String(lid)] || []); });
                  return out;
                }

                const fabrics = materialRows.filter(m => String(m.material_type || '').toLowerCase() === 'fabric')
                  .map(m => Object.assign({}, m, { details: detailsForPm(m.id) }));
                const accessories = materialRows.filter(m => String(m.material_type || '').toLowerCase() !== 'fabric')
                  .map(m => Object.assign({}, m, { details: detailsForPm(m.id) }));

                return { fabrics: fabrics, accessories: accessories, samples: samples, totalDo: totalDo, planningRol: planningRol };
              });
            });
          });
        });
      });
    });
}

function fetchQuantity(id) {
  const pqdP = ctx.api.resource('production_quantity_details').list({
    filter: { fk_production_id: id },
    fields: ['id', 'ratio', 'quantity', 'cut_quantity', 'fk_sku_option_id'],
    pageSize: 500,
  }).then(res => (res && res.data && res.data.data) || []);

  const prP = ctx.api.resource('production_result').list({
    filter: { fk_production_id: id },
    fields: ['id', 'shipment_date', 'quantity', 'is_permakan', 'checking_pic', 'remarks', 'fk_sku_option_id'],
    pageSize: 2000,
  }).then(res => (res && res.data && res.data.data) || []);

  const qcP = ctx.api.resource('qc_result').list({
    filter: { fk_production_id: id },
    fields: ['id', 'qc_date', 'quantity', 'is_defect', 'qc_person', 'fk_sku_option_id'],
    pageSize: 2000,
  }).then(res => (res && res.data && res.data.data) || []);

  return Promise.all([pqdP, prP, qcP]).then(function (r) {
    const pqdRows = r[0], prRows = r[1], qcRows = r[2];

    const skuIds = [...new Set(
      pqdRows.map(x => x.fk_sku_option_id)
        .concat(prRows.map(x => x.fk_sku_option_id))
        .concat(qcRows.map(x => x.fk_sku_option_id))
        .filter(x => x != null)
    )];

    const skuP = skuIds.length
      ? ctx.api.resource('sku_option').list({ filter: { id: { $in: skuIds } }, fields: ['id', 'display', 'sort'], pageSize: 500 })
          .then(res => (res && res.data && res.data.data) || [])
      : Promise.resolve([]);

    return skuP.then(function (skuRows) {
      const skuById = {}; skuRows.forEach(s => { skuById[s.id] = s; });

      const sentMap = {}, qcMap = {};
      prRows.forEach(function (x) { const sid = String(x.fk_sku_option_id); sentMap[sid] = (sentMap[sid] || 0) + num(x.quantity); });
      qcRows.forEach(function (x) { const sid = String(x.fk_sku_option_id); qcMap[sid] = (qcMap[sid] || 0) + num(x.quantity); });

      const rows = pqdRows.map(function (b) {
        const sid = String(b.fk_sku_option_id);
        const sku = skuById[b.fk_sku_option_id] || {};
        return { sku_id: sid, variant: sku.display || '(none)', ratio: num(b.ratio), do: num(b.quantity), cut: num(b.cut_quantity), sent: sentMap[sid] || 0, qc: qcMap[sid] || 0, _sort: sku.sort };
      }).sort(function (a, b) { return num(a._sort) - num(b._sort); });

      let sentPermakan = 0, returnPermakan = 0;
      prRows.forEach(function (x) {
        if (!x.is_permakan) return;
        const q = num(x.quantity);
        if (q < 0) sentPermakan += Math.abs(q);
        else if (q > 0) returnPermakan += q;
      });

      const delMap = {}, qcHistMap = {};
      prRows.forEach(function (x) {
        const sid = String(x.fk_sku_option_id);
        const sku = skuById[x.fk_sku_option_id] || {};
        (delMap[sid] = delMap[sid] || []).push({
          event_date: x.shipment_date, checking_pic: x.checking_pic, quantity: x.quantity,
          is_permakan: x.is_permakan, remarks: x.remarks, fk_sku_option_id: x.fk_sku_option_id,
          variant: sku.display, _type: 'delivery',
        });
      });
      qcRows.forEach(function (x) {
        const sid = String(x.fk_sku_option_id);
        const sku = skuById[x.fk_sku_option_id] || {};
        (qcHistMap[sid] = qcHistMap[sid] || []).push({
          event_date: x.qc_date, qc_person: x.qc_person, is_defect: x.is_defect, quantity: x.quantity,
          fk_sku_option_id: x.fk_sku_option_id, variant: sku.display, _type: 'qc',
        });
      });

      return {
        rows: rows, delMap: delMap, qcHistMap: qcHistMap,
        perm: { sent_permakan: sentPermakan, return_permakan: returnPermakan },
        totDo: rows.reduce((s, x) => s + x.do, 0), totCut: rows.reduce((s, x) => s + x.cut, 0),
        totSent: rows.reduce((s, x) => s + x.sent, 0), totQc: rows.reduce((s, x) => s + x.qc, 0),
      };
    });
  });
}

// enum label resolver (single-select fields: checking_pic, qc_person) — show label, not value
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
  const prP = ctx.api.resource('production_result').list({
    filter: { fk_production_id: id },
    fields: ['shipment_date', 'quantity', 'checking_pic', 'is_permakan', 'remarks', 'fk_sku_option_id'],
    pageSize: 2000,
  }).then(res => (res && res.data && res.data.data) || []);

  const qcP = ctx.api.resource('qc_result').list({
    filter: { fk_production_id: id },
    fields: ['qc_date', 'quantity', 'qc_person', 'is_defect', 'fk_sku_option_id'],
    pageSize: 2000,
  }).then(res => (res && res.data && res.data.data) || []);

  return Promise.all([prP, qcP]).then(function (r) {
    const prRows = r[0], qcRows = r[1];

    const skuIds = [...new Set(prRows.map(x => x.fk_sku_option_id).concat(qcRows.map(x => x.fk_sku_option_id)).filter(x => x != null))];
    const skuP = skuIds.length
      ? ctx.api.resource('sku_option').list({ filter: { id: { $in: skuIds } }, fields: ['id', 'display'], pageSize: 500 })
          .then(res => (res && res.data && res.data.data) || [])
      : Promise.resolve([]);

    return skuP.then(function (skuRows) {
      const skuById = {}; skuRows.forEach(s => { skuById[s.id] = s; });

      const sent = prRows.map(function (x) {
        return { kind: 'sent', date: x.shipment_date, quantity: num(x.quantity), pic: pdLabel(_pdPicLabels, x.checking_pic), is_permakan: !!x.is_permakan, is_defect: false, variant: (skuById[x.fk_sku_option_id] || {}).display };
      });
      const qc = qcRows.map(function (x) {
        return { kind: 'qc', date: x.qc_date, quantity: num(x.quantity), pic: pdLabel(_pdQcLabels, x.qc_person), is_permakan: false, is_defect: !!x.is_defect, variant: (skuById[x.fk_sku_option_id] || {}).display };
      });
      const all = sent.concat(qc);
      all.sort(function (a, b) { const av = a.date ? new Date(a.date).getTime() : 0; const bv = b.date ? new Date(b.date).getTime() : 0; return bv - av; });
      return all;
    });
  });
}

function fetchHistory(id) {
  const sampleIdsP = ctx.api.resource('production_sample').list({
    filter: { fk_production_id: id }, fields: ['id'], pageSize: 500,
  }).then(res => ((res && res.data && res.data.data) || []).map(r => r.id).filter(Boolean));

  const matIdsP = ctx.api.resource('production_material').list({
    filter: { fk_production_id: id }, fields: ['id'], pageSize: 500,
  }).then(res => ((res && res.data && res.data.data) || []).map(r => r.id).filter(Boolean));

  return Promise.all([sampleIdsP, matIdsP]).then(function (idLists) {
    const sampleIds = idLists[0], matIds = idLists[1];

    const orConds = [{ table_name: 'production', table_id: id }];
    if (sampleIds.length) orConds.push({ table_name: 'production_sample', table_id: { $in: sampleIds } });
    if (matIds.length) orConds.push({ table_name: 'production_material', table_id: { $in: matIds } });

    return ctx.api.resource('history').list({
      filter: { $or: orConds },
      fields: ['fk_user_id', 'create_date', 'status', 'message', 'category', 'table_name'],
      sort: ['-create_date'],
      pageSize: 30,
    }).then(function (histRes) {
      const histRows = (histRes && histRes.data && histRes.data.data) || [];
      const userIds = [...new Set(histRows.map(r => r.fk_user_id).filter(x => x != null))];

      const userP = userIds.length
        ? ctx.api.resource('users').list({ filter: { id: { $in: userIds } }, fields: ['id', 'nickname'], pageSize: 200 })
            .then(res => (res && res.data && res.data.data) || [])
        : Promise.resolve([]);

      return userP.then(function (userRows) {
        const userById = {}; userRows.forEach(u => { userById[u.id] = u; });
        return histRows.map(function (r) {
          return {
            name: (userById[r.fk_user_id] || {}).nickname,
            history_date: r.create_date,
            status: r.status,
            message: r.message,
            category: r.category,
            source: r.table_name,
          };
        });
      });
    });
  }).catch(() => []);
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
  useEffect(function() { setLoading(true); fetchDetailMeta(props.id).then(m => { setMarker(m.marker || ''); setLoading(false); }).catch(() => setLoading(false)); }, [props.id, props.refreshKey]);
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
