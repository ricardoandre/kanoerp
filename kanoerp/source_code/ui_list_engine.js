// =====================================================
// ui_list_engine.js  —  config-driven list-view ENGINE
//
// Store as a `source_code` row named 'kano_listview'.
// Load + use from any view:
//
//   const LV = await loadCode('kano_listview');
//   ctx.render(ce(LV.createListView(config)));
//
// The engine owns all the REUSABLE wiring (search · main tabs · secondary
// filter popup · sort · pagination · selection + bulk · swipe cards · detail
// accordion drawer · new/edit drawer SHELL). The view supplies a CONFIG object
// describing only the DOMAIN bits — see the contract at the bottom.
//
// Deliberately NOT abstracted (stays in each view's config): status colors,
// SQL, card layout, which sections/fields exist. The engine abstracts wiring,
// the view supplies meaning.
//
// loadCode injects (React, antd, dayjs, ctx). Ends with `return {...}`.
// =====================================================
const ce = React.createElement;
const { useState, useEffect, useMemo, useRef } = React;
const { Modal, Drawer, Select, DatePicker, Spin, message, Dropdown, Pagination } = antd;
const { RangePicker } = DatePicker;

function num(v) { return Number(v == null ? 0 : v); }
function uniq(a) { const out = [], seen = {}; a.forEach(x => { if (x == null) return; const k = String(x); if (!seen[k]) { seen[k] = 1; out.push(x); } }); return out; }
function inDateBound(dateStr, range) {
  if (!range || (!range[0] && !range[1])) return true;
  if (!dateStr) return false;
  const d = dayjs(dateStr);
  if (range[0] && d.isBefore(range[0], 'day')) return false;
  if (range[1] && d.isAfter(range[1], 'day')) return false;
  return true;
}

const BASE_CSS =
  ".kano-root *{box-sizing:border-box;}" +
  ".kano-root .kano-cardwrap{position:relative;overflow:hidden;border-radius:14px;margin-bottom:10px;background:#fee2e2;}" +
  ".kano-root .kano-card{position:relative;z-index:2;background:#fff;border:1px solid #e5e7eb;border-radius:14px;transition:transform .18s ease;touch-action:pan-y;}" +
  ".kano-root .kano-actions{position:absolute;top:0;right:0;height:100%;display:flex;z-index:1;}" +
  ".kano-root .kano-actbtn{width:70px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;border:none;}" +
  ".kano-root .kano-searchrow{display:flex;gap:8px;align-items:center;margin-bottom:12px;}" +
  ".kano-root .kano-tabs{display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;margin-bottom:14px;padding-bottom:2px;-webkit-overflow-scrolling:touch;scrollbar-width:none;}" +
  ".kano-root .kano-tabs::-webkit-scrollbar{display:none;}" +
  ".kano-root .kano-tabs > button{flex-shrink:0;}" +
  ".kano-sortlabel{display:none;}" +
  ".kano-detail-drawer .ant-drawer-content-wrapper{width:min(900px,92vw) !important;}" +
  "@media (max-width:700px){.kano-detail-drawer .ant-drawer-content-wrapper{width:100% !important;}}" +
  ".kano-edit-drawer .ant-drawer-content-wrapper{width:min(560px,100vw) !important;}" +
  "@media (max-width:700px){.kano-edit-drawer .ant-drawer-content-wrapper{width:100% !important;}}";

