// =====================================================
// kanoui.js — SHARED REUSABLE JBLOCK CODE (canonical source; keep as Project file)
//
// Scope for now: ONLY the prepare-fabric action. Nothing table-specific lives here.
// We add to this file later only when something is proven to repeat across views.
//
// HOW IT'S USED
//   Stored as ONE row in `source_code`:  name='kanoui',  code = this whole file.
//   A host jblock compiles it once via new Function and caches the registry:
//
//     let _kano = null;
//     async function loadKano(ctx) {
//       if (_kano) return _kano;
//       const { React, antd, dayjs } = ctx.libs;
//       const rows = await ctx.sql.save({ uid:'kano_src', dataSourceKey:'main',
//         sql:"SELECT code FROM source_code WHERE name='kanoui'" })
//         .then(()=>ctx.sql.runById('kano_src',{ type:'selectRows', dataSourceKey:'main' }));
//       const src = (rows && rows[0] && rows[0].code) || '';
//       _kano = new Function('React','antd','dayjs','ctx', src)(React, antd, dayjs, ctx);
//       return _kano;
//     }
//
//   IMPORTANT: this FILE is the function BODY. The top-level `return {...}` at the
//   bottom is intentional — it's what new Function(...) returns. The host passes in
//   ITS ctx.libs.React, so the bundle shares the host's React → hooks work.
//
// REGISTRY: { fetchFabricRows, PrepareFabricModal, openFabricModal, buildFabricPdf }
// =====================================================
const { Modal } = antd;
const ce = React.createElement;

