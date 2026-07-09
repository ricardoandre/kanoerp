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
// --- single production_material record ---
const record = ctx.record;
if (!record || !record.id) { ctx.message.warning('No production material record found.'); return; }

const MO = await loadCode(ctx, 'ui_material_out');
await MO.openModal({ ctx: ctx, pmId: record.id, onSaved: () => { if (ctx.resource?.refresh) ctx.resource.refresh(); } });