// ── small shared chrome (pure) ──
function SearchBar(p) {
  return ce('div', { style: { flex: 1, position: 'relative', display: 'flex', alignItems: 'center' } },
    ce('input', { value: p.value, onChange: e => p.onChange(e.target.value), placeholder: p.placeholder || 'Search…',
      style: { width: '100%', padding: '9px 32px 9px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none' } }),
    p.value ? ce('button', { onClick: () => p.onChange(''), title: 'Clear', style: { position: 'absolute', right: 6, border: 'none', background: '#f1f5f9', color: '#64748b', borderRadius: 999, width: 20, height: 20, cursor: 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, '×') : null);
}
function MainFilter(p) {
  return ce('div', { className: 'kano-tabs' }, p.tabs.map(function(t) {
    const active = p.value === t.key;
    const c = t.color || '#64748b';
    const bg = t.bg || (t.key === 'all' ? '#f8fafc' : c + '14');
    return ce('button', { key: t.key, onClick: () => p.onChange(t.key),
      style: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 20, border: '1.5px solid ' + (active ? c : '#e5e7eb'), background: active ? bg : '#fff', color: active ? c : '#64748b', fontWeight: active ? 700 : 500, fontSize: 12, cursor: 'pointer' } },
      t.label, ce('span', { style: { background: active ? c : '#e5e7eb', color: active ? '#fff' : '#64748b', borderRadius: 20, padding: '0 6px', fontSize: 11, fontWeight: 700 } }, t.count != null ? t.count : 0));
  }));
}
function FilterButton(p) {
  const a = p.activeCount;
  return ce('button', { onClick: p.onClick, style: { position: 'relative', flexShrink: 0, width: 40, height: 40, borderRadius: 10, border: '1.5px solid ' + (a ? '#6366f1' : '#e5e7eb'), background: a ? '#eef2ff' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
    ce('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none' }, ce('path', { d: 'M4 5h16l-6 8v5l-4 2v-7L4 5z', stroke: a ? '#4338ca' : '#64748b', strokeWidth: 1.6, strokeLinejoin: 'round' })),
    a ? ce('span', { style: { position: 'absolute', top: -5, right: -5, background: '#6366f1', color: '#fff', borderRadius: 999, minWidth: 16, height: 16, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' } }, a) : null);
}
function SortButton(p) {
  if (!p.options || !p.options.length) return null;
  const active = p.value !== p.options[0].key;
  const current = (p.options.find(o => o.key === p.value) || p.options[0]).label;
  const menu = { selectable: true, selectedKeys: [p.value], items: p.options.map(o => ({ key: o.key, label: o.label })), onClick: e => p.onChange(e.key) };
  return ce(Dropdown, { menu: menu, trigger: ['click'], placement: 'bottomRight' },
    ce('button', { title: 'Sort', style: { display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, height: 40, padding: '0 12px', borderRadius: 10, border: '1.5px solid ' + (active ? '#6366f1' : '#e5e7eb'), background: active ? '#eef2ff' : '#fff', color: active ? '#4338ca' : '#64748b', fontSize: 13, fontWeight: 600, cursor: 'pointer' } },
      ce('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none' }, ce('path', { d: 'M7 20V4M4 7l3-3 3 3M17 4v16M14 17l3 3 3-3', stroke: active ? '#4338ca' : '#64748b', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' })),
      ce('span', { className: 'kano-sortlabel' }, current)));
}
function AccordionItem(p) {
  return ce('div', { style: { borderTop: '1px solid #f1f5f9' } },
    ce('div', { onClick: p.onToggle, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 4px', cursor: 'pointer', userSelect: 'none' } },
      ce('span', { style: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: p.open ? '#0f172a' : '#64748b' } }, p.title),
      ce('span', { style: { display: 'inline-block', color: '#94a3b8', fontSize: 18, transform: p.open ? 'rotate(90deg)' : 'none', transition: 'transform .2s' } }, '›')),
    p.open ? ce('div', { style: { padding: '0 4px 18px' } }, p.children) : null);
}

// reusable message box rendered below the list title. config.banner(data) may
// return null, a string, a { type:'warning'|'info'|'error'|'success', text }
// object, or a ready-made React element.
const BANNER_PALETTE = {
  warning: { bg: '#fffbeb', border: '#fcd34d', color: '#92400e', icon: '⚠' },
  info:    { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af', icon: 'ℹ' },
  error:   { bg: '#fef2f2', border: '#fca5a5', color: '#991b1b', icon: '⛔' },
  success: { bg: '#f0fdf4', border: '#bbf7d0', color: '#166534', icon: '✓' },
};
function renderBanner(b) {
  if (!b) return null;
  if (React.isValidElement(b)) return b;
  const isObj = (typeof b === 'object' && b !== null);
  const type = isObj && b.type ? b.type : 'warning';
  const text = isObj ? b.text : b;
  const p = BANNER_PALETTE[type] || BANNER_PALETTE.warning;
  return ce('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 8, background: p.bg, border: '1px solid ' + p.border, color: p.color, borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 13, lineHeight: 1.5 } },
    ce('span', { style: { flexShrink: 0 } }, p.icon),
    ce('span', null, text));
}

// =====================================================
// FACTORY
// =====================================================
function createListView(config) {
  const PAGE_SIZE = config.pageSize || 15;
  const getId = config.getRowId || (r => r.id);
  const sortOptions = config.sortOptions || [{ key: 'created_desc', label: 'Newest' }];
  const filterDefs = config.secondaryFilters || [];

  // ── secondary filter popup (declarative) ──
  function FilterPopup(p) {
    const sv = useState(p.values); const vals = sv[0]; const setVals = sv[1];
    useEffect(function() { if (p.open) setVals(p.values); }, [p.open]);
    function setOne(k, v) { setVals(prev => Object.assign({}, prev, { [k]: v })); }
    const label = t => ce('div', { style: { fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' } }, t);
    function control(f) {
      if (f.kind === 'dateRange')
        return ce(RangePicker, { allowEmpty: [true, true], value: vals[f.key] || null, onChange: v => setOne(f.key, v), format: f.format || 'DD/MM/YYYY', style: { width: '100%' } });
      if (f.multi) {
        const mopts = (p.options[f.key] || []).map(o => (typeof o === 'object' ? o : { value: o, label: f.optionLabel ? f.optionLabel(o) : o }));
        return ce(Select, { mode: 'multiple', allowClear: true, showSearch: f.search !== false, value: vals[f.key] || [], onChange: v => setOne(f.key, v), style: { width: '100%' }, placeholder: f.placeholder || ('Any ' + String(f.label || f.key).toLowerCase()), filterOption: (i, o) => String(o.label).toLowerCase().includes(i.toLowerCase()), options: mopts });
      }
      const opts = [{ value: 'all', label: f.allLabel || ('All ' + (f.label || f.key).toLowerCase()) }].concat((p.options[f.key] || []).map(o => (typeof o === 'object' ? o : { value: o, label: f.optionLabel ? f.optionLabel(o) : o })));
      return ce(Select, { showSearch: !!f.search, value: vals[f.key] != null ? vals[f.key] : 'all', onChange: v => setOne(f.key, v), style: { width: '100%' }, filterOption: (i, o) => String(o.label).toLowerCase().includes(i.toLowerCase()), options: opts });
    }
    function clearAll() { const z = {}; filterDefs.forEach(f => { z[f.key] = f.kind === 'dateRange' ? null : (f.multi ? [] : 'all'); }); setVals(z); }
    return ce(Modal, {
      open: p.open, title: 'Filters', onCancel: p.onClose, width: 420,
      footer: ce('div', { style: { display: 'flex', justifyContent: 'space-between' } },
        ce('button', { onClick: clearAll, style: { border: 'none', background: 'transparent', color: '#ef4444', fontSize: 13, fontWeight: 600, cursor: 'pointer' } }, 'Clear all'),
        ce('button', { onClick: () => p.onApply(vals), style: { background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' } }, 'Apply')),
    }, ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 } },
      filterDefs.map(f => ce('div', { key: f.key }, label(f.label || f.key), control(f))),
      ce('div', { style: { height: 8 } })));
  }

  // ── selection bar ──
  function SelectionBar(p) {
    const n = p.count;
    const btn = (label, bg, color, onClick, disabled) => ce('button', { onClick, disabled, style: { border: 'none', background: bg, color, borderRadius: 10, padding: '0 14px', height: 40, fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap' } }, label);
    return ce('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' } },
      ce('div', { style: { fontSize: 15, fontWeight: 800, color: '#4338ca' } }, n + ' selected'),
      ce('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        (config.bulkActions || []).map((a, i) => btn(a.label, a.bg || '#0ea5e9', a.color || '#fff', () => a.run(p.selectedIds, p.helpers), n === 0 && a.requireSelection !== false)),
        btn('Cancel', '#f1f5f9', '#475569', p.onCancel, false)));
  }

  // ── swipe card frame ──
  function Card(p) {
    const row = p.row;
    const selectMode = p.selectMode, selected = p.selected;
    const sx = useState(0); const dx = sx[0]; const setDx = sx[1];
    const startRef = useRef(0); const REVEAL = 140;
    useEffect(function() { if (selectMode) setDx(0); }, [selectMode]);
    function onStart(e) { if (selectMode) return; startRef.current = e.touches[0].clientX - dx; }
    function onMove(e) { if (selectMode) return; let nx = e.touches[0].clientX - startRef.current; if (nx > 0) nx = 0; if (nx < -REVEAL) nx = -REVEAL; setDx(nx); }
    function onEnd() { if (selectMode) return; setDx(dx < -REVEAL / 2 ? -REVEAL : 0); }
    return ce('div', { className: 'kano-cardwrap' },
      !selectMode ? ce('div', { className: 'kano-actions' },
        ce('button', { className: 'kano-actbtn', style: { background: '#3b82f6' }, onClick: e => { e.stopPropagation(); setDx(0); p.onEdit(row); } }, ce('span', { style: { fontSize: 16 } }, '✏️'), 'Edit'),
        ce('button', { className: 'kano-actbtn', style: { background: '#ef4444' }, onClick: e => { e.stopPropagation(); setDx(0); p.onDelete(row); } }, ce('span', { style: { fontSize: 16 } }, '🗑'), 'Delete')) : null,
      ce('div', {
        className: 'kano-card',
        style: { transform: selectMode ? 'none' : 'translateX(' + dx + 'px)', transition: selectMode ? 'none' : 'transform .18s ease', borderColor: (selectMode && selected) ? '#6366f1' : '#e5e7eb', boxShadow: (selectMode && selected) ? '0 0 0 2px #6366f155' : 'none' },
        onTouchStart: onStart, onTouchMove: onMove, onTouchEnd: onEnd,
        onClick: () => { if (selectMode) { p.onToggleSelect(getId(row)); return; } if (dx === 0) p.onOpen(row); else setDx(0); },
      }, config.renderCard({ row: row, summary: p.summary, imgMap: p.imgMap, getImage: p.getImage, selectMode: selectMode, selected: selected })));
  }

  // ── new / edit drawer shells ──
function FormDrawer(p) {
  const isEdit = p.mode === 'edit';
  const spec = isEdit ? config.editForm : config.newForm;
  const sL = useState(!!isEdit); const loading = sL[0]; const setLoading = sL[1];
  const sB = useState(false); const busy = sB[0]; const setBusy = sB[1];
  const sf = useState({}); const form = sf[0]; const setForm = sf[1];
  const se = useState({}); const errs = se[0]; const setErrs = se[1];
  useEffect(function() {
    if (!p.open) return;
    setErrs({});
    if (isEdit && spec.load) { setLoading(true); Promise.resolve(spec.load(p.row)).then(f => { setForm(f || {}); setLoading(false); }).catch(e => { message.error('Load failed: ' + ((e && e.message) || e)); setLoading(false); }); }
    else { setForm(spec.initial ? spec.initial() : {}); setLoading(false); }
  }, [p.open, p.row && getId(p.row)]);
  function setF(k, v) { setForm(prev => Object.assign({}, prev, { [k]: v })); }
  function submit() {
    const err = spec.validate ? spec.validate(form) : null;
    if (err) return message.warning(err);
    setBusy(true);
    const action = isEdit ? spec.submit(getId(p.row), form) : spec.submit(form);
    Promise.resolve(action).then(() => { message.success(spec.successMsg || (isEdit ? 'Saved.' : 'Created.')); p.onDone(); })
      .catch(e => message.error((isEdit ? 'Update' : 'Create') + ' failed: ' + ((e && e.message) || e)))
      .finally(() => setBusy(false));
  }
 
  const footerNode = ce('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
    ce('button', { onClick: p.onClose, style: { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13 } }, 'Cancel'),
    ce('button', { onClick: submit, disabled: busy || loading, style: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 20px', fontSize: 13, fontWeight: 700, cursor: (busy || loading) ? 'not-allowed' : 'pointer', opacity: (busy || loading) ? 0.6 : 1 } }, busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Create')));
  const bodyNode = ce('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } }, spec.render(form, setF, p.extra || {}, errs, setErrs));
 
  if (config.DrawerShell) {
    return ce(config.DrawerShell, {
      open: p.open, onClose: p.onClose,
      title: spec.title || (isEdit ? 'Edit' : 'New'),
      width: spec.width || 540, placement: 'right',
      rootClassName: isEdit ? 'kano-edit-drawer' : undefined, zIndex: isEdit ? 1100 : undefined,
      loading: loading, footer: footerNode,
    }, bodyNode);
  }
 
  // fallback — unchanged from before
  return ce(Drawer, {
    open: p.open, title: spec.title || (isEdit ? 'Edit' : 'New'), width: spec.width || 540, placement: 'right', onClose: p.onClose,
    rootClassName: isEdit ? 'kano-edit-drawer' : undefined, zIndex: isEdit ? 1100 : undefined,
    footer: footerNode,
  }, loading ? ce('div', { style: { padding: 60, textAlign: 'center' } }, ce(Spin, null)) : bodyNode);
}

  // ── detail drawer ──
function DetailDrawer(p) {
  const row = p.row;
  const sO = useState(0); const openIdx = sO[0]; const setOpenIdx = sO[1];
  useEffect(function() { setOpenIdx(0); }, [row && getId(row)]);
  function toggle(i) { setOpenIdx(openIdx === i ? -1 : i); }
  const sections = row ? (config.detailSections || []) : [];
  const accent = (row && config.statusAccent) ? config.statusAccent(row) : '#9ca3af';
  const iconBtn = { border: '1px solid #e2e8f0', background: '#fff', borderRadius: 8, height: 30, padding: '0 10px', fontSize: 13, color: '#475569', cursor: 'pointer' };
  const allActions = config.detailActions || [];
  const headerActions = allActions.filter(a => !a.menu);
  const menuActions = allActions.filter(a => a.menu);
  const overflowMenu = {
    items: menuActions.map((a, i) => ({ key: 'act_' + i, label: a.label })).concat([{ key: 'delete', danger: true, label: '🗑  Delete' }]),
    onClick: e => {
      if (e.key === 'delete') { if (row) p.onDelete(row); return; }
      const a = menuActions[Number(String(e.key).slice(4))];
      if (a && row) a.run(row, p.helpers);
    },
  };
 
  const innerContent = row ? ce('div', { style: { fontFamily: "'Segoe UI', sans-serif" } },
    config.detailRender
      ? config.detailRender(row, p.refreshKey, p.helpers)
      : sections.map((s, i) => ce(AccordionItem, { key: i, title: s.title, open: openIdx === i, onToggle: () => toggle(i) }, s.render(row, p.refreshKey, p.helpers))),
    ce('div', { style: { height: 120 } })) : null;
 
  const headerExtraNode = row ? ce('div', { style: { display: 'flex', gap: 6 } },
    headerActions.map((a, i) => ce('button', { key: i, onClick: () => a.run(row, p.helpers), style: Object.assign({}, iconBtn, { fontWeight: 600, color: a.color || '#166534', borderColor: a.borderColor || '#bbf7d0', background: a.bg || '#f0fdf4' }) }, a.label)),
    ce('button', { onClick: () => p.onEdit(row), style: Object.assign({}, iconBtn, { fontWeight: 600, color: '#4f46e5', borderColor: '#c7d2fe', background: '#eef2ff' }) }, '✏️ Edit'),
    ce(Dropdown, { menu: overflowMenu, trigger: ['click'], placement: 'bottomRight' },
      ce('button', { style: Object.assign({}, iconBtn, { width: 34, padding: 0, fontSize: 16 }) }, '⋯'))
  ) : null;
 
  if (config.DrawerShell) {
    return ce(config.DrawerShell, {
      open: !!row, onClose: p.onClose,
      title: row ? (config.detailTitle ? config.detailTitle(row) : ('#' + getId(row))) : '',
      placement: 'right', rootClassName: 'kano-detail-drawer',
      accentColor: row ? accent : null,
      extra: headerExtraNode,
    }, innerContent);
  }
 
  // fallback — unchanged from before
  return ce(Drawer, {
    open: !!row, placement: 'right', rootClassName: 'kano-detail-drawer',
    title: row ? (config.detailTitle ? config.detailTitle(row) : ('#' + getId(row))) : '',
    onClose: p.onClose,
    extra: headerExtraNode,
  }, row ? ce('div', { style: { fontFamily: "'Segoe UI', sans-serif" } },
    ce('div', { style: { height: 4, borderRadius: 999, background: accent, marginBottom: 6, opacity: 0.85 } }),
    innerContent) : null);
}

  // ── root ──
  return function ListView() {
    const sd = useState([]);    const data = sd[0];      const setData = sd[1];
    const ssu = useState(null); const summaries = ssu[0]; const setSummaries = ssu[1];
    const sx = useState({});    const extra = sx[0];     const setExtra = sx[1];
    const si = useState({});    const imgMap = si[0];    const setImgMap = si[1];
    const sl = useState(true);  const loading = sl[0];   const setLoading = sl[1];
    const sq = useState('');    const query = sq[0];     const setQuery = sq[1];
    const st = useState('all'); const tab = st[0];       const setTab = st[1];
    const initFilters = useMemo(function() { const z = {}; filterDefs.forEach(f => { z[f.key] = f.default !== undefined ? f.default : (f.kind === 'dateRange' ? null : (f.multi ? [] : 'all')); }); return z; }, []);
    const sff = useState(initFilters); const filters = sff[0]; const setFilters = sff[1];
    const sfo = useState(false);const filterOpen = sfo[0]; const setFilterOpen = sfo[1];
    const sn = useState(false); const newOpen = sn[0];   const setNewOpen = sn[1];
    const so = useState(null);  const openRow = so[0];   const setOpenRow = so[1];
    const se = useState(null);  const editRow = se[0];   const setEditRow = se[1];
    const srk = useState(0);    const refreshKey = srk[0]; const setRefreshKey = srk[1];
    const sp = useState(1);     const page = sp[0];      const setPage = sp[1];
    const sm = useState(false); const selectMode = sm[0]; const setSelectMode = sm[1];
    const ssel = useState({});  const selected = ssel[0]; const setSelected = ssel[1];
    const sso = useState(sortOptions[0].key); const sortKey = sso[0]; const setSortKey = sso[1];

    function reload(keepOpenId) {
      setLoading(true);
      return config.fetchList().then(function(rows) {
        setData(rows); setLoading(false);
        if (config.fetchSummaries) config.fetchSummaries(rows).then(setSummaries).catch(() => {});
        if (keepOpenId != null) { const fresh = rows.find(r => String(getId(r)) === String(keepOpenId)); if (fresh) setOpenRow(fresh); }
        return rows;
      }).catch(() => setLoading(false));
    }

    function reloadUntil(predicate, attempts) {
      attempts = attempts || 0;
      return config.fetchList().then(function(rows) {
        setData(rows);
        const sp = config.fetchSummaries ? config.fetchSummaries(rows) : Promise.resolve(null);
        return sp.then(function(sum) {
          if (sum != null) setSummaries(sum);
          let ok = true;
          try { ok = predicate ? !!predicate(rows, sum) : true; } catch (e) { ok = true; }
          if (!ok && attempts < 6) return reloadUntil(predicate, attempts + 1);
          return rows;
        });
      }).catch(() => {});
    }
    const helpers = { reload, reloadUntil, closeDetail: () => setOpenRow(null), refresh: () => setRefreshKey(k => k + 1), reloadKeepOpen: () => reload(openRow ? getId(openRow) : null), getImage: row => (config.getImage ? config.getImage(row, imgMap) : ''), exitSelect: () => { setSelectMode(false); setSelected({}); } };

    useEffect(function() {
      reload();
      if (config.fetchExtra) config.fetchExtra().then(setExtra).catch(() => {});
      if (config.fetchImages) config.fetchImages().then(setImgMap).catch(() => {});
    }, []);
    useEffect(function() { setPage(1); }, [query, tab, filters, sortKey]);

    function onDelete(row) {
      Modal.confirm({
        title: config.deleteTitle || 'Delete?', content: (config.deleteLabel ? config.deleteLabel(row) : ('#' + getId(row))) + ' will be permanently deleted.',
        okText: 'Delete', okButtonProps: { danger: true },
        onOk: () => config.deleteRow(getId(row)).then(() => { message.success('Deleted.'); setOpenRow(null); reload(); }).catch(e => message.error('Delete failed: ' + ((e && e.message) || e))),
      });
    }
    function toggleSelect(id) { setSelected(prev => { const n = Object.assign({}, prev); if (n[id]) delete n[id]; else n[id] = true; return n; }); }
    function exitSelect() { setSelectMode(false); setSelected({}); }
    const selectedIds = Object.keys(selected);

    // search + secondary filters (NOT the main tab)
    const facetBase = useMemo(function() {
      const q = query.trim().toLowerCase();
      return data.filter(function(r) {
        if (q) { const hay = (config.searchText ? config.searchText(r) : []).map(x => String(x || '').toLowerCase()).join(' '); if (hay.indexOf(q) === -1) return false; }
        for (let i = 0; i < filterDefs.length; i++) {
          const f = filterDefs[i]; const v = filters[f.key];
          if (f.kind === 'dateRange') { if (!inDateBound(r[f.field], v)) return false; }
          else if (f.multi) {
            if (Array.isArray(v) && v.length) {
              if (f.match) { if (!f.match(r, v)) return false; }
              else { let cell = r[f.field]; if (f.normalize === 'lower') cell = String(cell || '').toLowerCase(); if (v.indexOf(cell) === -1) return false; }
            }
          }
          else if (v != null && v !== 'all') {
            if (f.match) { if (!f.match(r, v)) return false; }
            else { let cell = r[f.field]; if (f.normalize === 'lower') cell = String(cell || '').toLowerCase(); if (String(cell) !== String(v)) return false; }
          }
        }
        return true;
      });
    }, [data, query, filters]);

    const mainTabs = config.mainTabs;
    const counts = useMemo(function() {
      const c = { all: facetBase.length };
      if (mainTabs) { mainTabs.tabs.forEach(t => { c[t.key] = 0; }); facetBase.forEach(r => { const k = mainTabs.classify(r); if (c[k] != null) c[k]++; }); }
      return c;
    }, [facetBase]);

    // distinct options for select-kind filters
    const filterOptions = useMemo(function() {
      const o = {};
      filterDefs.forEach(function(f) {
        if (f.kind === 'dateRange') return;
        if (f.options) { o[f.key] = f.options(data); return; }
        let vals = data.map(r => { let c = r[f.field]; if (f.normalize === 'lower') c = String(c || '').toLowerCase(); return c; });
        o[f.key] = uniq(vals).filter(x => x !== '' && x != null).sort();
      });
      return o;
    }, [data]);

    const activeFilterCount = filterDefs.reduce(function(n, f) {
      const v = filters[f.key];
      if (f.kind === 'dateRange') return n + ((v && (v[0] || v[1])) ? 1 : 0);
      if (f.multi) return n + ((Array.isArray(v) && v.length) ? 1 : 0);
      return n + ((v != null && v !== 'all') ? 1 : 0);
    }, 0);

    const filtered = useMemo(function() {
      if (!mainTabs || tab === 'all') return facetBase;
      return facetBase.filter(r => mainTabs.classify(r) === tab);
    }, [facetBase, tab]);

    const sorted = useMemo(function() {
      const cmp = config.sortComparator ? config.sortComparator(sortKey) : null;
      if (!cmp) return filtered;
      return filtered.slice().sort(cmp);
    }, [filtered, sortKey]);

    const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const tabsWithCounts = mainTabs ? [{ key: 'all', label: mainTabs.allLabel || 'All', color: '#64748b', bg: '#f8fafc', count: counts.all }].concat(mainTabs.tabs.map(t => Object.assign({}, t, { count: counts[t.key] }))) : null;
    const getImage = config.getImage || (() => '');

    return ce('div', { className: 'kano-root', style: { padding: 12, fontFamily: "'Segoe UI', sans-serif" } },
      ce('style', null, BASE_CSS + (config.css || '')),

      selectMode
        ? ce(SelectionBar, { count: selectedIds.length, selectedIds: selectedIds, onCancel: exitSelect, helpers: Object.assign({}, helpers, { exitSelect: exitSelect }) })
        : ce('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
            ce('div', { style: { fontSize: 18, fontWeight: 800, color: '#0f172a' } }, config.title || 'List'),
            ce('div', { style: { display: 'flex', gap: 8 } },
              (config.newForm || config.renderNewDrawer) ? ce('button', { onClick: () => setNewOpen(true), style: { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 10, width: 40, height: 40, fontSize: 22, fontWeight: 700, cursor: 'pointer', lineHeight: 1 } }, '+') : null,
              (config.bulkActions && config.bulkActions.length) ? ce('button', { onClick: () => setSelectMode(true), title: 'Select', style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e5e7eb', background: '#fff', borderRadius: 10, width: 40, height: 40, color: '#475569', cursor: 'pointer' } },
                ce('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none' }, ce('path', { d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', stroke: '#475569', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))) : null)),

      config.banner ? renderBanner(config.banner(data)) : null,

      ce('div', { className: 'kano-searchrow' },
        ce(SearchBar, { value: query, onChange: setQuery, placeholder: config.searchPlaceholder }),
        filterDefs.length ? ce(FilterButton, { activeCount: activeFilterCount, onClick: () => setFilterOpen(true) }) : null,
        ce(SortButton, { value: sortKey, onChange: setSortKey, options: sortOptions })),

      tabsWithCounts ? ce(MainFilter, { tabs: tabsWithCounts, value: tab, onChange: setTab }) : null,

      loading ? ce('div', { style: { textAlign: 'center', padding: 60 } }, ce(Spin, { size: 'large' }))
        : filtered.length === 0 ? ce('div', { style: { textAlign: 'center', color: '#94a3b8', padding: 40 } }, config.emptyText || 'Nothing matches this filter')
          : paged.map(row => ce(Card, {
              key: getId(row), row: row, summary: summaries, imgMap: imgMap, getImage: getImage,
              selectMode: selectMode, selected: !!selected[getId(row)],
              onOpen: setOpenRow, onDelete: onDelete, onEdit: setEditRow, onToggleSelect: toggleSelect,
            })),

      filtered.length > PAGE_SIZE ? ce('div', { style: { display: 'flex', justifyContent: 'center', marginTop: 14 } },
        ce(Pagination, { current: page, pageSize: PAGE_SIZE, total: filtered.length, onChange: setPage, showSizeChanger: false, size: 'small' })) : null,

      filterDefs.length ? ce(FilterPopup, {
        open: filterOpen, values: filters, options: filterOptions,
        onClose: () => setFilterOpen(false),
        onApply: function(v) { setFilters(v); setFilterOpen(false); },
      }) : null,

      config.renderNewDrawer
        ? config.renderNewDrawer({ open: newOpen, onClose: () => setNewOpen(false), helpers: helpers })
        : (config.newForm ? ce(FormDrawer, { mode: 'new', open: newOpen, extra: extra, onClose: () => setNewOpen(false), onDone: () => { setNewOpen(false); reload(); } }) : null),

      config.renderEditDrawer
        ? config.renderEditDrawer({ open: !!editRow, row: editRow, onClose: () => setEditRow(null), helpers: helpers })
        : (config.editForm ? ce(FormDrawer, {
            mode: 'edit', open: !!editRow, row: editRow, extra: extra,
            onClose: () => setEditRow(null),
            onDone: function() { const id = editRow ? getId(editRow) : null; setEditRow(null); setRefreshKey(k => k + 1); reload(id); },
          }) : null),

      ce(DetailDrawer, {
        row: openRow, refreshKey: refreshKey, helpers: helpers,
        onClose: () => setOpenRow(null), onEdit: r => setEditRow(r), onDelete: onDelete,
      }));
  };
}

return { createListView };