// ─────────────────────────────────────────────────────
// PDF SECTION — print-ready A4-landscape fabric planning sheet.
// Pure, dependency-free PDF writer (no library, no CDN, no window.*). Builds the
// PDF bytes in JS; downloaded via Blob + document.createElement('a') (same path
// the old CSV export used and that is proven to work in this jsaction context).
// Structure validated with qpdf + pdftoppm.
// ─────────────────────────────────────────────────────
function pdfEsc(s) { return String(s == null ? '' : s).replace(/[^\x20-\x7E]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function pdfFmt(n) { return (Math.round(n * 100) / 100).toString(); }
function pdfPad10(n) { var s = String(n); while (s.length < 10) s = '0' + s; return s; }
function pdfTextW(s, size) { return String(s).length * size * 0.5; } // Helvetica approx

function buildFabricPdf(data) {
  data = data || [];
  var PAGE_W = 842, PAGE_H = 595, M = 30, titleH = 36, headerH = 22, rowH = 30, pad = 4;
  function PY(topY) { return PAGE_H - topY; }

  var cols = [{ t: '#', w: 26, a: 'c' }, { t: 'Product / Fabric', w: 170, a: 'l' }, { t: 'Qty', w: 48, a: 'r' }, { t: 'ROL', w: 48, a: 'r' }];
  var fixed = 26 + 170 + 48 + 48;
  var usable = PAGE_W - 2 * M;
  var entryW = Math.floor((usable - fixed) / 10);
  for (var k = 1; k <= 10; k++) cols.push({ t: String(k), w: entryW, a: 'c', entry: true });
  var xs = [], x = M; for (var c = 0; c < cols.length; c++) { xs.push(x); x += cols[c].w; } var xRight = x;

  var tableTop = M + titleH, headerBottom = tableTop + headerH, maxBottom = PAGE_H - M;
  var rowsPerPage = Math.max(1, Math.floor((maxBottom - headerBottom) / rowH));
  var pages = []; for (var i = 0; i < data.length; i += rowsPerPage) pages.push(data.slice(i, i + rowsPerPage));
  if (!pages.length) pages.push([]);

  function cellText(ops, ci, s, rowTop, size) {
    var col = cols[ci], tw = pdfTextW(s, size);
    var tx = col.a === 'l' ? xs[ci] + pad : col.a === 'r' ? xs[ci] + col.w - pad - tw : xs[ci] + (col.w - tw) / 2;
    ops.push('0 0 0 rg BT /F1 ' + size + ' Tf ' + pdfFmt(tx) + ' ' + pdfFmt(PY(rowTop + 18)) + ' Td (' + pdfEsc(s) + ') Tj ET');
  }

  function pageStream(rows, pageIndex, totalPages, startNo) {
    var ops = [];
    ops.push('0 0 0 rg BT /F2 14 Tf ' + pdfFmt(M) + ' ' + pdfFmt(PY(M + 14)) + ' Td (' + pdfEsc('Fabric Planning Sheet') + ') Tj ET');
    var meta = 'Page ' + (pageIndex + 1) + ' / ' + totalPages;
    ops.push('0 0 0 rg BT /F1 9 Tf ' + pdfFmt(xRight - pdfTextW(meta, 9)) + ' ' + pdfFmt(PY(M + 14)) + ' Td (' + pdfEsc(meta) + ') Tj ET');

    var tableBottom = headerBottom + rows.length * rowH;
    ops.push('1 0.97 0.80 rg');
    for (var c = 0; c < cols.length; c++) { if (cols[c].entry) ops.push(pdfFmt(xs[c]) + ' ' + pdfFmt(PY(headerBottom)) + ' ' + pdfFmt(cols[c].w) + ' ' + pdfFmt(headerH) + ' re f'); }
    ops.push('0.96 0.96 0.96 rg');
    for (var c = 0; c < cols.length; c++) { if (!cols[c].entry) ops.push(pdfFmt(xs[c]) + ' ' + pdfFmt(PY(headerBottom)) + ' ' + pdfFmt(cols[c].w) + ' ' + pdfFmt(headerH) + ' re f'); }

    ops.push('0.6 0.6 0.6 RG 0.5 w');
    for (var c = 0; c <= cols.length; c++) { var vx = (c < cols.length ? xs[c] : xRight); ops.push(pdfFmt(vx) + ' ' + pdfFmt(PY(tableTop)) + ' m ' + pdfFmt(vx) + ' ' + pdfFmt(PY(tableBottom)) + ' l S'); }
    ops.push(pdfFmt(M) + ' ' + pdfFmt(PY(tableTop)) + ' m ' + pdfFmt(xRight) + ' ' + pdfFmt(PY(tableTop)) + ' l S');
    ops.push(pdfFmt(M) + ' ' + pdfFmt(PY(headerBottom)) + ' m ' + pdfFmt(xRight) + ' ' + pdfFmt(PY(headerBottom)) + ' l S');
    for (var r = 0; r <= rows.length; r++) { var hy = headerBottom + r * rowH; ops.push(pdfFmt(M) + ' ' + pdfFmt(PY(hy)) + ' m ' + pdfFmt(xRight) + ' ' + pdfFmt(PY(hy)) + ' l S'); }

    for (var c = 0; c < cols.length; c++) {
      var label = cols[c].t, tw = pdfTextW(label, 9);
      var tx = cols[c].a === 'l' ? xs[c] + pad : cols[c].a === 'r' ? xs[c] + cols[c].w - pad - tw : xs[c] + (cols[c].w - tw) / 2;
      ops.push('0 0 0 rg BT /F2 9 Tf ' + pdfFmt(tx) + ' ' + pdfFmt(PY(tableTop + 15)) + ' Td (' + pdfEsc(label) + ') Tj ET');
    }

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r], rowTop = headerBottom + r * rowH;
      var rol = parseFloat(row.planning_rol) || 0, content = parseFloat(row.default_content) || 0;
      var qty = (rol * content).toFixed(2);
      var rolStr = rol % 1 === 0 ? rol.toFixed(0) : rol.toFixed(2);
      cellText(ops, 0, String(startNo + r + 1), rowTop, 9);
      ops.push('0 0 0 rg BT /F1 9 Tf ' + pdfFmt(xs[1] + pad) + ' ' + pdfFmt(PY(rowTop + 12)) + ' Td (' + pdfEsc(row.product_code || '-') + ') Tj ET');
      ops.push('0.5 0.5 0.5 rg BT /F1 8 Tf ' + pdfFmt(xs[1] + pad) + ' ' + pdfFmt(PY(rowTop + 24)) + ' Td (' + pdfEsc(row.fabric_code || '-') + ') Tj ET');
      cellText(ops, 2, qty, rowTop, 9);
      cellText(ops, 3, rolStr, rowTop, 9);
    }
    return ops.join('\n');
  }

  var fontH = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  var fontHB = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  var nPages = pages.length, pageObjNums = [], contentObjNums = [], next = 5;
  for (var p = 0; p < nPages; p++) { pageObjNums.push(next++); contentObjNums.push(next++); }

  var objsByNum = {};
  objsByNum[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objsByNum[2] = '<< /Type /Pages /Kids [' + pageObjNums.map(function (n) { return n + ' 0 R'; }).join(' ') + '] /Count ' + nPages + ' >>';
  objsByNum[3] = fontH;
  objsByNum[4] = fontHB;
  var running = 0;
  for (var p = 0; p < nPages; p++) {
    var cs = pageStream(pages[p], p, nPages, running);
    running += pages[p].length;
    objsByNum[contentObjNums[p]] = '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream';
    objsByNum[pageObjNums[p]] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + contentObjNums[p] + ' 0 R >>';
  }
  var maxNum = next - 1;

  var out = '%PDF-1.4\n', offsets = {};
  for (var n = 1; n <= maxNum; n++) { offsets[n] = out.length; out += n + ' 0 obj\n' + objsByNum[n] + '\nendobj\n'; }
  var xrefStart = out.length;
  out += 'xref\n0 ' + (maxNum + 1) + '\n0000000000 65535 f \n';
  for (var n = 1; n <= maxNum; n++) { out += pdfPad10(offsets[n]) + ' 00000 n \n'; }
  out += 'trailer\n<< /Size ' + (maxNum + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';

  var bytes = new Uint8Array(out.length);
  for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

function downloadFabricPdf(bytes, filename) {
  var blob = new Blob([bytes], { type: 'application/pdf' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename || 'fabric_planning.pdf'; a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────
// fetchFabricRows — production ids → modal-shaped rows.
// Pure and view-agnostic: works from any context with ctx.sql. Reads the fabric
// code from product.fk_main_fabric_code (the product's main fabric), joining
// production → product → material_details → raw_material. Single batched query.
// Returns: [{ product_code, fabric_code, planning_rol, default_content }]
// ─────────────────────────────────────────────────────
function fetchFabricRows(ctx, ids) {
  ids = (ids || []).filter(function (x) { return x != null; });
  if (!ids.length) return Promise.resolve([]);
  var idList = ids.map(function (id) { return "'" + id + "'"; }).join(',');
  var uid = 'kano_fabric_report';
  var sql =
    "SELECT product.code AS product_code, " +
    "  product.fk_main_fabric_code AS fabric_code, " +
    "  production.planning_rol AS planning_rol, " +
    "  raw_material.default_content AS default_content " +
    "FROM production, product, material_details, raw_material " +
    "WHERE production.id IN (" + idList + ") " +
    "  AND production.fk_product_code = product.code " +
    "  AND product.fk_main_fabric_code = material_details.code " +
    "  AND material_details.fk_material_code = raw_material.code " +
    "ORDER BY fk_main_fabric_code";
  return ctx.sql.save({ uid: uid, sql: sql, dataSourceKey: 'main' })
    .then(function () { return ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' }); })
    .then(function (r) { return r || []; })
    .catch(function () { return []; });
}

// ─────────────────────────────────────────────────────
// PrepareFabricModal — presentation only. Takes `data`:
//   [{ product_code, fabric_code, planning_rol, default_content }]
// ─────────────────────────────────────────────────────
function PrepareFabricModal(props) {
  var data = props.data || [];
  var entry = ['1','2','3','4','5','6','7','8','9','10'];
  var th  = { border: '1px solid #ddd', padding: '6px 8px', background: '#fafafa', fontWeight: 600, fontSize: 11, textAlign: 'left', whiteSpace: 'nowrap' };
  var td  = { border: '1px solid #ddd', padding: '6px 8px', fontSize: 12, verticalAlign: 'top' };
  var tdE = { border: '1px solid #ddd', padding: '6px 4px', width: 40, background: '#fffde7' };

  function handlePDF() {
    try {
      var bytes = buildFabricPdf(data);
      downloadFabricPdf(bytes, 'fabric_planning.pdf');
    } catch (e) {
      antd.message.error('PDF export failed: ' + ((e && e.message) || e));
    }
  }

  var body = ce('div', null,
    ce('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' } },
      ce('div', { style: { fontSize: 11, color: '#888' } }, (props.count || data.length) + ' selected — ' + data.length + ' fabric record(s)'),
      ce('button', { onClick: handlePDF, style: { padding: '5px 14px', fontSize: 11, cursor: 'pointer', border: '1px solid #0ea5e9', borderRadius: 6, background: '#0ea5e9', color: '#fff', fontWeight: 600 } }, '⬇ Download PDF')),
    ce('div', { style: { overflowX: 'auto', maxHeight: '62vh' } },
      ce('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 640 } },
        ce('thead', null, ce('tr', null,
          ce('th', { style: Object.assign({}, th, { width: 20 }) }, '#'),
          ce('th', { style: th }, 'Product / Fabric'),
          ce('th', { style: Object.assign({}, th, { textAlign: 'right', width: 72 }) }, 'Qty'),
          ce('th', { style: Object.assign({}, th, { textAlign: 'right', width: 50 }) }, 'ROL'),
          entry.map(function (h, i) { return ce('th', { key: i, style: Object.assign({}, th, { background: '#fff8e1', textAlign: 'center', padding: '6px 2px', width: 40 }) }, h); }))),
        ce('tbody', null, data.map(function (r, i) {
          var rol = parseFloat(r.planning_rol) || 0;
          var content = parseFloat(r.default_content) || 0;
          var qty = (rol * content).toFixed(2);
          return ce('tr', { key: i },
            ce('td', { style: Object.assign({}, td, { color: '#aaa', fontSize: 10 }) }, i + 1),
            ce('td', { style: td },
              ce('div', { style: { fontWeight: 500, fontSize: 12 } }, r.product_code || '-'),
              ce('div', { style: { fontSize: 11, color: '#888', marginTop: 2 } }, r.fabric_code || '-')),
            ce('td', { style: Object.assign({}, td, { textAlign: 'right' }) }, qty),
            ce('td', { style: Object.assign({}, td, { textAlign: 'right' }) }, rol % 1 === 0 ? rol.toFixed(0) : rol.toFixed(2)),
            entry.map(function (_, j) { return ce('td', { key: j, style: tdE }); }));
        }))) ));

  // inline=true → return just the content (for Modal.confirm in a click handler).
  if (props.inline) return body;

  // otherwise render our own Modal shell (controlled component for render contexts).
  return ce(Modal, {
    open: props.open, title: 'Prepare Fabric', onCancel: props.onClose, centered: true,
    width: 'min(900px, 94vw)', rootClassName: 'kano-fabric-modal', maskClosable: true,
    footer: ce('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
      ce('button', { onClick: props.onClose, style: { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600 } }, 'Close')),
  }, body);
}

// ─────────────────────────────────────────────────────
// openFabricModal — imperative open via Modal.confirm. Right pattern for a click
// handler (no render root needed; portals to body). Pass the fetched rows.
//   rows: [{ product_code, fabric_code, planning_rol, default_content }]
//   selectedCount (optional): for the "N row(s) selected" subtitle.
// ─────────────────────────────────────────────────────
function openFabricModal(rows, selectedCount) {
  rows = rows || [];
  return new Promise(function (resolve) {
    Modal.confirm({
      title: 'Fabric Planning Report',
      width: 'min(900px, 94vw)',
      icon: null,
      content: ce(PrepareFabricModal, { inline: true, data: rows, count: selectedCount || rows.length }),
      okText: 'Close',
      cancelButtonProps: { style: { display: 'none' } },
      onOk: function () { resolve(); },
      onCancel: function () { resolve(); },
    });
  });
}

// ─────────────────────────────────────────────────────
// REGISTRY — what new Function(...) returns
// ─────────────────────────────────────────────────────
return { fetchFabricRows, PrepareFabricModal, openFabricModal, buildFabricPdf };