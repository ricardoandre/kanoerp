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
