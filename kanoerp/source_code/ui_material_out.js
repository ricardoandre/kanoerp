// ui_material_out — shared Material Out logic + UI.
// Input:  openModal({ ctx, pmId, onSaved })   — opens entry modal (instant), writes ledger on save
//         fetchSummary(ctx, pmId)              — returns { materialCode, isAcc, ledgerRows } | null | {error}
//           ledgerRows[i] = { ledger_id, transaction_date, status, count, total_amount, details:[num,...] }
//         renderSummary(data)                  — simple totals box: "date (x rol)" .... "y yard" per entry,
//                                                  same label/value pairing as the grand-total row.
//         renderDetails(data, { onCancel })    — transaction-list view: one row per entry (status dot, date,
//                                                  amount, Cancel when requested) with the roll/pack breakdown
//                                                  indented underneath. onCancel(ledgerId) fires the Cancel
//                                                  button (shown only on 'requested' rows).
//         cancelLedger(ctx, ledgerId, onDone)  — confirms, then sets material_ledger.status = 'cancelled'
//         isAccType(type)                      — bool
//
// material_ledger.status lifecycle: requested (default on create) → confirmed | cancelled.
// Cancelled entries stay visible (dimmed/struck) for audit trail but are excluded from totals.
//
// Button vs. tag convention (kept consistent with ui_production_material_details):
//   clickable actions  → solid fill, white text, no border, subtle shadow (BTN_* below)
//   status/type tags   → soft tinted background, no border, no shadow, cursor default
// Depends on: none.

const { useState, useEffect } = React;
const { Modal } = antd;
const ce = React.createElement;

const BTN_DANGER = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  border: 'none', borderRadius: 6, padding: '3px 11px',
  fontSize: 11, fontWeight: 700, color: '#fff', background: '#dc2626',
  cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
};

function isAccType(matType) {
  const t = String(matType || '').toLowerCase();
  return t.indexOf('access') !== -1 || t.indexOf('aks') !== -1;
}

