// =====================================================
// ui_record_nav — shared cross-record navigation host.
//
// Mount ONE RecordNav at a view root. It shows a production OR a
// production_material detail as a top-level drawer. Cross-links REPLACE (close
// current, open target), so navigation never stacks: production_ref ⇄ material
// row, back and forth indefinitely. Also hosts Edit + Delete for both types.
//
// EXPORTS:
//   RecordNav({ navRef })
//     navRef.open(type, id, helpers)  — type 'production' | 'material'.
//        Opens (or replaces) the detail for that record. `helpers` is the engine
//        helpers of the originating list (used to reload after edit/delete).
//
// Depends on: ui_production_detail, ui_production_material_detail, ui_production_edit.
// (No cycles: the detail rows bubble cross-links via callbacks, never load this.)
//
// NOTE (2026-07): loadCode converted from raw ctx.sql to ctx.api.resource() —
// ctx.sql.save() is admin/root-gated and silently fails per-record for other
// roles (see README §3). Do not revert to raw SQL.
// =====================================================
const ce = React.createElement;
const { useState, useEffect } = React;
const { Modal } = antd;

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

const RecordNav = function(props) {
  const navRef = props.navRef;
  const sC = useState(null);   const current = sC[0];    const setCurrent = sC[1];   // {type,id}
  const sE = useState(null);   const editT = sE[0];      const setEditT = sE[1];     // {type,id}
  const sH = useState(null);   const hlp = sH[0];        const setHlp = sH[1];
  const sR = useState(0);      const rk = sR[0];         const setRk = sR[1];
  const sPD = useState(null);  const PDMod = sPD[0];     const setPDMod = sPD[1];
  const sMD = useState(null);  const MDMod = sMD[0];     const setMDMod = sMD[1];
  const sPE = useState(null);  const PEMod = sPE[0];     const setPEMod = sPE[1];

  useEffect(function() {
    loadCode('ui_production_detail').then(setPDMod).catch(function() {});
    loadCode('ui_production_material_detail').then(setMDMod).catch(function() {});
    loadCode('ui_production_edit').then(setPEMod).catch(function() {});
    if (navRef) navRef.open = function(type, id, helpers) { setHlp(helpers || null); setEditT(null); setCurrent({ type: type, id: id }); };
    return function() { if (navRef) navRef.open = null; };
  }, []);

  function bump() { setRk(k => k + 1); }
  function afterMutate() { bump(); if (hlp && hlp.reload) hlp.reload(); }

  function deleteProduction(id) {
    Modal.confirm({ title: 'Delete production?', content: 'This production will be permanently deleted.', okText: 'Delete', okButtonProps: { danger: true },
      onOk: () => ctx.api.resource('production').destroy({ filterByTk: id }).then(() => { ctx.message.success('Production deleted.'); setCurrent(null); afterMutate(); }).catch(e => ctx.message.error('Delete failed: ' + ((e && e.message) || e))) });
  }
  function deleteMaterial(id) {
    Modal.confirm({ title: 'Delete production material?', content: 'This material will be permanently deleted.', okText: 'Delete', okButtonProps: { danger: true },
      onOk: () => ctx.api.resource('production_material').destroy({ filterByTk: id }).then(() => { ctx.message.success('Material deleted.'); setCurrent(null); afterMutate(); }).catch(e => ctx.message.error('Delete failed: ' + ((e && e.message) || e))) });
  }

  const isProd = current && current.type === 'production';
  const isMat = current && current.type === 'material';

  return ce('div', null,
    PDMod ? ce(PDMod.ProductionDetailDrawer, {
      open: !!isProd, productionId: isProd ? current.id : null, refreshKey: rk, zIndex: 1050,
      onClose: () => setCurrent(null),
      onEdit: (id) => setEditT({ type: 'production', id: id }),
      onDelete: (id) => deleteProduction(id),
      onOpenMaterial: (pmId) => setCurrent({ type: 'material', id: pmId }),
    }) : null,
    MDMod ? ce(MDMod.ProductionMaterialDetailDrawer, {
      open: !!isMat, pmId: isMat ? current.id : null, refreshKey: rk, zIndex: 1050,
      onClose: () => setCurrent(null),
      onEdit: (id) => setEditT({ type: 'material', id: id }),
      onDelete: (id) => deleteMaterial(id),
      onOpenProduction: (productionId) => setCurrent({ type: 'production', id: productionId }),
      onChanged: () => bump(),
    }) : null,
    PEMod ? ce(PEMod.ProductionEditDrawer, {
      open: !!(editT && editT.type === 'production'), productionId: editT && editT.type === 'production' ? editT.id : null,
      onClose: () => setEditT(null),
      onSaved: function() { setEditT(null); afterMutate(); },
    }) : null,
    MDMod ? ce(MDMod.MaterialEditDrawer, {
      open: !!(editT && editT.type === 'material'), pmId: editT && editT.type === 'material' ? editT.id : null,
      onClose: () => setEditT(null),
      onSaved: function() { setEditT(null); afterMutate(); },
    }) : null
  );
};

return { RecordNav };
