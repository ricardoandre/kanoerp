          ce(EditStyles, null),
          card('Details',  '#6366f1', detailsBody),
          card('Remarks',  '#0ea5e9', remarksBody),
          // was its own separate marker_remarks RichTextEditor — now
          // embeds ui_production_addmarker's MarkerContent directly (same
          // panel as the detail view's read-only version and the list's
          // "Modify Marker" quick action, but here fully editable): marker
          // notes at the top, then existing markers, reuse suggestions,
          // manual lookup, and add-new-marker below — see FIX note at the
          // top of this file for why the old duplicate editor was removed.
          card('Markers',  '#a855f7', ce(MarkerCardLoader, { id: id })),
          card('Quantity', '#84cc16', qtyBody),
          card('Materials','#f97316', matBody),
          ce('div', { style: { height: 24 } })
        )
  );
};

// =====================================================
// DUPLICATE — fetch a source production's template fields (product,
// konveksi, is_new, planning ROL, variant ratios) and open the New
// Production form pre-filled, so the user edits before saving. Nothing is
// written until Create is clicked — reuses createProduction, same as a
// normal Add. NOT copied: remarks, marker, quantity/cut_quantity (actual run
// figures), production_material (BOM), production_sample — BOM/sample are
// regenerated fresh by the on-insert workflow, same as any new production.
//
// 2026-07: no longer opened via a centered Modal.confirm popup — the caller
// (view_production.js's quick-action "Duplicate") now fetches this data and
// passes it to the list engine's helpers.openNewWithPrefill(), which opens
// the SAME right-side drawer as a normal "New Production" click, just
// prefilled. Same UI/experience either way, per feedback — the old inline
// Modal-hosted popup is removed; fetchDuplicateSource is exported directly.
// =====================================================
function fetchDuplicateSource(sourceId) {
  return Promise.all([
    runSql('pe_dupsrc_' + sourceId, "SELECT fk_product_code, fk_konveksi_code, is_new, planning_rol FROM production WHERE id = '" + sourceId + "'"),
    runSql('pe_dupqd_' + sourceId, "SELECT fk_sku_option_id AS sku_id, ratio FROM production_quantity_details WHERE fk_production_id = '" + sourceId + "' ORDER BY id ASC"),
  ]).then(function(r) {
    const rec = r[0][0];
    if (!rec) throw new Error('Source production not found.');
    return {
      product: rec.fk_product_code,
      konveksi: rec.fk_konveksi_code,
      is_new: rec.is_new === true || String(rec.is_new) === 'true' || rec.is_new === 1,
      rol: rec.planning_rol != null ? Number(rec.planning_rol) : null,
      variants: (r[1] || []).map(function(q) { return { sku: q.sku_id, ratio: q.ratio != null ? Number(q.ratio) : null }; }),
    };
  });
}

return { ProductionNewDrawer, ProductionEditDrawer, fetchDuplicateSource };