function ledgerStatusColor(s) {
  s = String(s || 'requested').toLowerCase();
  if (s === 'confirmed') return '#22c55e';
  if (s === 'cancelled') return '#ef4444';
  return '#f97316'; // requested (default)
}
function ledgerStatusLabel(s) {
  s = String(s || 'requested').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function runSql(ctx, uid, sql) {
  if (ctx.flowSettingsEnabled) {
    await ctx.sql.save({ uid, sql, dataSourceKey: 'main' }).catch(() => {});
  }
  return ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' })
    .then(r => r || []).catch(() => []);
}

async function fetchSummary(ctx, productionMaterialId) {
  const pmRows = await runSql(ctx, 'pm_out_lookup_' + productionMaterialId,
    "SELECT pm.id, pm.fk_material_details_code, rm.type AS mat_type " +
    "FROM production_material pm " +
    "LEFT JOIN material_details md ON md.code = pm.fk_material_details_code " +
    "LEFT JOIN raw_material rm ON rm.code = md.fk_material_code " +
    "WHERE pm.id = '" + productionMaterialId + "'"
  );
  if (!pmRows.length) return null;
  const materialCode = pmRows[0].fk_material_details_code;
  if (!materialCode) return { error: 'no_material_code' };

  const isAcc = isAccType(pmRows[0].mat_type);

  const ledgerHeaderRows = await runSql(ctx, 'pm_out_ledger_hdr_' + productionMaterialId,
    "SELECT id, transaction_date, status FROM material_ledger " +
    "WHERE fk_production_material_id = '" + productionMaterialId + "' " +
    "ORDER BY transaction_date DESC"
  );
  const ledgerIds = ledgerHeaderRows.map(r => r.id).filter(Boolean);

  // raw detail values (not just aggregate) so each entry can show its roll/pack breakdown.
  let ledgerDetailRows = [];
  if (ledgerIds.length) {
    ledgerDetailRows = await runSql(ctx, 'pm_out_ledger_det_' + productionMaterialId,
      "SELECT fk_material_ledger_id AS ledger_id, details " +
      "FROM material_ledger_details " +
      "WHERE fk_material_ledger_id IN (" + ledgerIds.join(',') + ") " +
      "ORDER BY id ASC"
    );
  }
  const valuesByLedger = {};
  ledgerDetailRows.forEach(r => {
    const key = String(r.ledger_id);
    (valuesByLedger[key] = valuesByLedger[key] || []).push(Number(r.details) || 0);
  });

  const ledgerRows = ledgerHeaderRows.map(r => {
    const vals = valuesByLedger[String(r.id)] || [];
    return {
      ledger_id: r.id,
      transaction_date: r.transaction_date,
      status: r.status || 'requested',
      count: vals.length,
      total_amount: vals.reduce((s, v) => s + v, 0),
      details: vals,
    };
  });

  return { materialCode, isAcc, ledgerRows };
}

// ===== simple totals box — "date (x rol)" .... "y yard", same shape as the grand total =====
function renderSummary(data) {
  if (!data || data.error || !data.ledgerRows || !data.ledgerRows.length) {
    return ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' } }, 'No material out');
  }
  const unitItem = data.isAcc ? 'pack' : 'rol';
  const unitTotal = data.isAcc ? 'pcs' : 'yard';
  const activeRows = data.ledgerRows.filter(h => String(h.status || 'requested').toLowerCase() !== 'cancelled');
  const grand = activeRows.reduce((s, h) => s + (Number(h.total_amount) || 0), 0);
  const grandCount = activeRows.reduce((s, h) => s + (Number(h.count) || 0), 0);

  return ce('div', { style: { padding: '8px 10px', background: '#f8fafc', borderRadius: 6, border: '1px solid #f1f5f9' } },
    ce('div', { style: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3af', marginBottom: 6 } }, 'Summary'),
    ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
      data.ledgerRows.map((h, i) => {
        const cancelled = String(h.status || 'requested').toLowerCase() === 'cancelled';
        return ce('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: cancelled ? 0.5 : 1 } },
          ce('span', { style: { color: '#64748b' } },
            String(h.transaction_date || '').substring(0, 10) + ' (' + (Number(h.count) || 0) + ' ' + unitItem + ')'),
          ce('span', { style: { fontWeight: 600, color: '#166534', textDecoration: cancelled ? 'line-through' : 'none' } },
            (Number(h.total_amount) || 0) + ' ' + unitTotal)
        );
      })
    ),
    ce('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6, paddingTop: 6, borderTop: '1px solid #e2e8f0' } },
      ce('span', { style: { color: '#475569', fontWeight: 600 } }, 'Total (' + grandCount + ' ' + unitItem + ')'),
      ce('span', { style: { fontWeight: 700, color: '#166534' } }, grand + ' ' + unitTotal)
    )
  );
}

// ===== transaction-list view: one row per entry, breakdown indented, status + cancel =====
function renderDetails(data, opts) {
  opts = opts || {};
  const onCancel = opts.onCancel;
 
  if (!data || data.error || !data.ledgerRows || !data.ledgerRows.length) {
    return ce('div', { style: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic', padding: '10px 2px' } }, 'No material out yet');
  }
  const unitItem = data.isAcc ? 'pack' : 'rol';
  const unitTotal = data.isAcc ? 'pcs' : 'yard';
  const rows = data.ledgerRows;
 
  return ce('div', { style: { display: 'flex', flexDirection: 'column' } },
    rows.map((h, i) => {
      const st = String(h.status || 'requested').toLowerCase();
      const cancelled = st === 'cancelled';
      const sc = ledgerStatusColor(st);
      const details = h.details || [];
      const isLast = i === rows.length - 1;
 
      return ce('div', {
        key: i,
        style: {
          padding: '10px 2px',
          borderBottom: isLast ? 'none' : '1px solid #f1f5f9',
          opacity: cancelled ? 0.55 : 1,
        }
      },
        ce('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: details.length ? 5 : 0 } },
          ce('div', { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 } },
            ce('span', { style: { width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0, display: 'inline-block' } }),
            ce('span', { style: { fontSize: 12, color: '#374151', fontWeight: 600, whiteSpace: 'nowrap' } }, String(h.transaction_date || '').substring(0, 10)),
            // status: plain colored text, no background/border — not a button
            ce('span', {
              style: {
                fontSize: 10, color: sc, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em',
                textDecoration: cancelled ? 'line-through' : 'none', cursor: 'default',
              }
            }, ledgerStatusLabel(st))
          ),
          ce('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 } },
            ce('span', {
              style: { fontSize: 14, fontWeight: 700, color: cancelled ? '#9ca3af' : '#166534', textDecoration: cancelled ? 'line-through' : 'none', whiteSpace: 'nowrap' }
            }, (Number(h.count) || 0) + ' ' + unitItem + ' (' + (Number(h.total_amount) || 0) + ' ' + unitTotal + ')'),
            // cancel: solid fill button — visually distinct from the plain status text above
            (st === 'requested' && onCancel)
              ? ce('button', { onClick: () => onCancel(h.ledger_id), style: BTN_DANGER }, 'Cancel')
              : null
          )
        ),
        details.length
          ? ce('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 14 } },
              details.map((v, j) => ce('span', {
                key: j,
                style: { fontSize: 11, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, padding: '1px 6px', cursor: 'default' }
              }, v + ' ' + unitTotal))
            )
          : null
      );
    })
  );
}

// ===== cancel a requested ledger entry =====
function cancelLedger(ctx, ledgerId, onDone) {
  if (!ctx || !ledgerId) return;
  Modal.confirm({
    title: 'Cancel this material out entry?',
    content: 'The entry stays on record but will be marked cancelled and excluded from totals. This cannot be undone from here.',
    okText: 'Cancel entry',
    okButtonProps: { danger: true },
    cancelText: 'Back',
    onOk: function () {
      return ctx.api.resource('material_ledger').update({
        filterByTk: ledgerId,
        values: { status: 'cancelled' },
      }).then(function () {
        ctx.message.success('Material out entry cancelled.');
        if (onDone) onDone();
      }).catch(function (e) {
        ctx.message.error('Cancel failed: ' + ((e && e.message) || e));
      });
    },
  });
}

// ===== entry modal (per-record data via props) =====
function MaterialOutContent(props) {
  const ctx = props.ctx;
  const materialCode = props.materialCode;
  const productionMaterialId = props.productionMaterialId;
  const UNIT_ITEM = props.unitItem;
  const UNIT_TOTAL = props.unitTotal;
  const todayStr = props.todayStr;
  const ledgerHistory = (props.ledgerHistory || []).filter(h => String(h.status || 'requested').toLowerCase() !== 'cancelled');
  const onSaved = props.onSaved;

  const [transactionDate, setTransactionDate] = useState(todayStr);
  const [cells, setCells] = useState(['', '', '']);
  const [saving, setSaving] = useState(false);
  const inputRefs = React.useRef([]);

  function handleClose() { Modal.destroyAll(); }

  function updateCell(index, value) {
    setCells(prev => {
      const next = [...prev];
      next[index] = value;
      if (index === next.length - 1 && value !== '') next.push('');
      return next;
    });
  }

  function handleKeyDown(e, index) {
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      const nextIndex = index + 1;
      if (inputRefs.current[nextIndex]) inputRefs.current[nextIndex].focus();
    } else if (e.key === 'Backspace' && cells[index] === '' && index > 0) {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
    }
  }

  function removeCell(index) {
    setCells(prev => {
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : [''];
    });
  }

  const validItems = cells.map(c => parseFloat(c)).filter(n => !isNaN(n) && n > 0);
  const totalAmount = validItems.reduce((sum, n) => sum + n, 0);

  async function handleSave() {
    if (!transactionDate) { ctx.message.warning('Please select a transaction date.'); return; }
    if (!validItems.length) { ctx.message.warning('Please enter at least one valid ' + UNIT_TOTAL + ' value.'); return; }
    setSaving(true);
    try {
      const ledgerRes = await ctx.api.resource('material_ledger').create({
        values: {
          fk_material_code: materialCode,
          fk_production_material_id: productionMaterialId,
          type: 'out',
          transaction_date: transactionDate,
          purpose: 'production',
          status: 'requested',
        }
      });
      const ledgerId = ledgerRes?.data?.data?.id;
      if (!ledgerId) throw new Error('Failed to retrieve created material_ledger id.');

      for (const amountValue of validItems) {
        await ctx.api.resource('material_ledger_details').create({
          values: { fk_material_ledger_id: ledgerId, details: amountValue }
        });
      }

      Modal.destroyAll();
      ctx.notification.success({
        message: 'Material Out Recorded',
        description: validItems.length + ' ' + UNIT_ITEM + '(s) totaling ' + totalAmount + ' ' + UNIT_TOTAL + ' saved as requested.',
        duration: 6,
      });
      if (onSaved) onSaved();
    } catch (e) {
      console.error('Save error:', e);
      setSaving(false);
      ctx.message.error('Failed to save: ' + (e.message || 'unknown error'));
    }
  }

  return ce('div', { style: { fontFamily: 'system-ui,sans-serif', fontSize: 13 } },
    ce('div', { style: { color: '#888', fontSize: 12, marginBottom: 10 } }, 'Material: ' + materialCode),

    ledgerHistory.length > 0
      ? ce('div', { style: { marginBottom: 16, padding: '8px 10px', background: '#f8fafc', borderRadius: 6, border: '1px solid #f1f5f9' } },
          ce('div', { style: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3af', marginBottom: 6 } }, 'Previous Material Out'),
          ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
            ledgerHistory.map((h, i) =>
              ce('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', fontSize: 12 } },
                ce('span', { style: { color: '#64748b' } }, String(h.transaction_date || '').substring(0, 10)),
                ce('span', { style: { fontWeight: 600, color: '#166534' } }, (Number(h.total_amount) || 0) + ' ' + UNIT_TOTAL)
              )
            )
          ),
          ce('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6, paddingTop: 6, borderTop: '1px solid #e2e8f0' } },
            ce('span', { style: { color: '#475569', fontWeight: 600 } }, 'Total so far'),
            ce('span', { style: { fontWeight: 700, color: '#166534' } }, ledgerHistory.reduce((sum, h) => sum + (Number(h.total_amount) || 0), 0) + ' ' + UNIT_TOTAL)
          )
        )
      : null,

    ce('div', { style: { marginBottom: 14 } },
      ce('label', { style: { display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3af', marginBottom: 4 } }, 'Transaction Date'),
      ce('input', {
        type: 'date', value: transactionDate,
        onChange: (e) => setTransactionDate(e.target.value),
        onClick: (e) => { try { e.currentTarget.showPicker(); } catch (err) {} },
        style: { width: '100%', height: 36, padding: '0 10px', fontSize: 13, border: '1px solid #d9d9d9', borderRadius: 4, outline: 'none', boxSizing: 'border-box', background: '#fff', cursor: 'pointer' }
      })
    ),

    ce('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 1, border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden', marginBottom: 14, background: '#d9d9d9' } },
      cells.map((val, i) =>
        ce('div', { key: i, style: { position: 'relative', background: '#fff' } },
          ce('input', {
            ref: (el) => { inputRefs.current[i] = el; },
            type: 'number', step: 'any', value: val,
            onChange: (e) => updateCell(i, e.target.value),
            onKeyDown: (e) => handleKeyDown(e, i),
            placeholder: '—',
            style: { width: '100%', height: 40, padding: '0 8px', fontSize: 13, border: 'none', outline: 'none', textAlign: 'center', boxSizing: 'border-box', background: 'transparent' }
          }),
          val !== '' && cells.length > 1
            ? ce('button', { onClick: () => removeCell(i), style: { position: 'absolute', top: 1, right: 1, border: 'none', background: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 10, padding: 0, lineHeight: 1 } }, '✕')
            : null
        )
      )
    ),

    ce('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid #eee', marginBottom: 14 } },
      ce('span', { style: { fontSize: 12, color: '#888' } }, validItems.length + ' ' + UNIT_ITEM + '(s)'),
      ce('span', { style: { fontSize: 14, fontWeight: 700, color: '#166534' } }, 'Total: ' + totalAmount + ' ' + UNIT_TOTAL)
    ),

    ce('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
      ce('button', { onClick: handleClose, style: { padding: '5px 14px', fontSize: 12, cursor: 'pointer', border: '1px solid #d9d9d9', borderRadius: 4, background: '#fff' } }, 'Cancel'),
      ce('button', {
        onClick: handleSave, disabled: saving || !validItems.length,
        style: { padding: '5px 16px', fontSize: 12, cursor: (saving || !validItems.length) ? 'not-allowed' : 'pointer', border: 'none', borderRadius: 4, fontWeight: 600, color: '#fff', background: (saving || !validItems.length) ? '#d9d9d9' : '#22c55e' }
      }, saving ? 'Saving…' : 'Create Material Out')
    )
  );
}

