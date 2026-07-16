const { React, antd } = ctx.libs;
const { useEffect, useState } = React;
const { Col, Row, Spin, Typography } = antd;
const { Text } = Typography;
const dayjs = ctx.libs.dayjs;

function formatDate(value) {
  if (!value) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('DD MMM YYYY') : null;
}

function statusColor(value) {
  const map = {
    planning:   '#f97316',
    cutting:    '#d97706',
    production: '#d97706',
    qc:         '#84cc16',
    permak:     '#ef4444',
    done:       '#22c55e',
  };
  return map[String(value || '').toLowerCase()] || '#9ca3af';
}

function statusBg(value) {
  const map = {
    planning:   '#fff7ed',
    cutting:    '#fffbeb',
    production: '#fffbeb',
    qc:         '#f7fee7',
    permak:     '#fef2f2',
    done:       '#f0fdf4',
  };
  return map[String(value || '').toLowerCase()] || '#f3f4f6';
}

function statusLabel(value) {
  const map = {
    planning:   'Planning',
    cutting:    'Cutting',
    production: 'Production',
    qc:         'QC',
    permak:     'Permak',
    done:       'Done',
  };
  return map[String(value || '').toLowerCase()] || String(value || '-');
}

function materialStatusColor(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'sent')    return '#22c55e';
  if (s === 'ready')   return '#84cc16';
  if (s === 'ordered') return '#f97316';
  if (s === 'pending') return '#f97316';
  return '#9ca3af';
}

// ── QUANTITY-NEED LOGIC (mirrors the quantity_need column) ─────────
const M_TO_YARD = 1.0936;
function numVal(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function fmtVal(v) { const n = numVal(v); return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100); }

function buildNeed(material, isAccessories, planningRol, totalDo) {
  const qn = material.quantity_need;
  const hasQty = qn !== null && qn !== undefined && qn !== '';
  if (isAccessories) {
    const xx = numVal(qn), yy = numVal(totalDo), zz = xx * yy;
    return { rows: [['quantity/pcs', xx, 'pcs'], ['quantity do', yy, 'pcs']], total: ['total', zz, 'pcs'] };
  } else if (!hasQty) {
    const xx = numVal(planningRol), yy = numVal(material.default_content), zz = xx * yy;
    return { rows: [['planning', xx, 'rol'], ['default 1 rol', yy, 'yard']], total: ['total', zz, 'yard'] };
  } else {
    const xx = numVal(qn), yy = numVal(totalDo), zz = xx * yy * M_TO_YARD;
    return { rows: [['quantity/pcs', xx, 'meter'], ['quantity do', yy, 'pcs']], total: ['total', zz, 'yard'] };
  }
}

function renderNeed(need) {
  const children = need.rows.map(function (r, idx) {
    return React.createElement('div', { key: 'r' + idx, style: { display: 'flex', justifyContent: 'space-between', fontSize: 11 } },
      React.createElement('span', { style: { color: '#9ca3af' } }, r[0]),
      React.createElement('span', { style: { fontWeight: 600, color: '#374151' } }, fmtVal(r[1]) + ' ' + r[2])
    );
  });
  children.push(
    React.createElement('div', { key: 'total', style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#166534', borderTop: '1px solid #e2e8f0', paddingTop: 3, marginTop: 2 } },
      React.createElement('span', null, need.total[0]),
      React.createElement('span', null, fmtVal(need.total[1]) + ' ' + need.total[2])
    )
  );
  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6, padding: '6px 8px', background: '#fff', border: '1px solid #f0f0f0', borderRadius: 6 }
  }, children);
}

function capitalize(s) {
  s = String(s || '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function renderOutLine(status, count, total, unitItem, unitTotal, shipmentDate) {
  return React.createElement('div', { style: { fontSize: 11, color: '#9ca3af', marginBottom: 6 } },
    capitalize(status) + ': ',
    React.createElement('span', { style: { fontWeight: 700, color: '#3b82f6' } },
      count + ' ' + unitItem + ' (' + total + ' ' + unitTotal + ')'
    ),
    shipmentDate ? (' on ' + (formatDate(shipmentDate) || '—')) : ''
  );
}

function renderOutChips(details) {
  return React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 } },
    details.map(function (v, j) {
      return React.createElement('span', {
        key: j,
        style: {
          background: '#eff6ff', color: '#3b82f6', border: '1px solid #bfdbfe',
          borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600
        }
      }, v);
    })
  );
}

