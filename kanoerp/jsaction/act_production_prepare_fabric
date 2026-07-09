const _codeCache = {};
async function loadCode(ctx, name) {
  if (_codeCache[name]) return _codeCache[name];
  const { React, antd, dayjs } = ctx.libs;
  const res = await ctx.api.resource('source_code').list({
    filter: { name: name },
    fields: ['code'],
    pageSize: 1,
  });
  const rows = res?.data?.data || [];
  const src = (rows[0] && rows[0].code) || '';
  _codeCache[name] = new Function('React', 'antd', 'dayjs', 'ctx', src)(React, antd, dayjs, ctx);
  return _codeCache[name];
}
// --- selection (your working path) ---
const selectedRows = ctx.resource?.getSelectedRows?.() || [];
if (!selectedRows.length) { ctx.message.warning('Please select at least one production record.'); return; }
const ids = selectedRows.map(r => r.id).filter(Boolean);
if (!ids.length) { ctx.message.warning('Selected rows have no valid ID.'); return; }
// --- shared logic ---
const PF = await loadCode(ctx, 'ui_prepare_fabric');
const data = await PF.fetchFabricRows(ctx, ids);
if (!data.length) { ctx.message.warning('No fabric records found for selected production rows.'); return; }
await PF.openFabricModal(data, selectedRows.length);