// ===== loader: opens instantly, fetches inside the modal =====
function MaterialOutLoader(props) {
  const ctx = props.ctx;
  const pmId = props.pmId;
  const onSaved = props.onSaved;
  const [state, setState] = useState({ loading: true, summary: null, err: null });

  useEffect(function() {
    let alive = true;
    fetchSummary(ctx, pmId)
      .then(function(s) { if (alive) setState({ loading: false, summary: s, err: null }); })
      .catch(function(e) { if (alive) setState({ loading: false, summary: null, err: (e && e.message) || 'load failed' }); });
    return function() { alive = false; };
  }, [pmId]);

  if (state.loading) {
    return ce('div', { style: { padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 } }, 'Loading…');
  }
  const s = state.summary;
  if (!s) {
    return ce('div', { style: { padding: 24, color: '#ef4444', fontSize: 13 } }, state.err || 'Could not load production material info.');
  }
  if (s.error === 'no_material_code') {
    return ce('div', { style: { padding: 24, color: '#ef4444', fontSize: 13 } }, 'This production material has no material code set.');
  }

  const isAcc = s.isAcc;
  const todayStr = dayjs ? dayjs().format('YYYY-MM-DD') : new Date().toISOString().substring(0, 10);
  return ce(MaterialOutContent, {
    ctx: ctx,
    materialCode: s.materialCode,
    productionMaterialId: pmId,
    unitItem: isAcc ? 'pack' : 'rol',
    unitTotal: isAcc ? 'pcs' : 'yard',
    todayStr: todayStr,
    ledgerHistory: s.ledgerRows,
    onSaved: onSaved,
  });
}

// ===== entry point: opens modal immediately, loader fetches inside =====
function openModal(args) {
  const ctx = args.ctx;
  const pmId = args.pmId;
  const onSaved = args.onSaved;

  if (!ctx) { return; }
  if (!pmId) { ctx.message.warning('No production material record found.'); return; }

  Modal.confirm({
    title: 'Record Material Out',
    width: 480,
    icon: null,
    content: ce(MaterialOutLoader, { ctx: ctx, pmId: pmId, onSaved: onSaved }),
    okButtonProps: { style: { display: 'none' } },
    cancelButtonProps: { style: { display: 'none' } },
    maskClosable: true,
    onCancel() {},
  });
}

return { openModal, fetchSummary, renderSummary, renderDetails, cancelLedger, isAccType };
