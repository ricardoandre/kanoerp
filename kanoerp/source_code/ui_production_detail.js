// =====================================================
// ui_product_detail — shared PRODUCT detail (read-only view).
//
// Stored as a `source_code` row named 'ui_product_detail'.
// Loaded via loadCode('ui_product_detail'); compiled with
//   new Function('React','antd','dayjs','ctx', src)(React, antd, dayjs, ctx).
//
// EXPORTS (contract):
//   DetailBody({ productCode, refreshKey })
//     — accordion of 4 sections, SELF-FETCHES everything from productCode:
//       1. Summary     — image, code, name, description, model, designer
//       2. Materials   — main_fabric + product_material rows (material_details, quantity)
//       3. Variants    — product_variant rows (sku_option, code, web_price, marketplace_price)
//       4. Measurements— the product_measurement row linked to each variant (per size)
//     Renders no outer chrome (no title/accent/spacer) — this is what
//     ui_list_engine's config.detailRender renders inside its own drawer chrome.
//
//   ProductDetailDrawer({ open, productCode, onClose })
//     — STANDALONE right-drawer wrapping DetailBody, for reuse outside a
//       ui_list_engine host (e.g. a future cross-link from another view).
//
// Depends on: none.
//
// NOTE: MEASURE_FIELDS (label list for the 16 product_measurement columns) is
// duplicated from ui_product_measurement — this is the second use of that
// exact list, so per "extract-on-second-use" it's a reasonable candidate for
// a future lib_measurement_fields row. Left duplicated for now since it's a
// small, static constant and not worth an extra loadCode round-trip yet.
// =====================================================
const { Drawer, Spin, Table } = antd;
const ce = React.createElement;
const { useState, useEffect } = React;