const hostRecord =
  (await ctx.getVar?.('ctx.record')) ||
  (await ctx.getVar?.('ctx.popup.record')) ||
  ctx.record ||
  null;

const ProductionDetailView = function () {
  const [loading, setLoading]       = useState(true);
  const [detail, setDetail]         = useState(null);
  const [fabrics, setFabrics]       = useState([]);
  const [accessories, setAccessories] = useState([]);
  const [sample, setSample]         = useState(null);
  const [totalDo, setTotalDo]       = useState(0);
  const [errorText, setErrorText]   = useState('');

  useEffect(function () {
    let active = true;

    async function bootstrap() {
      if (!hostRecord?.id) {
        setErrorText('Production record is unavailable.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorText('');

      try {
        const id = hostRecord.id;

        // 1. Main production record — plain resource GET, no raw SQL
        const prodRes = await ctx.api.resource('production').get({ filterByTk: id });
        const prod = prodRes?.data?.data;
        if (!active) return;
        if (!prod) {
          setErrorText('No production record found.');
          setLoading(false);
          return;
        }

        // 2. Product + konveksi lookups (independent REST calls — safe to parallelize)
        const [productRes, konveksiRes] = await Promise.all([
          prod.fk_product_code ? ctx.api.resource('product').get({ filterByTk: prod.fk_product_code }).catch(() => null) : Promise.resolve(null),
          prod.fk_konveksi_code ? ctx.api.resource('konveksi').get({ filterByTk: prod.fk_konveksi_code }).catch(() => null) : Promise.resolve(null),
        ]);
        const product = productRes?.data?.data || {};
        const konveksi = konveksiRes?.data?.data || {};

        const mainRow = {
          id: prod.id,
          production_ref: prod.production_ref,
          is_new: prod.is_new,
          planning_rol: prod.planning_rol,
          product_code: product.code,
          product_name: product.name,
          konveksi_name: konveksi.name,
          status: prod.status,
          est_production_start: prod.est_production_start,
          est_production_finish: prod.est_production_finish,
          remarks: prod.remarks,
          marker: prod.marker,
        };

        // 3. production_material rows for this production
        const pmRes = await ctx.api.resource('production_material').list({
          filter: { fk_production_id: id },
          fields: ['id', 'fk_material_details_code', 'status', 'shipment_date', 'quantity_need'],
          pageSize: 200,
        });
        const pmRows = pmRes?.data?.data || [];

        // 4. material_details for the referenced codes (batched, no N+1)
        const materialCodes = [...new Set(pmRows.map(m => m.fk_material_details_code).filter(Boolean))];
        let mdRows = [];
        if (materialCodes.length) {
          const mdRes = await ctx.api.resource('material_details').list({
            filter: { code: { $in: materialCodes } },
            fields: ['code', 'fk_material_code'],
            pageSize: 200,
          });
          mdRows = mdRes?.data?.data || [];
        }
        const mdByCode = {};
        mdRows.forEach(r => { mdByCode[r.code] = r; });

        // 5. raw_material for the referenced codes (batched, no N+1)
        const rawCodes = [...new Set(mdRows.map(r => r.fk_material_code).filter(Boolean))];
        let rmRows = [];
        if (rawCodes.length) {
          const rmRes = await ctx.api.resource('raw_material').list({
            filter: { code: { $in: rawCodes } },
            fields: ['code', 'type', 'default_content'],
            pageSize: 200,
          });
          rmRows = rmRes?.data?.data || [];
        }
        const rmByCode = {};
        rmRows.forEach(r => { rmByCode[r.code] = r; });

        const materialRows = pmRows.map(m => {
          const md = mdByCode[m.fk_material_details_code] || {};
          const rm = rmByCode[md.fk_material_code] || {};
          return {
            id: m.id,
            material_code: m.fk_material_details_code,
            status: m.status,
            shipment_date: m.shipment_date,
            quantity_need: m.quantity_need,
            material_type: rm.type,
            default_content: rm.default_content,
          };
        });

        const fabricRowsRaw = materialRows.filter(m => String(m.material_type || '').toLowerCase() === 'fabric');
        const accRowsRaw = materialRows.filter(m => String(m.material_type || '').toLowerCase() !== 'fabric');

        // 6. material_ledger for ALL production_material ids in one batched call.
        // Cancelled entries are excluded here so the totals/chips shown below only
        // reflect active (requested/confirmed) material out — matches the exclusion
        // rule used in ui_material_out / ui_production_material_details.
        const allPmIds = pmRows.map(m => m.id).filter(Boolean);
        let ledgerRows = [];
        if (allPmIds.length) {
          const ledgerRes = await ctx.api.resource('material_ledger').list({
            filter: { fk_production_material_id: { $in: allPmIds } },
            fields: ['id', 'fk_production_material_id', 'status'],
            pageSize: 500,
          });
          ledgerRows = ledgerRes?.data?.data || [];
        }
        const activeLedgerRows = ledgerRows.filter(l => String(l.status || 'requested').toLowerCase() !== 'cancelled');
        const ledgerIdsByPm = {};
        activeLedgerRows.forEach(l => {
          const key = String(l.fk_production_material_id);
          (ledgerIdsByPm[key] = ledgerIdsByPm[key] || []).push(l.id);
        });

        // 7. material_ledger_details for ALL (active) ledger ids in one batched call
        const allLedgerIds = activeLedgerRows.map(l => l.id).filter(Boolean);
        let ledgerDetailRows = [];
        if (allLedgerIds.length) {
          const detRes = await ctx.api.resource('material_ledger_details').list({
            filter: { fk_material_ledger_id: { $in: allLedgerIds } },
            fields: ['details', 'fk_material_ledger_id'],
            pageSize: 1000,
          });
          ledgerDetailRows = detRes?.data?.data || [];
        }
        const detailsByLedgerId = {};
        ledgerDetailRows.forEach(d => {
          const key = String(d.fk_material_ledger_id);
          (detailsByLedgerId[key] = detailsByLedgerId[key] || []).push(d.details);
        });

        function detailsForPm(pmId) {
          const lIds = ledgerIdsByPm[String(pmId)] || [];
          let out = [];
          lIds.forEach(lid => { out = out.concat(detailsByLedgerId[String(lid)] || []); });
          return out;
        }

        const fabricsWithDetails = fabricRowsRaw.map(f => ({ ...f, yardDetails: detailsForPm(f.id) }));
        const accRows = accRowsRaw.map(a => ({ ...a, pcsDetails: detailsForPm(a.id) }));

        // 8. Sample
        const sampleRes = await ctx.api.resource('production_sample').list({
          filter: { fk_production_id: id },
          fields: ['fk_sample_product_code', 'status', 'shipment_date', 'returned_date'],
          pageSize: 5,
        });
        const sampleRows = sampleRes?.data?.data || [];

        // 9. Total DO quantity
        const qtyRes = await ctx.api.resource('production_quantity_details').list({
          filter: { fk_production_id: id },
          fields: ['quantity'],
          pageSize: 1000,
        });
        const qtyRows = qtyRes?.data?.data || [];
        const totalDoVal = qtyRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

        if (!active) return;
        setDetail(mainRow);
        setFabrics(fabricsWithDetails);
        setAccessories(accRows);
        setSample(sampleRows[0] || null);
        setTotalDo(totalDoVal);

      } catch (err) {
        if (!active) return;
        setErrorText(err?.message || 'Failed to load production detail.');
      } finally {
        if (active) setLoading(false);
      }
    }

    bootstrap();
    return function () { active = false; };
  }, [hostRecord?.id]);

  if (loading) {
    return React.createElement('div', { style: { padding: 80, textAlign: 'center' } },
      React.createElement(Spin, { size: 'large' })
    );
  }
  if (errorText) {
    return React.createElement('div', { style: { padding: 24 } },
      React.createElement(Text, { type: 'danger' }, errorText)
    );
  }

  const d = detail;
  const color = statusColor(d.status);
  const bg    = statusBg(d.status);

  const sectionTitle = {
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.08em', color: '#9ca3af', marginBottom: 12
  };

  const pill = (text, pillBg, textColor) =>
    React.createElement('span', {
      style: {
        display: 'inline-block', padding: '3px 10px', borderRadius: 999,
        fontSize: 11, fontWeight: 600, background: pillBg, color: textColor,
        letterSpacing: '0.04em'
      }
    }, text);

  const metaItem = (label, value) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
      React.createElement('div', { style: { fontSize: 11, color: '#9ca3af', fontWeight: 500 } }, label),
      React.createElement('div', { style: { fontSize: 13, color: '#111827', fontWeight: 500 } }, value || '-')
    );

  const card = (children, extraStyle) =>
    React.createElement('div', {
      style: Object.assign({
        borderRadius: 16, border: '1px solid #e5e7eb', background: '#fff',
        padding: '20px 24px', height: '100%'
      }, extraStyle || {})
    }, children);

  const matBadge = (status) => {
    const c = materialStatusColor(status);
    return React.createElement('span', {
      style: {
        display: 'inline-block', background: c + '22', color: c,
        border: '1px solid ' + c + '66', borderRadius: 3,
        padding: '0 6px', fontSize: 10, fontWeight: 600, lineHeight: '18px'
      }
    }, status || 'unknown');
  };

  const materialCard = React.createElement('div', null,
    React.createElement('div', { style: sectionTitle }, 'Materials'),

    fabrics.length > 0
      ? React.createElement('div', { style: { marginBottom: 16 } },
          React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Fabric'),
          fabrics.map((f, i) =>
            React.createElement('div', {
              key: i,
              style: {
                borderRadius: 8, border: '1px solid #f0f0f0', padding: '10px 12px',
                marginBottom: 8, background: '#fafafa'
              }
            },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
                React.createElement('div', { style: { fontWeight: 600, fontSize: 13, color: '#111827' } }, f.material_code || '—'),
                matBadge(f.status)
              ),
              renderNeed(buildNeed(f, false, d.planning_rol, totalDo)),
              f.yardDetails.length > 0
                ? React.createElement('div', null,
                    renderOutLine(
                      f.status,
                      f.yardDetails.length,
                      f.yardDetails.reduce((s, y) => s + Number(y || 0), 0),
                      'rol', 'yard', f.shipment_date
                    ),
                    renderOutChips(f.yardDetails)
                  )
                : null
            )
          )
        )
      : React.createElement('div', { style: { fontSize: 12, color: '#d1d5db', marginBottom: 16, fontStyle: 'italic' } }, 'No fabric records'),

    accessories.length > 0
      ? React.createElement('div', { style: { marginBottom: 16 } },
          React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Accessories'),
          accessories.map((a, i) =>
            React.createElement('div', {
              key: i,
              style: {
                borderRadius: 8, border: '1px solid #f0f0f0', padding: '10px 12px',
                marginBottom: 8, background: '#fafafa'
              }
            },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
                React.createElement('div', { style: { fontWeight: 600, fontSize: 13, color: '#111827' } }, a.material_code || '—'),
                matBadge(a.status)
              ),
              renderNeed(buildNeed(a, true, d.planning_rol, totalDo)),
              a.pcsDetails && a.pcsDetails.length > 0
                ? React.createElement('div', null,
                    renderOutLine(
                      a.status,
                      a.pcsDetails.length,
                      a.pcsDetails.reduce((s, p) => s + Number(p || 0), 0),
                      'pack', 'pcs', a.shipment_date
                    ),
                    renderOutChips(a.pcsDetails)
                  )
                : null
            )
          )
        )
      : React.createElement('div', { style: { fontSize: 12, color: '#d1d5db', marginBottom: 16, fontStyle: 'italic' } }, 'No accessories records'),

    React.createElement('div', null,
      React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Sample'),
      sample
        ? React.createElement('div', {
            style: {
              borderRadius: 8, border: '1px solid #f0f0f0', padding: '10px 12px', background: '#fafafa'
            }
          },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
              React.createElement('div', { style: { fontWeight: 600, fontSize: 13, color: '#111827' } }, sample.fk_sample_product_code || '—'),
              matBadge(sample.status)
            ),
            React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
              sample.status && sample.status.toLowerCase() === 'sent' && sample.shipment_date
                ? React.createElement('div', { style: { fontSize: 11, color: '#9ca3af' } },
                    'Sent: ' + (formatDate(sample.shipment_date) || '—')
                  )
                : null,
              sample.returned_date
                ? React.createElement('div', { style: { fontSize: 11, color: '#9ca3af' } },
                    'Returned: ' + (formatDate(sample.returned_date) || '—')
                  )
                : null
            )
          )
        : React.createElement('div', { style: { fontSize: 12, color: '#d1d5db', fontStyle: 'italic' } }, 'No sample record')
    )
  );

  return React.createElement('div', { style: { fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', gap: 12 } },

    React.createElement('div', {
      style: {
        borderRadius: 16, overflow: 'hidden',
        border: '1px solid ' + color + '55',
        boxShadow: '0 0 0 3px ' + color + '18'
      }
    },
      React.createElement('div', { style: { height: 5, background: color } }),
      React.createElement('div', { style: { padding: '20px 24px', background: '#fff' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 } },
          React.createElement('span', { style: { fontSize: 22, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' } },
            d.production_ref || ('#' + hostRecord.id)
          ),
          React.createElement('span', {
            style: {
              display: 'inline-block', padding: '3px 12px', borderRadius: 999,
              fontSize: 12, fontWeight: 600, background: bg, color: color,
              border: '1px solid ' + color + '44', letterSpacing: '0.04em'
            }
          }, statusLabel(d.status)),
          d.is_new ? pill('New', '#dcfce7', '#16a34a') : pill('Repeat', '#f3f4f6', '#6b7280')
        ),
        React.createElement('div', {
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px 24px' }
        },
          metaItem('Product code', d.product_code),
          metaItem('Product name', d.product_name),
          metaItem('Konveksi', d.konveksi_name)
        )
      )
    ),

    React.createElement(Row, { gutter: [12, 12] },
      React.createElement(Col, { xs: 24, md: 10 },
        card(React.createElement('div', null,
          React.createElement('div', { style: sectionTitle }, 'Product info'),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            metaItem('Product code', d.product_code),
            metaItem('Product name', d.product_name),
            metaItem('Konveksi', d.konveksi_name),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              React.createElement('div', { style: { fontSize: 11, color: '#9ca3af', fontWeight: 500 } }, 'Type'),
              d.is_new ? pill('New', '#dcfce7', '#16a34a') : pill('Repeat', '#f3f4f6', '#6b7280')
            )
          )
        ))
      ),
      React.createElement(Col, { xs: 24, md: 14 },
        card(materialCard)
      )
    ),

    React.createElement(Row, { gutter: [12, 12] },
      React.createElement(Col, { xs: 24, md: 12 },
        card(React.createElement('div', null,
          React.createElement('div', { style: sectionTitle }, 'Marker'),
          d.marker
            ? React.createElement('div', {style: { fontSize: 13, color: '#374151', lineHeight: 1.8 }, dangerouslySetInnerHTML: { __html: d.marker }})
            : React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40, color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No marker')
        ))
      ),
      React.createElement(Col, { xs: 24, md: 12 },
        card(React.createElement('div', null,
          React.createElement('div', { style: sectionTitle }, 'Remarks'),
          d.remarks
            ? React.createElement('div', {style: { fontSize: 13, color: '#374151', lineHeight: 1.8 },dangerouslySetInnerHTML: { __html: d.remarks }})
            : React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40, color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No remarks')
        ))
      )
    )
  );
};

ctx.render(React.createElement(ProductionDetailView));
