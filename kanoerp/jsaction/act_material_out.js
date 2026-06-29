const _codeCache = {};
async function loadCode(ctx, name) {
  if (_codeCache[name]) return _codeCache[name];
  const { React, antd, dayjs } = ctx.libs;
  const uid = 'code_' + name;
  const rows = await ctx.sql.save({ uid, dataSourceKey: 'main',
    sql: "SELECT code FROM source_code WHERE name='" + name + "'" })
    .then(() => ctx.sql.runById(uid, { type: 'selectRows', dataSourceKey: 'main' }));
  const src = (rows && rows[0] && rows[0].code) || '';
  _codeCache[name] = new Function('React','antd','dayjs','ctx', src)(React, antd, dayjs, ctx);
  return _codeCache[name];
}

// --- single production_material record ---
const record = ctx.record;
if (!record || !record.id) { ctx.message.warning('No production material record found.'); return; }

const MO = await loadCode(ctx, 'ui_material_out');
await MO.openModal({ ctx: ctx, pmId: record.id, onSaved: () => { if (ctx.resource?.refresh) ctx.resource.refresh(); } });