function runSql(uid, sql) {
  return ctx.sql.save({ uid, sql, dataSourceKey: 'main' })
    .then(() => ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' }))
    .then(r => r || []);
}
function esc(s) { return String(s == null ? '' : s).replace(/'/g, "''"); }
const secTitle = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af', marginBottom: 12 };
function metaItem(label, value) {
  return ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
    ce('div', { style: { fontSize: 11, color: '#9ca3af', fontWeight: 500 } }, label),
    ce('div', { style: { fontSize: 13, color: '#111827', fontWeight: 500 } }, (value != null && value !== '') ? value : '—'));
}
function pill(text, bg, color) {
  return ce('span', { style: { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: bg, color: color } }, text);
}
function money(v) { return v == null ? '—' : 'Rp ' + Number(v).toLocaleString('id-ID'); }

const MEASURE_FIELDS = [
  { key: 'bust',              label: 'Lr. Dada (Bust)' },
  { key: 'shoulder',          label: 'Bahu (Shoulder)' },
  { key: 'waist',             label: 'Ling. Pinggang (Waist)' },
  { key: 'hips',              label: 'Ling. Pinggul (Hips)' },
  { key: 'length',            label: 'Panjang (Length)' },
  { key: 'length2',           label: 'Panjang2 (Length 2)' },
  { key: 'bottom_hole',       label: 'Ling. Bawah (Bottom)' },
  { key: 'neck',              label: 'Ling. Leher (Neck)' },
  { key: 'arm_hole',          label: 'Ling. Ketiak (Arm Hole)' },
  { key: 'bottom_sleeve',     label: 'Lr Lengan (Btm Sleeve)' },
  { key: 'mid_sleeve',        label: 'Pangkal Lengan (Mid Sleeve)' },
  { key: 'sleeve_length',     label: 'Pj Lengan (Sleeve Len)' },
  { key: 'thigh',             label: 'Lr Paha (Thigh)' },
  { key: 'est_main_fabric',   label: 'Est Bahan (Fabric)' },
  { key: 'est_furing',        label: 'Est Furing' },
  { key: 'est_main_fabric_2', label: 'Est Bahan 2' },
];

// ── CSS (pdt- prefix; unscoped since drawer content portals to <body>) ──
const DETAIL_CSS =
  ".pdt-detail-drawer .ant-drawer-content-wrapper{width:min(980px,92vw) !important;}" +
  "@media (max-width:700px){.pdt-detail-drawer .ant-drawer-content-wrapper{width:100% !important;}}" +
  ".pdt-sum-layout{display:flex;flex-direction:column;gap:16px;}" +
  ".pdt-sum-img{width:100%;border-radius:12px;overflow:hidden;background:#f3f4f6;display:flex;align-items:center;justify-content:center;}" +
  "@media(min-width:760px){.pdt-sum-layout{flex-direction:row;align-items:flex-start;gap:24px;}.pdt-sum-img{width:260px;flex-shrink:0;}.pdt-sum-meta{flex:1;min-width:0;}}" +
  ".pdt-sum2{display:grid;grid-template-columns:1fr 1fr;gap:16px 24px;}" +
  ".pdt-desc{font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap;}" +
  ".pdt-meas-wrap .ant-table-thead>tr>th{font-size:10px;white-space:normal;line-height:1.25;padding:6px 6px;}" +
  ".pdt-meas-wrap .ant-table-tbody>tr>td{padding:6px 6px;font-size:12px;}";
const DetailStyles = () => ce('style', null, DETAIL_CSS);

// =====================================================
// DATA LAYER (all keyed by productCode)
// =====================================================
function fetchHeader(code) {
  return runSql('pdt_hdr_' + code,
    "SELECT product.code AS code, product.name AS name, product.model AS model, product.description AS description, product.designer AS designer, product.display AS display, " +
    "  product.fk_main_fabric_code AS main_fabric_code, material_details.variant AS main_fabric_variant, raw_material.code AS main_fabric_raw_code, raw_material.composition AS main_fabric_composition, supplier.name AS main_fabric_supplier " +
    "FROM product " +
    "LEFT JOIN material_details ON product.fk_main_fabric_code = material_details.code " +
    "LEFT JOIN raw_material ON material_details.fk_material_code = raw_material.code " +
    "LEFT JOIN supplier ON material_details.fk_supplier_id = supplier.id " +
    "WHERE product.code = '" + esc(code) + "'"
  ).then(r => r[0] || {});
}

// image: attachment fields aren't SQL columns. Introspect product.image's
// through-table + keys from `fields`, then join `attachments` for one product.
function fetchProductImage(code) {
  if (!code) return Promise.resolve('');
  return runSql('pdt_imgmeta',
    "SELECT CAST(options AS CHAR) AS options FROM fields WHERE collection_name='product' AND name='image'"
  ).then(function(rows) {
    if (!rows.length) return '';
    let opt = {}; try { opt = JSON.parse(rows[0].options || '{}'); } catch (e) { return ''; }
    const through = opt.through, fk = opt.foreignKey, ok = opt.otherKey, sk = opt.sourceKey || 'code';
    if (!through || !fk || !ok) return '';
    return runSql('pdt_imgjoin_' + code,
      "SELECT attachments.url AS url, attachments.filename AS filename FROM product " +
      "JOIN " + through + " ON " + through + "." + fk + " = product." + sk + " " +
      "JOIN attachments ON attachments.id = " + through + "." + ok + " " +
      "WHERE product.code = '" + esc(code) + "' ORDER BY attachments.id ASC LIMIT 1"
    ).then(function(irows) { const r = irows[0]; return r ? (r.url || (r.filename ? '/storage/uploads/' + r.filename : '')) : ''; });
  }).catch(() => '');
}

function fetchMaterials(code) {
  return runSql('pdt_mat_' + code,
    "SELECT pm.id AS id, pm.quantity AS quantity, md.code AS material_code, md.variant AS material_variant, " +
    "  rm.code AS raw_code, rm.type AS raw_type, rm.composition AS composition, supplier.name AS supplier_name " +
    "FROM product_material pm " +
    "JOIN material_details md ON pm.fk_material_details_code = md.code " +
    "LEFT JOIN raw_material rm ON md.fk_material_code = rm.code " +
    "LEFT JOIN supplier ON md.fk_supplier_id = supplier.id " +
    "WHERE pm.fk_product_code = '" + esc(code) + "' ORDER BY pm.id ASC");
}

function fetchVariants(code) {
  return runSql('pdt_var_' + code,
    "SELECT pv.id AS id, pv.code AS code, pv.web_price AS web_price, pv.marketplace_price AS marketplace_price, " +
    "  pv.fk_product_measurement_id AS measurement_id, sku_option.display AS sku_display, sku_option.sort AS sku_sort " +
    "FROM product_variant pv JOIN sku_option ON pv.fk_sku_option_id = sku_option.id " +
    "WHERE pv.fk_product_code = '" + esc(code) + "' ORDER BY sku_option.sort ASC");
}

function fetchMeasurements(ids) {
  const uniqIds = ids.filter((v, i, a) => v != null && a.indexOf(v) === i);
  if (!uniqIds.length) return Promise.resolve({});
  const cols = MEASURE_FIELDS.map(f => f.key).join(', ');
  return runSql('pdt_meas_' + uniqIds.join('_'),
    "SELECT id, name, " + cols + ", remarks FROM product_measurement WHERE id IN (" + uniqIds.join(',') + ")"
  ).then(function(rows) { const map = {}; rows.forEach(r => { map[String(r.id)] = r; }); return map; });
}

// =====================================================
// SECTIONS
// =====================================================
const Section1Summary = function(props) {
  const h = props.header;
  if (!h) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  const img = props.image;
  return ce('div', { className: 'pdt-sum-layout' },
    ce('div', { className: 'pdt-sum-img', style: { padding: img ? 0 : 30 } },
      img
        ? ce('img', { src: img, style: { maxWidth: '100%', maxHeight: 320, width: 'auto', height: 'auto', display: 'block', borderRadius: 12 } })
        : ce('span', { style: { fontSize: 42, color: '#cbd5e1' } }, '👕')),
    ce('div', { className: 'pdt-sum-meta' },
      ce('div', { className: 'pdt-sum2' },
        ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          metaItem('Code', h.code), metaItem('Name', h.name), metaItem('Model', h.model)),
        ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          metaItem('Designer', h.designer), metaItem('Display', h.display))),
      ce('div', { style: { marginTop: 16 } },
        ce('div', { style: { fontSize: 11, color: '#9ca3af', fontWeight: 500, marginBottom: 4 } }, 'Description'),
        h.description ? ce('div', { className: 'pdt-desc' }, h.description) : ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No description'))));
};

const Section2Materials = function(props) {
  const h = props.header; const rows = props.materials;
  if (!h) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  const mainFabric = h.main_fabric_code
    ? ce('div', { style: { padding: '10px 12px', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 8, marginBottom: 12 } },
        ce('div', { style: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3af', marginBottom: 4 } }, 'Main Fabric'),
        ce('div', { style: { fontSize: 13, fontWeight: 700, color: '#0f172a' } }, h.main_fabric_code + (h.main_fabric_variant ? (' · ' + h.main_fabric_variant) : '')),
        ce('div', { style: { fontSize: 11, color: '#6b7280', marginTop: 2 } }, [h.main_fabric_raw_code, h.main_fabric_composition, h.main_fabric_supplier].filter(Boolean).join(' · ') || '—'))
    : ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic', marginBottom: 12 } }, 'No main fabric set');

  if (!rows || !rows.length) return ce('div', null, mainFabric, ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No BOM materials'));
  return ce('div', null, mainFabric,
    ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      rows.map(function(m) {
        return ce('div', { key: m.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', border: '1px solid #f1f5f9', borderRadius: 8 } },
          ce('div', { style: { minWidth: 0 } },
            ce('div', { style: { fontSize: 13, fontWeight: 700, color: '#0f172a' } }, m.material_code + (m.material_variant ? (' · ' + m.material_variant) : '')),
            ce('div', { style: { fontSize: 11, color: '#9ca3af' } }, [m.raw_code, m.raw_type, m.supplier_name].filter(Boolean).join(' · ') || '—')),
          ce('div', { style: { fontSize: 13, fontWeight: 700, color: '#374151', flexShrink: 0, marginLeft: 10 } }, m.quantity != null ? m.quantity : '—'));
      })));
};

const Section3Variants = function(props) {
  const rows = props.variants;
  if (!rows) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  if (!rows.length) return ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No variants');
  return ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
    rows.map(function(v) {
      return ce('div', { key: v.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', border: '1px solid #f1f5f9', borderRadius: 8 } },
        ce('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
          ce('span', { style: { fontWeight: 700, fontSize: 13, color: '#0f172a', width: 44, flexShrink: 0 } }, v.sku_display),
          ce('span', { style: { fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, v.code || '—'),
          v.measurement_id ? pill('Measured', '#dcfce7', '#16a34a') : pill('No measurement', '#f3f4f6', '#9ca3af')),
        ce('div', { style: { display: 'flex', gap: 14, flexShrink: 0, marginLeft: 10 } },
          ce('div', { style: { textAlign: 'right' } }, ce('div', { style: { fontSize: 9, color: '#9ca3af', textTransform: 'uppercase' } }, 'Web'), ce('div', { style: { fontSize: 12, fontWeight: 700, color: '#374151' } }, money(v.web_price))),
          ce('div', { style: { textAlign: 'right' } }, ce('div', { style: { fontSize: 9, color: '#9ca3af', textTransform: 'uppercase' } }, 'MP'), ce('div', { style: { fontSize: 12, fontWeight: 700, color: '#374151' } }, money(v.marketplace_price)))));
    }));
};

const Section4Measurements = function(props) {
  const variants = props.variants; const measMap = props.measurements;
  if (!variants) return ce('div', { style: { padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 12 } }, 'Loading…');
  const sized = variants.slice().sort((a, b) => a.sku_sort - b.sku_sort);
  if (!sized.length) return ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No variants to measure');
  const linked = sized.filter(v => v.measurement_id != null);
  if (!linked.length) return ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No measurements linked yet');

  const columns = [
    { title: 'Size', dataIndex: 'sku_display', key: 'sku_display', fixed: 'left', width: 60,
      render: v => ce('span', { style: { fontWeight: 700 } }, v) },
  ].concat(MEASURE_FIELDS.map(f => ({
    title: f.label, dataIndex: f.key, key: f.key, width: 90,
    render: v => v != null ? v : ce('span', { style: { color: '#d1d5db' } }, '—'),
  })));

  const dataSource = sized.map(function(v) {
    const m = v.measurement_id != null ? (measMap[String(v.measurement_id)] || {}) : {};
    return Object.assign({ sku_display: v.sku_display, _rowKey: v.id, _hasMeasurement: v.measurement_id != null }, m);
  });

  return ce('div', { className: 'pdt-meas-wrap' },
    ce(Table, { size: 'small', dataSource: dataSource, columns: columns, rowKey: '_rowKey', pagination: false, scroll: { x: 1500 },
      rowClassName: r => r._hasMeasurement ? '' : 'pdt-row-nomeasure' }));
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
// DetailBody — accordion only; self-fetches everything. No outer chrome.
// =====================================================
const DetailBody = function(props) {
  const code = props.productCode;
  const rk = props.refreshKey;
  const sH = useState(null); const header = sH[0]; const setHeader = sH[1];
  const sI = useState('');   const image = sI[0];  const setImage = sI[1];
  const sM = useState(null); const materials = sM[0]; const setMaterials = sM[1];
  const sV = useState(null); const variants = sV[0]; const setVariants = sV[1];
  const sMeas = useState({}); const measurements = sMeas[0]; const setMeasurements = sMeas[1];
  const sO = useState(0);    const openIdx = sO[0]; const setOpenIdx = sO[1];

  useEffect(function() { setOpenIdx(0); }, [code]);
  useEffect(function() {
    let alive = true;
    setHeader(null); setImage(''); setMaterials(null); setVariants(null); setMeasurements({});
    if (!code) return;
    fetchHeader(code).then(function(hd) { if (alive) setHeader(hd); });
    fetchProductImage(code).then(function(u) { if (alive) setImage(u); });
    fetchMaterials(code).then(function(rows) { if (alive) setMaterials(rows); });
    fetchVariants(code).then(function(rows) {
      if (!alive) return;
      setVariants(rows);
      fetchMeasurements(rows.map(r => r.measurement_id)).then(function(map) { if (alive) setMeasurements(map); });
    });
    return function() { alive = false; };
  }, [code, rk]);

  function toggle(i) { setOpenIdx(openIdx === i ? -1 : i); }
  const sections = [
    { title: 'Summary',      body: ce(Section1Summary,     { header: header, image: image }) },
    { title: 'Materials',    body: ce(Section2Materials,   { header: header, materials: materials }) },
    { title: 'Variants',     body: ce(Section3Variants,    { variants: variants }) },
    { title: 'Measurements', body: ce(Section4Measurements,{ variants: variants, measurements: measurements }) },
  ];
  return ce('div', null,
    ce(DetailStyles, null),
    sections.map((s, i) => ce(AccordionItem, { key: i, title: s.title, open: openIdx === i, onToggle: () => toggle(i) }, s.body)));
};

// =====================================================
// ProductDetailDrawer — standalone handoff drawer (title + chrome).
// =====================================================
const ProductDetailDrawer = function(props) {
  return ce(Drawer, {
    open: !!props.open, placement: 'right', rootClassName: 'pdt-detail-drawer',
    zIndex: props.zIndex || 1050,
    title: props.productCode || '',
    onClose: props.onClose,
  },
    (props.open && props.productCode) ? ce('div', { style: { fontFamily: "'Segoe UI', sans-serif" } },
      ce(DetailStyles, null),
      ce('div', { style: { height: 4, borderRadius: 999, background: '#6366f1', marginBottom: 6, opacity: 0.85 } }),
      ce(DetailBody, { productCode: props.productCode, refreshKey: props.refreshKey }),
      ce('div', { style: { height: 120 } })
    ) : null
  );
};

return { DetailBody, ProductDetailDrawer, DetailStyles };
