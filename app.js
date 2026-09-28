/* ============================================================================
   app.js — слой UI и команд редактора.
   Разделы: утилиты → уведомления/диалоги → история (undo/redo снимками) →
   автосохранение и синхронизация вкладок → команды → панель свойств →
   взаимодействие с холстом → буфер обмена → импорт/экспорт → список
   диаграмм → мини-карта → горячие клавиши → инициализация.
   ========================================================================== */
(function () {
  'use strict';
  const L = ERD.STR, C = ERD.C, fmt = ERD.fmt, el = ERD.el, append = ERD.append, plural = ERD.plural;
  const $ = s => document.querySelector(s);
  const svg = $('#svg'), panel = $('#panel'), pc = $('#pc'), topBar = $('#top');

  /* ======================= УТИЛИТЫ ======================= */
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = L[e.dataset.i18n]; });
    document.querySelectorAll('[data-i18n-aria]').forEach(e => { e.setAttribute('aria-label', L[e.dataset.i18nAria]); if (!e.title) e.title = L[e.dataset.i18nAria]; });
    document.querySelectorAll('[data-i18n-ph]').forEach(e => { e.placeholder = L[e.dataset.i18nPh]; });
    document.querySelectorAll('[data-i18n-title]').forEach(e => { e.title = L[e.dataset.i18nTitle]; });
    const dl = $('#pg-types');
    Model.PG_TYPES.forEach(t => dl.appendChild(el('option', { value: t })));
  }
  const isTyping = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const hasTextSelection = () => { const s = window.getSelection && getSelection(); return !!s && !s.isCollapsed && !!s.toString().trim(); };
  const safeName = s => (String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'diagram').slice(0, 120);
  const dateStamp = () => new Date().toISOString().slice(0, 10);
  function download(name, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(fmt(L.exported, { name }));
  }
  function timeLabel(iso) {
    const t = new Date(iso); if (isNaN(t)) return '';
    const diff = Date.now() - t;
    if (diff < 60e3) return L.justNow;
    if (diff < 3600e3) return fmt(L.minAgo, { n: Math.floor(diff / 60e3) });
    const hm = t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    if (t >= d0) return fmt(L.today, { t: hm });
    if (t >= d0 - 864e5) return fmt(L.yesterday, { t: hm });
    return t.toLocaleDateString('ru-RU') + ' ' + hm;
  }
  /* восстановление фокуса после перерисовки DOM по атрибуту data-k */
  const focusKey = box => { const a = document.activeElement; return a && box.contains(a) ? a.getAttribute('data-k') : null; };
  function restoreFocus(box, key) {
    if (!key) return;
    const n = [...box.querySelectorAll('[data-k]')].find(x => x.getAttribute('data-k') === key);
    if (n) { n.focus({ preventScroll: true }); if (n.select && n.dataset.sel) n.select(); }
  }

  /* ======================= УВЕДОМЛЕНИЯ И ДИАЛОГИ ======================= */
  function toast(msg, o) {
    o = o || {};
    const t = el('div', { class: 'toast ' + (o.type || ''), role: o.type === 'error' ? 'alert' : 'status' }, [el('span', { text: msg })]);
    const close = () => { if (!t.isConnected) return; t.remove(); if (o.onClose) o.onClose(); };
    (o.actions || []).forEach(a => t.appendChild(el('button', { type: 'button', text: a.label, onclick: () => { close(); a.fn(); } })));
    t.appendChild(el('button', { type: 'button', class: 'tx', text: '✕', 'aria-label': L.dismiss, onclick: close }));
    const box = $('#toasts'); box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    if (o.timeout !== 0) setTimeout(close, o.timeout || 3200);
    return close;
  }
  function dialog(o) {
    return new Promise(resolve => {
      const err = el('div', { class: 'err', role: 'alert' });
      const dlg = el('dialog', { class: 'dlg', 'aria-label': o.title });
      const form = el('form', { method: 'dialog' }, [
        el('h2', { text: o.title }), o.body || null, err,
        el('div', { class: 'actions' }, o.buttons.map(b => el('button', {
          type: 'submit', value: b.value, text: b.label,
          class: [b.primary ? 'primary' : '', b.danger ? 'danger' : ''].join(' ').trim() || null, autofocus: b.focus || null
        })))
      ]);
      /* завершаем явно, не полагаясь на событие close (в скрытой вкладке оно может не прийти) */
      let done = false;
      const finish = v => {
        if (done) return; done = true;
        if (dlg.open) dlg.close();
        dlg.remove(); resolve(v || null);
      };
      form.addEventListener('submit', e => {
        e.preventDefault();
        const v = e.submitter ? e.submitter.value : (o.buttons[0] || {}).value;
        if (o.validate && v) { const m = o.validate(v); if (m) { err.textContent = m; return; } }
        finish(v);
      });
      dlg.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
      dlg.addEventListener('close', () => finish(dlg.returnValue));
      dlg.appendChild(form); document.body.appendChild(dlg);
      dlg.showModal();
      if (o.onOpen) o.onOpen(dlg);
    });
  }
  async function promptDlg(title, value) {
    const inp = el('input', { type: 'text', value: value || '', 'aria-label': title, spellcheck: 'false' });
    const v = await dialog({ title, body: inp, buttons: [{ value: 'ok', label: L.ok, primary: true }, { value: '', label: L.cancel }], onOpen: () => { inp.focus(); inp.select(); } });
    return v === 'ok' ? inp.value.trim() || null : null;
  }
  async function confirmDlg(title, text, okLabel) {
    return (await dialog({ title, body: el('p', { text }), buttons: [{ value: 'ok', label: okLabel, primary: true, danger: true }, { value: '', label: L.cancel, focus: true }] })) === 'ok';
  }
  function warnList(ws) {
    if (!ws || !ws.length) return null;
    return [el('p', { text: L.warnings + ':' }), el('ul', { class: 'warns' }, ws.slice(0, 50).map(w => el('li', { text: w })))];
  }

  /* ======================= СОСТОЯНИЕ ======================= */
  const prefs = Object.assign({ snap: true, minimap: true, sidebar: innerWidth > 1100, mode: 'edit' }, Store.getPrefs());
  const savePrefs = () => Store.setPrefs(prefs);
  /* v2: привязка к сетке по умолчанию включена — включаем и тем, у кого сохранилось старое «выкл» */
  if (!(prefs.v >= 2)) { prefs.snap = true; prefs.v = 2; savePrefs(); }
  let D = null;                   /* текущая диаграмма (объект модели) */
  let mode = prefs.mode === 'view' ? 'view' : 'edit';
  let groupsPanel = false;        /* открыт ли менеджер групп */
  let panelKey = '';              /* что показано в панели (для сохранения прокрутки) */
  let pointerWorld = null, pointerInside = false;

  const R = new ERD.Renderer(svg, {
    ports: true,
    onStats: s => { $('#stats').textContent = plural(s.tables, L.tablesN) + ' · ' + plural(s.edges, L.edgesN); },
    onView: () => { scheduleViewSave(); scheduleMinimap(); }
  });
  const st = R.st, sel = st.selected;
  const byId = id => R.idx.byId.get(id);
  const canEdit = () => { if (mode === 'edit') return true; toast(L.viewModeRO); return false; };
  const wide = () => innerWidth > 800;
  const margins = () => ({
    top: topBar.offsetHeight,
    left: document.body.classList.contains('sb-open') && wide() ? $('#sidebar').offsetWidth : 0,
    right: panel.classList.contains('open') && wide() ? panel.offsetWidth + 12 : 0,
    bottom: 0
  });
  const fitView = () => { const m = margins(); m.right = 0; R.fit(m); };

  /* ======================= ИСТОРИЯ (снимки, ≥100 шагов) ======================= */
  const History = {
    undo: [], redo: [], cur: null, key: null, t: 0, LIMIT: 200,
    snap() { return JSON.stringify({ name: D.name, groups: D.groups, tables: D.tables }); },
    reset() { this.undo = []; this.redo = []; this.cur = this.snap(); this.key = null; updateUndoButtons(); },
    /* merge — ключ слияния: подряд идущие правки одного поля текста = один шаг */
    commit(merge) {
      const s = this.snap();
      if (s === this.cur) return false;
      if (!(merge && merge === this.key && Date.now() - this.t < 4000)) {
        this.undo.push(this.cur);
        if (this.undo.length > this.LIMIT) this.undo.shift();
      }
      this.cur = s; this.redo = []; this.key = merge || null; this.t = Date.now();
      updateUndoButtons();
      return true;
    },
    breakMerge() { this.key = null; },
    step(dir) {
      const from = dir < 0 ? this.undo : this.redo, to = dir < 0 ? this.redo : this.undo;
      if (!from.length) return false;
      to.push(this.cur); this.cur = from.pop(); this.key = null;
      const o = JSON.parse(this.cur);
      D.name = o.name; D.groups = o.groups; D.tables = o.tables;
      updateUndoButtons();
      return true;
    }
  };
  function updateUndoButtons() {
    $('#b-undo').disabled = !History.undo.length;
    $('#b-redo').disabled = !History.redo.length;
  }

  /* Единая точка после любой правки модели.
     o.ids — перерисовать только эти карточки; o.render:false — без перерисовки;
     o.merge — ключ слияния шага истории; o.panel:false — не перестраивать панель. */
  function changed(o) {
    o = o || {};
    if (o.render !== false) R.rebuild(o.ids);
    if (History.commit(o.merge)) { D.updatedAt = Model.now(); scheduleSave(); }
    if (o.panel !== false) renderPanel(o.focus);
    renderChips(); updateEmpty(); scheduleMinimap();
  }
  function afterHistory() {
    cancelInline();
    R.rebuild();
    D.updatedAt = Model.now(); scheduleSave();
    $('#dname').value = D.name; document.title = D.name + ' — ' + L.appTitle;
    renderChips(); renderPanel(); updateEmpty(); scheduleMinimap();
  }
  function undo() { if (canEdit() && History.step(-1)) afterHistory(); }
  function redo() { if (canEdit() && History.step(1)) afterHistory(); }

  /* ======================= АВТОСОХРАНЕНИЕ И ВКЛАДКИ ======================= */
  let saveTimer = null, viewTimer = null, quotaShown = false, lastWritten = null, extClose = null;
  function setSaveState(s) {
    const e = $('#save-state');
    e.dataset.state = s;
    e.textContent = { saved: L.saved, saving: L.saving, failed: L.saveFailed, memory: L.memoryOnly }[s];
  }
  function scheduleSave() { setSaveState('saving'); clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 500); }
  function flushSave() {
    clearTimeout(saveTimer); saveTimer = null;
    clearTimeout(viewTimer); viewTimer = null;
    if (!D) return;
    try {
      Store.save(D); lastWritten = D.updatedAt; quotaShown = false;
      setSaveState(Store.persistent ? 'saved' : 'memory');
      renderSidebar();
    } catch (e) {
      setSaveState('failed');
      if (Store.isQuota(e)) showQuota(); else toast(L.saveFailed + ': ' + e.message, { type: 'error' });
    }
  }
  function scheduleViewSave() { if (!saveTimer) { clearTimeout(viewTimer); viewTimer = setTimeout(flushView, 700); } }
  function flushView() {
    clearTimeout(viewTimer); viewTimer = null;
    if (!D || saveTimer) return;
    try { if (!Store.saveView(D.id, D.view)) Store.save(D); } catch (e) { if (Store.isQuota(e)) showQuota(); }
  }
  async function showQuota() {
    if (quotaShown) return; quotaShown = true;
    const v = await dialog({
      title: L.quotaTitle, body: el('p', { text: L.quotaText }),
      buttons: [{ value: 'export', label: L.mExportJson, primary: true }, { value: '', label: L.close }]
    });
    if (v === 'export') exportJson();
  }
  addEventListener('beforeunload', () => { if (saveTimer) flushSave(); else if (viewTimer) flushView(); });

  /* синхронизация между вкладками */
  addEventListener('storage', e => {
    if (e.key === ERD.THEME_KEY && e.newValue) { ERD.setTheme(e.newValue); scheduleMinimap(); return; }
    if (e.key === Store.K.index || e.key === null) { renderSidebar(); return; }
    const id = Store.idFromKey(e.key);
    if (!id) return;
    renderSidebar();
    if (!D || id !== D.id) return;
    if (e.newValue == null) { toast(L.externalDeleted, { type: 'warn', timeout: 0 }); lastWritten = null; return; }
    let o; try { o = JSON.parse(e.newValue); } catch (err) { return; }
    if (!o.updatedAt || o.updatedAt === D.updatedAt || o.updatedAt === lastWritten) return;
    if (extClose) return;
    extClose = toast(L.externalChange, {
      timeout: 0, onClose: () => { extClose = null; }, actions: [{ label: L.reload, fn: reloadFromStorage }]
    });
  });
  function reloadFromStorage() {
    const nd = Store.load(D.id); if (!nd) return;
    extClose = null;
    D.name = nd.name; D.groups = nd.groups; D.tables = nd.tables; D.updatedAt = nd.updatedAt; lastWritten = nd.updatedAt;
    R.rebuild(); History.commit();
    $('#dname').value = D.name;
    renderChips(); renderPanel(); renderSidebar(); updateEmpty(); scheduleMinimap();
  }

  /* ======================= ОТКРЫТИЕ ДИАГРАММ ======================= */
  function openDiagram(d, forceFit) {
    if (D && D.id !== d.id) flushSave();
    cancelInline();
    const needFit = forceFit || !d.view;
    D = d; Store.setLast(d.id);
    st.hidden.clear(); st.query = ''; $('#q').value = ''; groupsPanel = false; st.hovered = null;
    R.setDiagram(D);
    renderChips(); setTh();
    if (needFit) fitView();
    History.reset();
    lastWritten = D.updatedAt;
    if (extClose) { extClose(); extClose = null; }
    $('#dname').value = D.name;
    document.title = D.name + ' — ' + L.appTitle;
    if (!Store.has(D.id)) flushSave(); else setSaveState(Store.persistent ? 'saved' : 'memory');
    renderChips(); renderPanel(); renderSidebar(); updateEmpty(); scheduleMinimap();
  }
  function updateEmpty() {
    const e = $('#empty');
    e.hidden = !!D.tables.length;
    e.textContent = L.emptyHint;
  }

  /* ======================= КОМАНДЫ ======================= */
  function setSelection(ids) {
    sel.clear(); ids.forEach(id => sel.add(id));
    if (ids.length) groupsPanel = false;
    R.refresh(); renderPanel();
  }
  function selectAll() { setSelection(D.tables.filter(t => R.isVisible(t)).map(t => t.id)); }
  const snapV = v => (prefs.snap ? Math.round(v / C.GRID) * C.GRID : Math.round(v));

  function addTable(pos, group) {
    if (!canEdit()) return;
    const p = pos || (() => { const c = R.viewCenter(margins()); return { x: c.x, y: c.y - 60 }; })();
    const names = new Set(D.tables.map(t => t.name));
    let n = D.tables.length + 1; while (names.has('table_' + n)) n++;
    if (group === undefined) { const s = sel.size === 1 ? byId([...sel][0]) : null; group = s ? s.group : null; }
    const t = Model.newTable('table_' + n, snapV(p.x - C.W / 2), snapV(p.y - 15), group);
    D.tables.push(t);
    sel.clear(); sel.add(t.id); groupsPanel = false;
    changed({ ids: [t.id], focus: 'tname' });
    const inp = pc.querySelector('[data-k="tname"]'); if (inp) inp.select();
  }
  function deleteSelected() {
    if (!sel.size || !canEdit()) return;
    const n = sel.size;
    Model.removeTables(D, [...sel]); sel.clear();
    changed();
    toast(fmt(L.deleted, { n }), { actions: [{ label: L.undo.split(' (')[0], fn: undo }] });
  }
  function duplicateSelected() {
    if (!sel.size) { toast(L.nothingSelected); return; }
    if (!canEdit()) return;
    const src = D.tables.filter(t => sel.has(t.id));
    const b = R.bounds(new Set(src.map(t => t.id)));
    const frag = { groups: [], tables: src.map(Model.cloneTable) };
    const pos = b ? { x: (b.x0 + b.x1) / 2 + 40, y: (b.y0 + b.y1) / 2 + 40 } : null;
    const res = Model.insertFragment(D, frag, pos, { keepExternalRefs: true, snap: prefs.snap ? C.GRID : 0 });
    sel.clear(); res.ids.forEach(id => sel.add(id));
    changed();
  }
  function createGroup(ids) {
    if (!canEdit()) return;
    const g = Model.newGroup(fmt(L.groupN, { n: D.groups.length + 1 }), D.groups);
    D.groups.push(g);
    (ids || []).forEach(id => { const t = byId(id); if (t) t.group = g.id; });
    sel.clear(); groupsPanel = true;
    changed({ focus: 'g-' + g.id + '-title' });
    const inp = pc.querySelector(`[data-k="g-${g.id}-title"]`); if (inp) inp.select();
  }
  function deleteGroup(gid) {
    const g = ERD.groupById(D, gid); if (!g) return;
    D.tables.forEach(t => { if (t.group === gid) t.group = null; });
    D.groups = D.groups.filter(x => x.id !== gid);
    st.hidden.delete(gid);
    changed();
    toast(fmt(L.groupDeleted, { name: g.title }), { actions: [{ label: L.undo.split(' (')[0], fn: undo }] });
  }
  function doAutoLayout() {
    if (!canEdit() || !D.tables.length) return;
    ERD.autoLayout(D, { grid: prefs.snap ? C.GRID : 0 });
    changed({ panel: false });
    fitView();
  }
  function setMode(m) {
    mode = m; prefs.mode = m; savePrefs();
    cancelInline();
    document.body.classList.toggle('mode-edit', m === 'edit');
    document.body.classList.toggle('mode-view', m === 'view');
    svg.classList.toggle('editing', m === 'edit');
    $('#m-view').setAttribute('aria-checked', String(m === 'view'));
    $('#m-edit').setAttribute('aria-checked', String(m === 'edit'));
    if (m === 'view') {
      groupsPanel = false;
      /* в просмотре выделения нет — остаётся максимум одна таблица с деталями */
      if (sel.size > 1) { sel.clear(); R.refresh(); }
    }
    if (D) renderPanel();
  }
  function setSidebar(open) {
    prefs.sidebar = open; savePrefs();
    document.body.classList.toggle('sb-open', open);
    $('#sb-toggle').setAttribute('aria-expanded', String(open));
  }
  function setMinimap(on) {
    prefs.minimap = on; savePrefs();
    $('#minimap').hidden = !on; $('#mm-show').hidden = on;
    renderMenu();
    scheduleMinimap();
  }

  /* ======================= ЧИПЫ ГРУПП И ПОИСК ======================= */
  function renderChips() {
    const keys = new Set(D.groups.map(g => g.id).concat(['']));
    [...st.hidden].forEach(k => { if (!keys.has(k)) st.hidden.delete(k); });
    ERD.buildChips($('#chips'), D, st.hidden, () => {
      [...sel].forEach(id => { const t = byId(id); if (!t || !R.isVisible(t)) sel.delete(id); });
      R.drawGroups(); R.refresh(); renderPanel(); scheduleMinimap();
    });
  }
  let matchIdx = 0;
  $('#q').addEventListener('input', e => { st.query = e.target.value; matchIdx = 0; R.refresh(); });
  $('#q').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.target.value = ''; st.query = ''; R.refresh(); e.target.blur(); return; }
    if (e.key !== 'Enter') return;
    const m = R.matches(st.query), list = D.tables.filter(t => m.has(t.id) && R.isVisible(t));
    if (!list.length) return;
    const t = list[matchIdx++ % list.length];
    R.centerOn(t, margins());
  });

  /* ======================= ПАНЕЛЬ СВОЙСТВ ======================= */
  let panelHoldId = null;
  function renderPanel(focus) {
    const key = focus || focusKey(pc);
    const newKey = mode + '|' + (sel.size ? [...sel].join(',') : groupsPanel ? 'groups' : '');
    const scroll = newKey === panelKey ? panel.scrollTop : 0;
    panelKey = newKey;
    pc.textContent = '';
    let open = true;
    /* таблица выделена захватом для перетаскивания — панель не открываем, пока не будет клика */
    const held = sel.size === 1 && panelHoldId && sel.has(panelHoldId);
    if (held) open = false;
    else if (sel.size === 1) {
      const t = byId([...sel][0]);
      if (mode === 'edit') tablePanel(t); else ERD.renderDetails(pc, D, R.idx, t, linkTo);
    } else if (sel.size > 1) multiPanel();
    else if (groupsPanel && mode === 'edit') groupsPanelRender();
    else open = false;
    panel.classList.toggle('open', open);
    document.body.classList.toggle('panel-open', open);
    panel.scrollTop = scroll;
    restoreFocus(pc, key);
    scheduleMinimap();
  }
  function linkTo(t) {
    sel.clear(); sel.add(t.id); groupsPanel = false;
    if (!R.isVisible(t)) { st.hidden.delete(ERD.gkey(t)); renderChips(); R.drawGroups(); }
    R.refresh(); renderPanel(); R.centerOn(t, margins());
  }
  $('#close').addEventListener('click', () => { groupsPanel = false; setSelection([]); });

  const btn = (text, fn, cls, extra) => el('button', Object.assign({ type: 'button', text, onclick: fn, class: cls || null }, extra || {}));
  const field = (label, control) => el('label', { class: 'field' }, [el('span', { text: label }), control]);
  /* текстовое поле, правки которого сливаются в один шаг истории */
  function textInput(k, value, onInput, attrs) {
    return el('input', Object.assign({
      type: 'text', value, 'data-k': k, spellcheck: 'false', autocomplete: 'off',
      oninput: e => onInput(e.target.value), onblur: () => History.breakMerge()
    }, attrs || {}));
  }
  function groupOptions(cur, withNew) {
    const o = [el('option', { value: '', text: L.noGroup, selected: !cur })]
      .concat(D.groups.map(g => el('option', { value: g.id, text: g.title, selected: cur === g.id })));
    if (withNew) o.push(el('option', { value: '__new', text: L.newGroupOpt }));
    return o;
  }

  function tablePanel(t) {
    const dupe = () => D.tables.some(x => x !== t && x.name === t.name);
    const warn = el('div', { class: 'warn', text: L.dupName, hidden: !dupe() });
    append(pc, [
      el('div', { class: 'ph' }, [textInput('tname', t.name, v => {
        t.name = v; warn.hidden = !dupe();
        changed({ ids: [t.id], merge: 'tname:' + t.id, panel: false });
      }, { class: 'tname-in', 'aria-label': L.tableName, onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } }), warn]),
      el('div', { class: 'pactions' }, [
        btn(L.duplicateTable, duplicateSelected), btn(L.copyBtn, () => copySelection(false)),
        btn(L.deleteTable, deleteSelected, 'danger')
      ]),
      field(L.group, el('select', {
        'data-k': 'tgroup', onchange: e => {
          const v = e.target.value;
          if (v === '__new') { createGroup([t.id]); return; }
          t.group = v || null; changed({ ids: [t.id], focus: 'tgroup' });
        }
      }, groupOptions(t.group, true))),
      el('label', { class: 'check' }, [el('input', {
        type: 'checkbox', checked: t.partitioned, 'data-k': 'tpart',
        onchange: e => { t.partitioned = e.target.checked; changed({ ids: [t.id] }); }
      }), L.partitionedLbl]),
      field(L.description, el('textarea', {
        'data-k': 'tdesc', value: t.description, rows: 2,
        oninput: e => { t.description = e.target.value; changed({ render: false, merge: 'desc:' + t.id, panel: false }); },
        onblur: () => History.breakMerge()
      })),
      el('h3', { text: `${L.columns} (${t.columns.length})` })
    ]);
    const list = el('div', { class: 'cols' });
    t.columns.forEach((c, i) => list.appendChild(colRow(t, c, i, list)));
    append(pc, [list, btn(L.addColumn, () => addColumn(t, t.columns.length), 'addbtn', { 'data-k': 'addcol' })]);

    append(pc, el('h3', { text: L.uniques }));
    t.uniques.forEach((u, i) => pc.appendChild(el('div', { class: 'uqrow' }, [
      textInput('uq' + i, u, v => { t.uniques[i] = v; changed({ ids: [t.id], merge: 'uq:' + t.id + ':' + i, panel: false }); },
        { class: 'mono', placeholder: L.uniquePh, 'aria-label': L.uniques }),
      btn('✕', () => { t.uniques.splice(i, 1); changed({ ids: [t.id] }); }, 'xbtn', { 'aria-label': L.delUnique, title: L.delUnique, 'data-k': 'uqx' + i })
    ])));
    pc.appendChild(btn(L.addUnique, () => {
      t.uniques.push(''); changed({ ids: [t.id], focus: 'uq' + (t.uniques.length - 1) });
    }, 'addbtn', { 'data-k': 'adduq' }));

    const out = R.idx.edges.filter(e => e.from === t), inn = R.idx.edges.filter(e => e.to === t);
    const link = (target, txt) => el('a', { class: 'lnk', href: '#', onclick: ev => { ev.preventDefault(); linkTo(target); } }, [target.name + ' ', el('span', { text: txt })]);
    if (out.length) append(pc, [el('h3', { text: `${L.refsOut} (${out.length})` })].concat(out.map(e => link(e.to, '← ' + e.from.columns[e.fi].name))));
    if (inn.length) append(pc, [el('h3', { text: `${L.refsIn} (${inn.length})` })].concat(inn.map(e => link(e.from, '→ ' + e.from.columns[e.fi].name))));
  }

  function addColumn(t, at) {
    const names = new Set(t.columns.map(c => c.name));
    let n = t.columns.length + 1; while (names.has('column_' + n)) n++;
    t.columns.splice(at, 0, Model.newColumn('column_' + n, 'text'));
    changed({ ids: [t.id], focus: 'c' + at + '-name' });
    const inp = pc.querySelector(`[data-k="c${at}-name"]`); if (inp) inp.select();
  }
  function moveColumn(t, from, to) {
    if (to < 0 || to >= t.columns.length || to === from) return false;
    const [c] = t.columns.splice(from, 1); t.columns.splice(to, 0, c);
    return true;
  }

  function colRow(t, c, i, list) {
    const k = 'c' + i + '-';
    const targets = [...D.tables].sort((a, b) => a.name.localeCompare(b.name));
    const tt = c.ref ? byId(c.ref.table) : null;
    const tOpts = [el('option', { value: '', text: L.fkNone, selected: !c.ref })];
    if (c.ref && !tt) tOpts.push(el('option', { value: c.ref.table, text: L.fkBroken, selected: true }));
    targets.forEach(x => tOpts.push(el('option', { value: x.id, text: x.name, selected: !!c.ref && c.ref.table === x.id })));
    const cOpts = [];
    if (tt) {
      const pk = tt.columns.find(x => x.pk);
      cOpts.push(el('option', { value: '', text: pk ? `${L.fkPk} (${pk.name})` : L.fkNoPk, selected: c.ref.column == null }));
      if (c.ref.column != null && !tt.columns.some(x => x.name === c.ref.column)) cOpts.push(el('option', { value: c.ref.column, text: L.fkBroken, selected: true }));
      tt.columns.forEach(x => cOpts.push(el('option', { value: x.name, text: x.name, selected: c.ref.column === x.name })));
    }
    const flag = (key, label, cls) => el('button', {
      type: 'button', class: 'fl ' + cls, text: label, 'aria-pressed': String(!!c[key]), 'data-k': k + key,
      onclick: () => {
        c[key] = !c[key];
        if (key === 'pk' && c.pk) c.nullable = false;
        if (key === 'nullable' && c.nullable) c.pk = false;
        changed({ ids: [t.id] });
      }
    });
    const handle = el('button', {
      type: 'button', class: 'handle', text: '⋮⋮', 'aria-label': L.dragHandle, title: L.dragHandle, 'data-k': k + 'h',
      onpointerdown: ev => startColDrag(ev, t, i, list),
      onkeydown: ev => {
        if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
        ev.preventDefault();
        const to = i + (ev.key === 'ArrowUp' ? -1 : 1);
        if (moveColumn(t, i, to)) changed({ focus: 'c' + to + '-h' });
      }
    });
    return el('div', { class: 'colrow', 'data-i': i }, [
      el('div', { class: 'cl1' }, [
        handle,
        textInput(k + 'name', c.name, v => { Model.renameColumn(D, t, i, v); changed({ merge: 'cname:' + t.id + ':' + i, panel: false }); },
          { class: 'mono cname', 'aria-label': L.colName, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); pc.querySelector(`[data-k="${k}type"]`).focus(); } } }),
        textInput(k + 'type', c.type, v => { c.type = v; changed({ ids: [t.id], merge: 'ctype:' + t.id + ':' + i, panel: false }); },
          {
            class: 'mono ctype', list: 'pg-types', 'aria-label': L.colType,
            onkeydown: e => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const next = pc.querySelector(`[data-k="c${i + 1}-name"]`);
              if (next) next.focus(); else addColumn(t, i + 1);
            }
          }),
        btn('✕', () => { Model.removeColumn(D, t, i); changed({ focus: 'addcol' }); }, 'xbtn', { 'aria-label': L.delColumn, title: L.delColumn, 'data-k': k + 'x' })
      ]),
      el('div', { class: 'cl2' }, [
        flag('pk', 'PK', 'pk'), flag('unique', 'UQ', 'uq'), flag('nullable', 'NULL', 'nl'),
        el('span', { class: 'fklbl', text: 'FK →', 'aria-hidden': 'true' }),
        el('select', {
          'data-k': k + 'fkt', 'aria-label': L.fkTarget, title: L.fkTarget,
          onchange: e => {
            const v = e.target.value;
            if (!v) c.ref = null;
            else {
              const target = byId(v); const pk = target.columns.find(x => x.pk);
              c.ref = { table: v, column: pk ? null : (target.columns[0] ? target.columns[0].name : null) };
              if (!c.type) { const tc = pk || target.columns[0]; if (tc) c.type = tc.type; }
            }
            changed({ focus: k + 'fkt' });
          }
        }, tOpts),
        el('select', {
          'data-k': k + 'fkc', 'aria-label': L.fkColumn, title: L.fkColumn, disabled: !tt,
          onchange: e => { c.ref.column = e.target.value || null; changed({ focus: k + 'fkc' }); }
        }, cOpts)
      ])
    ]);
  }

  /* перестановка столбцов перетаскиванием за «ручку» */
  function startColDrag(ev, t, i, list) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const h = ev.currentTarget; h.setPointerCapture(ev.pointerId); h.focus();
    const rows = [...list.querySelectorAll('.colrow')];
    rows[i].classList.add('dragging');
    let target = i;
    const clear = () => rows.forEach(r => r.classList.remove('drop-before', 'drop-after'));
    const move = e => {
      target = rows.length;
      for (let j = 0; j < rows.length; j++) { const r = rows[j].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { target = j; break; } }
      clear();
      if (target < rows.length) rows[target].classList.add('drop-before'); else rows[rows.length - 1].classList.add('drop-after');
    };
    const up = () => {
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      clear(); rows[i].classList.remove('dragging');
      const to = target > i ? target - 1 : target;
      if (moveColumn(t, i, to)) changed({ focus: 'c' + to + '-h' });
    };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  }

  function multiPanel() {
    const ts = D.tables.filter(t => sel.has(t.id));
    append(pc, [
      el('h2', { text: fmt(L.selectedN, { n: plural(ts.length, L.tablesN) }) }),
      el('ul', { class: 'selist' }, ts.map(t => el('li', {}, el('a', { class: 'lnk', href: '#', text: t.name, onclick: ev => { ev.preventDefault(); linkTo(t); } })))),
      mode === 'edit' ? field(L.moveToGroup, el('select', {
        'data-k': 'mgroup', onchange: e => {
          const v = e.target.value;
          if (v === '__keep') return;
          if (v === '__new') { createGroup(ts.map(t => t.id)); return; }
          ts.forEach(t => { t.group = v || null; });
          changed({ ids: ts.map(t => t.id), focus: 'mgroup' });
        }
      }, [el('option', { value: '__keep', text: '—', selected: true })].concat(groupOptions('__none', true)))) : null,
      el('div', { class: 'pactions' }, [
        btn(L.copyBtn, () => copySelection(false)),
        mode === 'edit' ? btn(L.duplicateTable, duplicateSelected) : null,
        mode === 'edit' ? btn(L.groupFromSel, () => createGroup(ts.map(t => t.id))) : null,
        mode === 'edit' ? btn(L.deleteTable, deleteSelected, 'danger') : null
      ])
    ]);
    const s = pc.querySelector('[data-k="mgroup"]');
    if (s) [...s.options].forEach(o => { o.selected = o.value === '__keep'; });
  }

  function groupsPanelRender() {
    append(pc, el('h2', { text: L.groupsTitle }));
    if (!D.groups.length) pc.appendChild(el('p', { class: 'hint', text: L.noGroups }));
    D.groups.forEach(g => {
      const k = 'g-' + g.id + '-';
      const cnt = D.tables.filter(t => t.group === g.id).length;
      let dark;
      const light = el('input', {
        type: 'color', value: g.color, 'data-k': k + 'color', 'aria-label': L.colorLight, title: L.colorLight,
        oninput: e => {
          g.color = e.target.value; g.colorDark = Model.lighten(g.color); dark.value = g.colorDark;
          ERD.applyGroupColors(D.groups);
          changed({ render: false, panel: false, merge: 'gc:' + g.id });
        },
        onchange: () => History.breakMerge()
      });
      dark = el('input', {
        type: 'color', value: g.colorDark, 'data-k': k + 'dark', 'aria-label': L.colorDark, title: L.colorDark,
        oninput: e => { g.colorDark = e.target.value; ERD.applyGroupColors(D.groups); changed({ render: false, panel: false, merge: 'gd:' + g.id }); },
        onchange: () => History.breakMerge()
      });
      pc.appendChild(el('div', { class: 'grow' }, [
        light, dark,
        textInput(k + 'title', g.title, v => { g.title = v; changed({ ids: [], panel: false, merge: 'gt:' + g.id }); }, { 'aria-label': L.groupTitle }),
        el('span', { class: 'cnt', text: String(cnt), title: plural(cnt, L.tablesN) }),
        btn('◎', () => setSelection(D.tables.filter(t => t.group === g.id).map(t => t.id)), 'xbtn', { 'aria-label': L.selectGroupTables, title: L.selectGroupTables, disabled: !cnt }),
        btn('✕', () => deleteGroup(g.id), 'xbtn', { 'aria-label': L.delGroup, title: L.delGroup, 'data-k': k + 'x' })
      ]));
    });
    pc.appendChild(btn(L.addGroup, () => createGroup([]), 'addbtn', { 'data-k': 'addgroup' }));
  }

  /* ======================= ХОЛСТ: МЫШЬ И ПАЛЕЦ ======================= */
  let drag = null, dropGid = null;
  function setDropGroup(gid) {
    if (gid === dropGid) return;
    if (dropGid && R.gEls.get(dropGid)) R.gEls.get(dropGid).r.classList.remove('drop');
    dropGid = gid;
    if (gid && R.gEls.get(gid)) R.gEls.get(gid).r.classList.add('drop');
  }
  let linkHl = null;
  function setLinkTarget(nodeEl, rowEl) {
    if (linkHl) { linkHl[0].classList.remove('linktarget'); if (linkHl[1]) linkHl[1].classList.remove('rowtarget'); }
    linkHl = nodeEl ? [nodeEl, rowEl] : null;
    if (nodeEl) { nodeEl.classList.add('linktarget'); if (rowEl) rowEl.classList.add('rowtarget'); }
  }

  svg.addEventListener('pointerdown', ev => {
    if (ev.button === 2) return;
    commitInline();
    const ae = document.activeElement;
    if (ae && ae !== document.body && !svg.contains(ae) && ae.blur) ae.blur();
    const tgt = ev.target, id = R.nodeIdOf(tgt), edit = mode === 'edit';
    const base = { sx: ev.clientX, sy: ev.clientY, moved: false, pid: ev.pointerId };
    pointerWorld = R.toWorld(ev.clientX, ev.clientY);
    if (ev.button === 1) {
      ev.preventDefault();
      drag = Object.assign(base, { type: 'pan', ox: D.view.x, oy: D.view.y });
    } else if (edit && id && tgt.classList.contains('port')) {
      const i = +tgt.closest('.row').getAttribute('data-i'), t = byId(id), n = R.info(id);
      drag = Object.assign(base, {
        type: 'link', id, i, p0: { x: t.x + n.w, y: t.y + C.HEAD + i * C.ROW + C.ROW / 2 },
        path: ERD.mk('path', { class: 'tmp-link' }, R.ol)
      });
    } else if (id) {
      if (edit && (ev.shiftKey || ev.ctrlKey || ev.metaKey)) {
        sel.has(id) ? sel.delete(id) : sel.add(id);
        groupsPanel = false; R.refresh(); renderPanel();
        drag = Object.assign(base, { type: 'none' });
      } else if (edit) {
        const wasSel = sel.has(id);
        if (!wasSel) {
          sel.clear(); sel.add(id); groupsPanel = false;
          /* панель откроется по клику (отпусканию без сдвига), а не в момент захвата;
             на ПК уже открытая панель просто переключается на новую таблицу */
          panelHoldId = ev.pointerType === 'touch' || !panel.classList.contains('open') ? id : null;
          R.refresh(); renderPanel();
        }
        const ids = [...sel].filter(x => { const t = byId(x); return t && R.isVisible(t); });
        drag = Object.assign(base, { type: 'move', id, ids, wasSel, start: new Map(ids.map(x => [x, { x: byId(x).x, y: byId(x).y }])) });
      } else {
        /* просмотр: клик по таблице показывает детали, перетаскивание ничего не делает */
        drag = Object.assign(base, { type: 'pan', ox: D.view.x, oy: D.view.y, clickId: id, noPan: true });
      }
    } else if (edit && tgt.classList.contains('gtitle')) {
      const gid = tgt.getAttribute('data-gid');
      const ids = D.tables.filter(t => t.group === gid && R.isVisible(t)).map(t => t.id);
      drag = Object.assign(base, { type: 'move', gid, id: ids[0], ids, group: true, start: new Map(ids.map(x => [x, { x: byId(x).x, y: byId(x).y }])) });
    } else if (edit) {
      /* левая кнопка по фону — рамка выделения (с Shift — добавить к выделению) */
      drag = Object.assign(base, {
        type: 'marquee', w0: pointerWorld, rect: ERD.mk('rect', { class: 'marquee' }, R.ol),
        base: new Set(ev.shiftKey ? sel : []), additive: ev.shiftKey
      });
    } else {
      /* просмотр: выделения нет; на сенсорном экране один палец двигает схему */
      drag = Object.assign(base, { type: 'pan', ox: D.view.x, oy: D.view.y, noPan: ev.pointerType !== 'touch' });
    }
    if (drag.type === 'pan' && !drag.noPan) svg.classList.add('panning');
    try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  });

  svg.addEventListener('pointermove', ev => {
    pointerWorld = R.toWorld(ev.clientX, ev.clientY); pointerInside = true;
    if (!drag) {
      const id = R.nodeIdOf(ev.target);
      if (id !== st.hovered) { st.hovered = id; if (!sel.size) R.refresh(); }
      return;
    }
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    const d = drag, k = D.view.k;
    if (d.type === 'pan') { if (!d.noPan) { D.view.x = d.ox + dx; D.view.y = d.oy + dy; R.applyView(); } }
    else if (d.type === 'move' && d.ids.length) {
      if (!d.grects && !d.group) d.grects = R.groupBounds(new Set(d.ids));
      const s0 = d.start.get(d.id) || d.start.get(d.ids[0]);
      let ddx = dx / k, ddy = dy / k;
      if (prefs.snap) { ddx = snapV(s0.x + ddx) - s0.x; ddy = snapV(s0.y + ddy) - s0.y; }
      d.ids.forEach(id => { const t = byId(id), s = d.start.get(id); t.x = s.x + ddx; t.y = s.y + ddy; });
      R.moveTables(d.ids);
      if (!d.group) {
        const prim = byId(d.id), p = pointerWorld; let g = null;
        d.grects.forEach((r, gid) => { if (gid !== prim.group && p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) g = gid; });
        setDropGroup(g);
      }
    } else if (d.type === 'marquee') {
      const p = pointerWorld, x0 = Math.min(d.w0.x, p.x), y0 = Math.min(d.w0.y, p.y), x1 = Math.max(d.w0.x, p.x), y1 = Math.max(d.w0.y, p.y);
      d.rect.setAttribute('x', x0); d.rect.setAttribute('y', y0); d.rect.setAttribute('width', x1 - x0); d.rect.setAttribute('height', y1 - y0);
      sel.clear(); d.base.forEach(id => sel.add(id));
      D.tables.forEach(t => {
        if (!R.isVisible(t)) return;
        const n = R.info(t.id);
        if (t.x < x1 && t.x + n.w > x0 && t.y < y1 && t.y + n.h > y0) sel.add(t.id);
      });
      R.refresh();
    } else if (d.type === 'link') {
      const p = pointerWorld, p0 = d.p0;
      d.path.setAttribute('d', `M${p0.x} ${p0.y}C${p0.x + 60} ${p0.y},${p.x - 60} ${p.y},${p.x} ${p.y}`);
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const nodeEl = hit && hit.closest ? hit.closest('.node') : null;
      setLinkTarget(nodeEl, nodeEl ? hit.closest('.row') : null);
    }
  });

  function endDrag(ev, cancelled) {
    if (!drag) return;
    const d = drag; drag = null;
    svg.classList.remove('panning');
    try { svg.releasePointerCapture(d.pid); } catch (e) { /* ignore */ }
    if (d.type === 'pan') {
      if (d.moved || cancelled) return;
      if (d.clickId) { const on = sel.has(d.clickId) && sel.size === 1; setSelection(on ? [] : [d.clickId]); }
      else if (sel.size || groupsPanel) { groupsPanel = false; setSelection([]); }
    } else if (d.type === 'move') {
      const drop = dropGid; setDropGroup(null);
      if (d.moved && cancelled) {
        d.start.forEach((s, id) => { const t = byId(id); if (t) { t.x = s.x; t.y = s.y; } });
        R.moveTables(d.ids);
      } else if (d.moved) {
        d.ids.forEach(id => { const t = byId(id); t.x = Math.round(t.x); t.y = Math.round(t.y); });
        if (drop && !cancelled) {
          d.ids.forEach(id => { byId(id).group = drop; });
          changed({ ids: d.ids });
          toast(fmt(L.movedToGroup, { name: ERD.groupById(D, drop).title }));
        } else { R.moveTables(d.ids); changed({ render: false, panel: false }); }
      } else if (cancelled) {
        /* захват прерван жестом двумя пальцами — ничего не открываем */
      } else if (d.group) {
        groupsPanel = true; sel.clear(); R.refresh(); renderPanel('g-' + d.gid + '-title');
      } else {
        /* клик по таблице без перемещения — открыть её панель */
        panelHoldId = null;
        if (d.wasSel && sel.size > 1) setSelection([d.id]); else renderPanel();
      }
    } else if (d.type === 'marquee') {
      d.rect.remove();
      /* простой клик по фону снимает выделение */
      if (!d.moved && !d.additive) { groupsPanel = false; setSelection([]); } else renderPanel();
    } else if (d.type === 'link') {
      d.path.remove(); setLinkTarget(null);
      if (d.moved && !cancelled) finishLink(d, ev);
    }
  }
  svg.addEventListener('pointerup', ev => endDrag(ev, false));
  svg.addEventListener('pointercancel', ev => endDrag(ev, true));
  svg.addEventListener('pointerleave', () => { pointerInside = false; if (!drag && st.hovered) { st.hovered = null; if (!sel.size) R.refresh(); } });
  /* Сенсорный экран (мышь и тачпад не меняются): один палец по фону — панорама,
     два пальца в режиме правки — рамка выделения между пальцами, в просмотре — щипок.
     Масштаб одним пальцем: двойное касание, или двойное касание и тянуть вверх/вниз. */
  let lastPointerType = 'mouse', touchRect = null;
  /* регистрируется раньше attachNavigation, чтобы видеть и касания, которые она перехватывает */
  addEventListener('pointerdown', e => { lastPointerType = e.pointerType; }, true);
  R.attachNavigation({
    onStart: commitInline,
    onGesture: () => { if (drag) endDrag({ clientX: 0, clientY: 0 }, true); st.hovered = null; },
    shouldPan: ev => {
      const t = ev.target;
      if (R.nodeIdOf(t)) return false;                                   /* карточка — перетаскивание */
      if (mode === 'edit' && t.classList && t.classList.contains('gtitle')) return false;  /* двигать группу */
      return true;
    },
    onTap: () => { if (sel.size || groupsPanel) { groupsPanel = false; setSelection([]); } },
    twoFinger: () => (mode === 'edit' ? 'select' : 'zoom'),
    onRectStart: () => { touchRect = ERD.mk('rect', { class: 'marquee' }, R.ol); groupsPanel = false; },
    onRectMove: (a, b) => {
      const p = R.toWorld(a.x, a.y), q = R.toWorld(b.x, b.y);
      const x0 = Math.min(p.x, q.x), y0 = Math.min(p.y, q.y), x1 = Math.max(p.x, q.x), y1 = Math.max(p.y, q.y);
      touchRect.setAttribute('x', x0); touchRect.setAttribute('y', y0);
      touchRect.setAttribute('width', x1 - x0); touchRect.setAttribute('height', y1 - y0);
      sel.clear();
      D.tables.forEach(t => {
        if (!R.isVisible(t)) return;
        const n = R.info(t.id);
        if (t.x < x1 && t.x + n.w > x0 && t.y < y1 && t.y + n.h > y0) sel.add(t.id);
      });
      R.refresh();
    },
    onRectEnd: () => { if (touchRect) touchRect.remove(); touchRect = null; renderPanel(); }
  });

  function finishLink(d, ev) {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const tid = R.nodeIdOf(hit); if (!tid) return;
    const tt = byId(tid), row = hit.closest('.row');
    const t = byId(d.id), c = t.columns[d.i];
    const pks = tt.columns.filter(x => x.pk);
    let column = null;
    if (row) {
      const ti = +row.getAttribute('data-i'), tc = tt.columns[ti];
      column = pks.length === 1 && pks[0] === tc ? null : tc.name;
      if (tid === d.id && ti === d.i) return;
    } else if (!pks.length) { toast(fmt(L.linkNoPk, { name: tt.name })); return; }
    c.ref = { table: tid, column };
    if (!c.type) { const tc = column != null ? tt.columns.find(x => x.name === column) : pks[0]; if (tc) c.type = tc.type; }
    changed();
    const target = column != null ? column : pks[0].name;
    toast(fmt(L.linkCreated, { from: t.name + '.' + c.name, to: tt.name + '.' + target }));
  }

  /* двойной клик: переименование на карточке / новая таблица на фоне */
  svg.addEventListener('dblclick', ev => {
    if (mode !== 'edit') return;
    const tgt = ev.target, id = R.nodeIdOf(tgt);
    if (id) {
      const t = byId(id), node = R.info(id).g, row = tgt.closest('.row');
      if (row && !tgt.classList.contains('port')) renameColumnInline(t, +row.getAttribute('data-i'));
      else if (!row) renameTableInline(t);
      return;
    }
    if (tgt.classList.contains('gtitle')) { renameGroupInline(tgt.getAttribute('data-gid')); return; }
    /* на сенсорном экране двойное касание фона — жест рамки выделения, а не новая таблица */
    if (lastPointerType === 'touch') return;
    const p = R.toWorld(ev.clientX, ev.clientY);
    addTable({ x: p.x, y: p.y }, tgt.classList.contains('gbox') ? tgt.getAttribute('data-gid') : null);
  });

  /* быстрое переименование прямо на карточке */
  function renameTableInline(t) {
    inlineEdit(R.info(t.id).g.querySelector('.tname'), t.name, v => { t.name = v; changed({ ids: [t.id] }); });
  }
  function renameColumnInline(t, i) {
    const cn = R.info(t.id).g.querySelector(`.row[data-i="${i}"] .cn`);
    if (cn) inlineEdit(cn, t.columns[i].name, v => { Model.renameColumn(D, t, i, v); changed(); });
  }
  function renameGroupInline(gid) {
    const g = ERD.groupById(D, gid), ge = R.gEls.get(gid);
    if (g && ge && ge.tx.style.display !== 'none') inlineEdit(ge.tx, g.title, v => { g.title = v; changed({ ids: [] }); });
  }

  /* контекстное меню холста: набор пунктов зависит от того, что под курсором */
  svg.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    if (drag) return;
    commitInline();
    const tgt = ev.target, id = R.nodeIdOf(tgt), edit = mode === 'edit';
    const p = R.toWorld(ev.clientX, ev.clientY);
    const items = [];
    const add = (label, fn, kbd, danger) => items.push({ label, fn, kbd, danger });
    const sep = () => items.push('-');
    if (id) {
      if (!sel.has(id)) setSelection([id]);
      const t = byId(id), row = tgt.closest('.row'), n = sel.size;
      if (edit && row && n === 1) {
        const i = +row.getAttribute('data-i');
        add(L.cmRenameColumn, () => renameColumnInline(t, i));
        add(L.cmInsertColumn, () => addColumn(t, i + 1));
        add(L.cmDeleteColumn, () => { Model.removeColumn(D, t, i); changed(); }, null, true);
        sep();
      }
      if (edit && n === 1) {
        add(L.cmRenameTable, () => renameTableInline(t));
        add(L.cmAddColumn, () => addColumn(t, t.columns.length));
        sep();
      }
      if (edit) add(L.cmDuplicate, duplicateSelected, 'Ctrl+D');
      add(L.cmCopy, () => copySelection(false), 'Ctrl+C');
      if (edit) {
        add(L.cmCut, () => copySelection(true), 'Ctrl+X');
        sep();
        add(L.cmNewGroup, () => createGroup([...sel]));
        if ([...sel].some(x => byId(x).group)) {
          add(L.cmUngroup, () => { const ids = [...sel]; ids.forEach(x => { byId(x).group = null; }); changed({ ids }); });
        }
        sep();
        add(n > 1 ? fmt(L.cmDeleteN, { n }) : L.cmDelete, deleteSelected, 'Delete', true);
      }
    } else if (tgt.classList.contains('gbox') || tgt.classList.contains('gtitle')) {
      const gid = tgt.getAttribute('data-gid');
      if (edit) add(L.cmAddTableToGroup, () => addTable(p, gid), 'N');
      if (edit) add(L.cmSelectGroup, () => setSelection(D.tables.filter(t => t.group === gid && R.isVisible(t)).map(t => t.id)));
      if (edit) {
        add(L.cmRenameGroup, () => renameGroupInline(gid));
        add(L.cmGroupSettings, () => { sel.clear(); groupsPanel = true; R.refresh(); renderPanel('g-' + gid + '-title'); });
        sep();
        add(L.cmDeleteGroup, () => deleteGroup(gid), null, true);
      }
    } else {
      if (edit) {
        add(L.cmAddTable, () => addTable(p, null), 'N');
        add(L.cmPaste, () => pasteFromButton(p), 'Ctrl+V');
        add(L.cmPasteJson, openPasteJson);
        sep();
      }
      if (edit) add(L.cmSelectAll, selectAll, 'Ctrl+A');
      add(L.cmFit, fitView, 'F');
      if (edit) {
        add(L.cmAutoLayout, doAutoLayout);
        add(L.cmGroups, () => { sel.clear(); groupsPanel = true; R.refresh(); renderPanel(); });
      }
    }
    if (items.length) popupMenu(items, { x: ev.clientX, y: ev.clientY }, null, L.cmAria);
  });

  let inline = null;
  function inlineEdit(textEl, value, onCommit) {
    commitInline();
    const r = textEl.getBoundingClientRect(), cs = getComputedStyle(textEl), k = D.view.k;
    const fs = Math.max(12, parseFloat(cs.fontSize) * k);
    const inp = el('input', {
      class: 'inline-edit mono', type: 'text', value, spellcheck: 'false', autocomplete: 'off',
      style: { left: (r.left - 6) + 'px', top: (r.top + r.height / 2 - fs / 2 - 6) + 'px', width: Math.max(160, r.width + 80) + 'px', 'font-size': fs + 'px', 'font-weight': cs.fontWeight }
    });
    document.body.appendChild(inp); inp.focus(); inp.select();
    inline = { inp, onCommit, value };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitInline(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelInline(); }
    });
    inp.addEventListener('blur', () => commitInline());
  }
  function commitInline() {
    if (!inline) return;
    const { inp, onCommit, value } = inline; inline = null;
    const v = inp.value.trim(); inp.remove();
    if (v && v !== value) onCommit(v);
  }
  function cancelInline() { if (!inline) return; const i = inline; inline = null; i.inp.remove(); }

  /* ======================= БУФЕР ОБМЕНА ======================= */
  function writeClipboard(text) {
    const fallback = () => {
      const prev = document.activeElement;
      const ta = el('textarea', { value: text, readonly: true, style: { position: 'fixed', left: '-9999px', top: '0', opacity: '0' } });
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* остаётся копия в localStorage */ }
      ta.remove(); if (prev && prev.focus) prev.focus({ preventScroll: true });
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
    else fallback();
  }
  function copySelection(cut) {
    if (!sel.size) { toast(L.nothingSelected); return; }
    if (cut && !canEdit()) return;
    const ids = [...sel];
    const text = JSON.stringify(Model.makeFragment(D, ids));
    Store.setClip(text);
    writeClipboard(text);
    if (cut) { Model.removeTables(D, ids); sel.clear(); changed(); }
    toast(fmt(cut ? L.cut : L.copied, { n: plural(ids.length, L.tablesN) }));
  }
  function parseFragment(text, warnings) {
    if (!text || !/^\s*[{<]/.test(text)) return null;
    try {
      const raw = JSON.parse(text);
      if (!raw || (raw.format !== Model.CLIP && raw.format !== Model.FORMAT)) return null;
      return Model.normalizeFragment(raw, warnings);
    } catch (e) { return null; }
  }
  /* вставка: системный буфер → при неудаче копия в localStorage */
  function pasteText(text, where) {
    if (!canEdit()) return true;
    const warnings = [];
    const frag = parseFragment(text, warnings) || parseFragment(Store.getClip(), warnings);
    if (!frag || !frag.tables.length) return false;
    insertFrag(frag, where, warnings);
    return true;
  }
  function insertFrag(frag, where, warnings) {
    const pos = where && typeof where === 'object' ? where
      : where === 'cursor' && pointerInside && pointerWorld ? pointerWorld : R.viewCenter(margins());
    const res = Model.insertFragment(D, frag, pos, { snap: prefs.snap ? C.GRID : 0 });
    sel.clear(); res.ids.forEach(id => sel.add(id)); groupsPanel = false;
    changed();
    toast(fmt(L.pasted, { n: plural(res.ids.length, L.tablesN) }));
    if (res.renamed.length) toast(fmt(L.renamedOnPaste, { list: res.renamed.slice(0, 6).join(', ') + (res.renamed.length > 6 ? '…' : '') }), { timeout: 6000 });
    if (warnings && warnings.length) toast(warnings[0] + (warnings.length > 1 ? ` (+${warnings.length - 1})` : ''), { type: 'warn', timeout: 6000 });
  }
  let pasteHandled = true;
  /* На Linux средняя кнопка мыши вставляет «первичное выделение» (primary selection) —
     браузер шлёт событие paste. Панорама средней кнопкой не должна ничего вставлять. */
  let middleAt = -Infinity;
  const markMiddle = e => { if (e.button === 1) middleAt = performance.now(); };
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick'].forEach(t => document.addEventListener(t, markMiddle, true));
  svg.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
  document.addEventListener('paste', e => {
    if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
    if (performance.now() - middleAt < 1000) { e.preventDefault(); return; }
    pasteHandled = true;
    if (mode !== 'edit') return;
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!pasteText(text, 'cursor')) toast(L.clipEmpty);
  });
  async function pasteFromButton(where) {
    if (!canEdit()) return;
    let text = null;
    try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); } catch (e) { /* запрещено браузером */ }
    if (!pasteText(text, where || 'center')) openPasteJson();
  }
  async function openPasteJson() {
    if (!canEdit()) return;
    const ta = el('textarea', { spellcheck: 'false', 'aria-label': L.pasteJsonTitle });
    let frag = null; const warnings = [];
    const v = await dialog({
      title: L.pasteJsonTitle, body: [el('p', { class: 'hint', text: L.pasteJsonHelp }), ta],
      buttons: [{ value: 'ok', label: L.pasteJsonBtn, primary: true }, { value: '', label: L.cancel }],
      onOpen: () => ta.focus(),
      validate: () => {
        try {
          const raw = JSON.parse(ta.value);
          frag = Model.normalizeFragment(raw, warnings);
          return frag.tables.length ? null : L.clipBadFormat;
        } catch (e) { return e instanceof SyntaxError ? fmt(L.eJson, { msg: e.message }) : e.message; }
      }
    });
    if (v === 'ok' && frag) insertFrag(frag, 'center', warnings);
  }

  /* ======================= ИМПОРТ ======================= */
  async function importFile(file) {
    let text;
    try { text = await file.text(); } catch (e) { toast(L.importFailed, { type: 'error' }); return; }
    importText(text, file.name);
  }
  async function importText(text, filename) {
    let res;
    try { res = Model.parseAny(text, filename); }
    catch (e) {
      await dialog({ title: L.importFailed, body: el('p', { text: e instanceof Model.ModelError ? e.message : String(e && e.message || e) }), buttons: [{ value: 'ok', label: L.ok, primary: true }] });
      return;
    }
    if (res.kind === 'clipboard') { if (canEdit()) insertFrag(res.fragment, 'center', res.warnings); return; }
    flushSave();
    if (res.kind === 'diagram') {
      const d = res.diagrams[0], ne = ERD.buildIndex(d).edges.length;
      const collide = Store.has(d.id) || d.id === D.id;
      const v = await dialog({
        title: L.importTitle,
        body: [el('p', { text: fmt(L.importOne, { name: d.name, tables: plural(d.tables.length, L.tablesN), edges: plural(ne, L.edgesN) }) }),
          collide ? el('p', { class: 'hint', text: L.importCollideOne }) : null].concat(warnList(res.warnings) || []),
        buttons: [{ value: 'new', label: L.importAsNew, primary: true }, { value: 'replace', label: L.importReplace }, { value: '', label: L.cancel }]
      });
      if (v === 'new') {
        if (collide) d.id = Model.uid();
        try { Store.save(d); } catch (e) { if (Store.isQuota(e)) { showQuota(); return; } }
        openDiagram(d);
        toast(fmt(L.importDone, { n: 1 }));
      } else if (v === 'replace') {
        if (mode !== 'edit') setMode('edit');
        D.name = d.name; D.groups = d.groups; D.tables = d.tables;
        sel.clear(); groupsPanel = false; st.hidden.clear();
        $('#dname').value = D.name;
        changed();
        if (d.view) { Object.assign(D.view, d.view); R.applyView(); } else fitView();
      }
      return;
    }
    /* bundle */
    const coll = res.diagrams.filter(d => Store.has(d.id)).length;
    const buttons = [{ value: 'new', label: L.importAllNew, primary: true }];
    if (coll) buttons.push({ value: 'overwrite', label: L.importOverwrite, danger: true });
    buttons.push({ value: '', label: L.cancel });
    const v = await dialog({
      title: L.importTitle,
      body: [el('p', { text: fmt(L.importBundle, { n: res.diagrams.length }) }), coll ? el('p', { class: 'hint', text: fmt(L.importCollide, { n: coll }) }) : null].concat(warnList(res.warnings) || []),
      buttons
    });
    if (!v) return;
    let first = null, reloadCur = false;
    try {
      res.diagrams.forEach(d => {
        if (Store.has(d.id)) { if (v === 'new') d.id = Model.uid(); else if (d.id === D.id) reloadCur = true; }
        Store.save(d); first = first || d;
      });
    } catch (e) { if (Store.isQuota(e)) showQuota(); else toast(e.message, { type: 'error' }); }
    if (reloadCur) { const nd = Store.load(D.id); if (nd) { D = null; openDiagram(nd); } }
    else if (first && v === 'new') openDiagram(first);
    renderSidebar();
    toast(fmt(L.importDone, { n: res.diagrams.length }));
  }
  $('#file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
  const pickFile = () => $('#file').click();

  /* drag&drop файла на окно */
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#drop').hidden = false; });
  addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
  addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $('#drop').hidden = true;
    const f = e.dataTransfer.files[0]; if (f) importFile(f);
  });

  /* ======================= ЭКСПОРТ ======================= */
  /* текущая диаграмма берётся из памяти (с принудительным сохранением), остальные — из хранилища */
  function diagramFor(id) { if (D && id === D.id) { flushSave(); return D; } return Store.load(id); }
  function exportJsonOf(id) {
    const d = diagramFor(id); if (!d) return;
    download(safeName(d.name) + '.json', JSON.stringify(Model.toJSON(d), null, 2), 'application/json');
  }
  function exportHtmlOf(id) {
    const d = diagramFor(id); if (!d) return;
    download(safeName(d.name) + '.html', buildStandaloneHtml(d), 'text/html');
  }
  const exportJson = () => exportJsonOf(D.id);
  function exportAll() {
    flushSave();
    const diagrams = Store.list().map(x => Store.load(x.id)).filter(Boolean).map(Model.toJSON);
    const bundle = { format: Model.BUNDLE, version: Model.VERSION, exportedAt: Model.now(), diagrams };
    download('schemify-diagrams-' + dateStamp() + '.json', JSON.stringify(bundle, null, 2), 'application/json');
  }
  const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* автономный HTML: данные — JSON в <script type="application/json">, CSS и код просмотрщика — инлайн */
  function buildStandaloneHtml(d) {
    const data = JSON.stringify(Model.toJSON(d)).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const code = ERDCoreFactory.toString().replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
    return '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<link rel="icon" href="data:,">\n' +
      `<meta name="generator" content="Schemify">\n<title>${escHtml(d.name)} — ${escHtml(L.schemaSuffix)}</title>\n` +
      `<style>${ERD.CSS}</style>\n</head>\n<body>\n` +
      `<script type="application/json" id="erd-data">${data}</script>\n` +
      `<script>\n"use strict";\nvar ERD = (${code})();\nERD.runViewer(JSON.parse(document.getElementById("erd-data").textContent));\n</script>\n` +
      '</body>\n</html>\n';
  }
  const exportHtml = () => exportHtmlOf(D.id);
  /* SVG: клон слоёв с вычисленными стилями (файл не зависит от CSS-переменных) */
  const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'opacity',
    'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing'];
  function inlineClone(src) {
    if (src.nodeType !== 1) return src.cloneNode(false);
    if (src.classList.contains('hit') || src.classList.contains('port') || src.tagName === 'title') return null;
    const cs = getComputedStyle(src);
    if (cs.display === 'none') return null;
    const dst = src.cloneNode(false);
    dst.removeAttribute('class'); dst.removeAttribute('style'); dst.removeAttribute('id');
    if (src.tagName === 'g') { if (cs.opacity !== '1') dst.setAttribute('opacity', cs.opacity); }
    else dst.setAttribute('style', STYLE_PROPS.map(p => p + ':' + cs.getPropertyValue(p)).join(';'));
    src.childNodes.forEach(ch => { const c = inlineClone(ch); if (c) dst.appendChild(c); });
    return dst;
  }
  function buildSvg() {
    const saved = { sel: [...sel], hov: st.hovered, q: st.query };
    sel.clear(); st.hovered = null; st.query = ''; R.refresh();
    try {
      const b = R.bounds(); if (!b) throw new Error(L.emptyHint.split('.')[0]);
      const x0 = b.x0, y0 = b.y0, w = Math.ceil(b.x1 - b.x0), h = Math.ceil(b.y1 - b.y0);
      const cs = getComputedStyle(document.documentElement), v = p => cs.getPropertyValue(p).trim();
      const out = ERD.mk('svg', { width: w, height: h, viewBox: `${x0} ${y0} ${w} ${h}` });
      const defs = ERD.mk('defs', {}, out);
      const pat = ERD.mk('pattern', { id: 'dots', width: C.GRID, height: C.GRID, patternUnits: 'userSpaceOnUse' }, defs);
      ERD.mk('circle', { cx: 1.2, cy: 1.2, r: 1.2, fill: v('--grid') }, pat);
      ERD.mk('rect', { x: x0, y: y0, width: w, height: h, fill: v('--bg') }, out);
      ERD.mk('rect', { x: x0, y: y0, width: w, height: h, fill: 'url(#dots)' }, out);
      [R.gl, R.el, R.nl].forEach(layer => { const c = inlineClone(layer); if (c) out.appendChild(c); });
      return { text: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(out), w, h };
    } finally {
      saved.sel.forEach(id => sel.add(id)); st.hovered = saved.hov; st.query = saved.q; R.refresh();
    }
  }
  function exportSvg() {
    try { download(safeName(D.name) + '.svg', buildSvg().text, 'image/svg+xml'); }
    catch (e) { toast(fmt(L.exportFailed, { msg: e.message }), { type: 'error' }); }
  }
  function exportPng() {
    let s;
    try { s = buildSvg(); } catch (e) { toast(fmt(L.exportFailed, { msg: e.message }), { type: 'error' }); return; }
    const scale = Math.max(0.1, Math.min(2, 16000 / s.w, 16000 / s.h, Math.sqrt(2.4e8 / (s.w * s.h))));
    const img = new Image();
    img.onload = () => {
      try {
        const cv = el('canvas', { width: Math.round(s.w * scale), height: Math.round(s.h * scale) });
        const ctx = cv.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, s.w, s.h);
        cv.toBlob(b => { if (b) download(safeName(D.name) + '.png', b); else toast(fmt(L.exportFailed, { msg: 'canvas' }), { type: 'error' }); }, 'image/png');
      } catch (e) { toast(fmt(L.exportFailed, { msg: e.message }), { type: 'error' }); }
    };
    img.onerror = () => toast(fmt(L.exportFailed, { msg: 'SVG → PNG' }), { type: 'error' });
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.text);
  }

  /* ======================= СПИСОК ДИАГРАММ ======================= */
  function renderSidebar() {
    const ul = $('#dlist'); if (!ul) return;
    const key = focusKey(ul);
    ul.textContent = '';
    const list = Store.list();
    if (D && !list.some(x => x.id === D.id)) list.unshift({ id: D.id });
    list.forEach(x => {
      const cur = D && x.id === D.id;
      const info = cur ? { name: D.name, tables: D.tables.length, updatedAt: D.updatedAt } : x;
      const open = ev => { ev.preventDefault(); openDiagramMenu(x.id, info.name, ev); };
      ul.appendChild(el('li', { class: 'ditem' + (cur ? ' cur' : '') }, [
        el('button', {
          type: 'button', class: 'dopen', 'aria-current': cur ? 'true' : null, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
          'data-k': 'o' + x.id, onclick: open, oncontextmenu: open,
          ondblclick: () => { closePopup(); switchTo(x.id); }
        }, [
          el('span', { class: 'dn', text: info.name }),
          el('span', { class: 'dm', text: plural(info.tables || 0, L.tablesN) + ' · ' + timeLabel(info.updatedAt) }),
          el('span', { class: 'dmore', text: '⋯', 'aria-hidden': 'true' })
        ])
      ]));
    });
    restoreFocus(ul, key);
  }
  function openDiagramMenu(id, name, ev) {
    const anchor = ev.currentTarget;
    /* повторный клик по той же диаграмме закрывает меню */
    if (lastPopup && lastPopup.id === id && performance.now() - lastPopup.t < 350) return;
    const cur = D && id === D.id, r = anchor.getBoundingClientRect();
    const pt = ev.type === 'click' && ev.detail === 0 ? { x: r.left + 12, y: r.bottom + 2 } : { x: ev.clientX, y: ev.clientY };
    popupMenu([
      cur ? null : { label: L.dmOpen, fn: () => switchTo(id) },
      { label: L.dmExportJson, fn: () => exportJsonOf(id) },
      { label: L.dmExportHtml, fn: () => exportHtmlOf(id) },
      '-',
      { label: L.dmRename, fn: () => renameDiagram(id) },
      { label: L.dmDuplicate, fn: () => duplicateDiagram(id) },
      '-',
      { label: L.dmDelete, fn: () => deleteDiagram(id), danger: true }
    ].filter(Boolean), pt, anchor, fmt(L.dmMenuAria, { name }), id);
  }
  function switchTo(id) {
    if (D && id === D.id) return;
    flushSave();
    const d = Store.load(id);
    if (!d) { toast(L.importFailed, { type: 'error' }); renderSidebar(); return; }
    openDiagram(d);
    if (!wide()) setSidebar(false);
  }
  function newDiagram() {
    flushSave();
    const n = Store.list().length + 1;
    openDiagram(Model.newDiagram(L.newDiagramName + ' ' + n));
    if (mode !== 'edit') setMode('edit');
  }
  async function renameDiagram(id) {
    const cur = id === D.id, d = cur ? D : Store.load(id); if (!d) return;
    const name = await promptDlg(L.renameTitle, d.name);
    if (!name || name === d.name) return;
    if (cur) { D.name = name; $('#dname').value = name; document.title = name + ' — ' + L.appTitle; changed({ render: false, panel: false }); renderSidebar(); }
    else { d.name = name; d.updatedAt = Model.now(); try { Store.save(d); } catch (e) { if (Store.isQuota(e)) showQuota(); } renderSidebar(); }
  }
  function duplicateDiagram(id) {
    flushSave();
    const d = id === D.id ? Model.normalizeDiagram(Model.toJSON(D)).diagram : Store.load(id); if (!d) return;
    d.id = Model.uid(); d.name += L.copySuffix; d.updatedAt = Model.now();
    try { Store.save(d); } catch (e) { if (Store.isQuota(e)) { showQuota(); return; } }
    openDiagram(d);
  }
  async function deleteDiagram(id) {
    const info = id === D.id ? D : (Store.list().find(x => x.id === id) || { name: '' });
    if (!(await confirmDlg(L.deleteTitle, fmt(L.deleteDiagramQ, { name: info.name }), L.del))) return;
    if (id === D.id) { clearTimeout(saveTimer); saveTimer = null; clearTimeout(viewTimer); viewTimer = null; }
    Store.remove(id);
    if (id === D.id) {
      D = null;
      const rest = Store.list();
      const next = rest.length ? Store.load(rest[0].id) : null;
      openDiagram(next || Model.newDiagram(L.newDiagramName));
    }
    renderSidebar();
  }
  function loadSample() {
    flushSave();
    const d = Samples.network();
    try { Store.save(d); } catch (e) { if (Store.isQuota(e)) showQuota(); }
    openDiagram(d);
    toast(fmt(L.sampleLoaded, { n: d.tables.length }));
  }

  /* ======================= МИНИ-КАРТА ======================= */
  const mm = $('#minimap'), mmc = mm.querySelector('canvas');
  let mmPending = false, mmT = null;
  function scheduleMinimap() {
    if (!prefs.minimap || mmPending) return;
    mmPending = true;
    requestAnimationFrame(() => { mmPending = false; drawMinimap(); });
  }
  function drawMinimap() {
    if (!D || mm.hidden || !mmc.clientWidth) return;
    const dpr = devicePixelRatio || 1, W = mmc.clientWidth, H = mmc.clientHeight;
    if (mmc.width !== Math.round(W * dpr)) { mmc.width = Math.round(W * dpr); mmc.height = Math.round(H * dpr); }
    const ctx = mmc.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const cs = getComputedStyle(document.documentElement), cv = p => cs.getPropertyValue(p).trim();
    const v = D.view, th = topBar.offsetHeight;
    const vr = { x0: -v.x / v.k, y0: (th - v.y) / v.k, x1: (innerWidth - v.x) / v.k, y1: (innerHeight - v.y) / v.k };
    const b = R.bounds() || vr;
    const u = { x0: Math.min(b.x0, vr.x0), y0: Math.min(b.y0, vr.y0), x1: Math.max(b.x1, vr.x1), y1: Math.max(b.y1, vr.y1) };
    const s = Math.min((W - 12) / (u.x1 - u.x0), (H - 12) / (u.y1 - u.y0));
    const ox = (W - (u.x1 - u.x0) * s) / 2 - u.x0 * s, oy = (H - (u.y1 - u.y0) * s) / 2 - u.y0 * s;
    mmT = { s, ox, oy };
    const X = x => ox + x * s, Y = y => oy + y * s;
    const colorOf = gid => (gid && cv('--c-' + gid)) || cv('--nogroup');
    R.groupBounds().forEach((r, gid) => {
      ctx.globalAlpha = 0.13; ctx.fillStyle = colorOf(gid);
      ctx.fillRect(X(r.x0), Y(r.y0), (r.x1 - r.x0) * s, (r.y1 - r.y0) * s);
    });
    D.tables.forEach(t => {
      if (!R.isVisible(t)) return;
      const n = R.info(t.id); if (!n) return;
      ctx.globalAlpha = sel.size && !sel.has(t.id) ? 0.45 : 0.9;
      ctx.fillStyle = colorOf(t.group);
      ctx.fillRect(X(t.x), Y(t.y), Math.max(1.5, n.w * s), Math.max(1.5, n.h * s));
    });
    ctx.globalAlpha = 1; ctx.strokeStyle = cv('--text'); ctx.lineWidth = 1.2;
    ctx.fillStyle = cv('--text'); ctx.globalAlpha = 0.06;
    ctx.fillRect(X(vr.x0), Y(vr.y0), (vr.x1 - vr.x0) * s, (vr.y1 - vr.y0) * s);
    ctx.globalAlpha = 0.7;
    ctx.strokeRect(X(vr.x0) + 0.5, Y(vr.y0) + 0.5, (vr.x1 - vr.x0) * s, (vr.y1 - vr.y0) * s);
    ctx.globalAlpha = 1;
  }
  let mmDrag = false;
  const mmGo = e => {
    if (!mmT) return;
    const r = mmc.getBoundingClientRect();
    const wx = (e.clientX - r.left - mmT.ox) / mmT.s, wy = (e.clientY - r.top - mmT.oy) / mmT.s;
    const v = D.view, th = topBar.offsetHeight;
    v.x = innerWidth / 2 - wx * v.k; v.y = th + (innerHeight - th) / 2 - wy * v.k;
    R.applyView();
  };
  mmc.addEventListener('pointerdown', e => { R.stopInertia(); mmDrag = true; mmc.setPointerCapture(e.pointerId); mmGo(e); });
  mmc.addEventListener('pointermove', e => { if (mmDrag) mmGo(e); });
  mmc.addEventListener('pointerup', () => { mmDrag = false; });
  mm.querySelector('.mm-close').addEventListener('click', () => setMinimap(false));
  $('#mm-show').addEventListener('click', () => setMinimap(true));

  /* ======================= МЕНЮ «ФАЙЛ» ======================= */
  const menu = $('#file-menu'), fileBtn = $('#b-file');
  const ACTIONS = {
    import: pickFile, exportJson, exportHtml, exportSvg, exportPng, exportAll,
    copy: () => copySelection(false), paste: () => pasteFromButton(), pasteJson: openPasteJson,
    newDiagram, sample: loadSample, minimap: () => setMinimap(!prefs.minimap)
  };
  function renderMenu() {
    const items = [['import', L.mImport], ['exportJson', L.mExportJson, 'Ctrl+S'], ['exportHtml', L.mExportHtml], ['exportSvg', L.mExportSvg],
      ['exportPng', L.mExportPng], ['exportAll', L.mExportAll], '-', ['copy', L.mCopy, 'Ctrl+C'], ['paste', L.mPaste, 'Ctrl+V'],
      ['pasteJson', L.mPasteJson], '-', ['newDiagram', L.mNewDiagram], ['sample', L.mSample], '-', ['minimap', L.minimap]];
    menu.textContent = '';
    items.forEach(it => {
      if (it === '-') { menu.appendChild(el('hr', { role: 'separator' })); return; }
      const [act, label, kbd] = it, isCheck = act === 'minimap';
      menu.appendChild(el('button', {
        type: 'button', role: isCheck ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': isCheck ? String(!!prefs.minimap) : null,
        onclick: () => { closeMenu(true); ACTIONS[act](); }
      }, [el('span', { text: label }), kbd ? el('kbd', { text: kbd }) : null]));
    });
  }
  function openMenu() { menu.hidden = false; fileBtn.setAttribute('aria-expanded', 'true'); menu.querySelector('button').focus(); }
  function closeMenu(focusBtn) { if (menu.hidden) return; menu.hidden = true; fileBtn.setAttribute('aria-expanded', 'false'); if (focusBtn) fileBtn.focus(); }
  fileBtn.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && !fileBtn.contains(e.target)) closeMenu(); }, true);
  function menuKeys(m, close) {
    m.addEventListener('keydown', e => {
      const items = [...m.querySelectorAll('button')], i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); items[e.key === 'Home' ? 0 : items.length - 1].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') close(false);
    });
  }
  menuKeys(menu, closeMenu);

  /* всплывающее меню (действия с диаграммой в левой панели) */
  let popup = null, lastPopup = null;
  function closePopup(focusAnchor) {
    if (!popup) return;
    const p = popup; popup = null;
    p.m.remove();
    if (p.anchor) p.anchor.setAttribute('aria-expanded', 'false');
    lastPopup = { id: p.id, t: performance.now() };
    if (focusAnchor && p.anchor && p.anchor.isConnected) p.anchor.focus();
  }
  function popupMenu(items, pt, anchor, label, id) {
    closePopup(); lastPopup = null;
    const m = el('div', { class: 'menu popup', role: 'menu', 'aria-label': label });
    items = items.filter((it, i, a) => it !== '-' || (i > 0 && i < a.length - 1 && a[i - 1] !== '-'));
    items.forEach(it => {
      if (it === '-') { m.appendChild(el('hr', { role: 'separator' })); return; }
      m.appendChild(el('button', {
        type: 'button', role: 'menuitem', class: it.danger ? 'danger' : null,
        onclick: () => { closePopup(true); lastPopup = null; it.fn(); }
      }, [el('span', { text: it.label }), it.kbd ? el('kbd', { text: it.kbd }) : null]));
    });
    document.body.appendChild(m);
    m.style.left = Math.max(8, Math.min(pt.x, innerWidth - m.offsetWidth - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(pt.y, innerHeight - m.offsetHeight - 8)) + 'px';
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    popup = { m, anchor, id };
    menuKeys(m, closePopup);
    m.querySelector('button').focus();
  }
  document.addEventListener('pointerdown', e => { if (popup && !popup.m.contains(e.target)) closePopup(); }, true);
  addEventListener('resize', () => closePopup());

  /* ======================= СПРАВКА И ПРОМПТЫ ДЛЯ НЕЙРОСЕТИ ======================= */
  /* JSON для промпта: без раскладки и служебных полей — меньше токенов */
  function schemaForAi(d) {
    const o = Model.toJSON(d);
    delete o.view; delete o.updatedAt; delete o.id;
    o.groups.forEach(g => { delete g.colorDark; });
    o.tables.forEach(t => { delete t.x; delete t.y; });
    return JSON.stringify(o, null, 2);
  }
  function copyText(text) { writeClipboard(text); toast(L.aiCopied); }
  const promptWithSchema = () => { flushSave(); return L.promptFromJson.replace(L.promptJsonPlaceholder, schemaForAi(D)); };
  async function showPrompt(title, text) {
    const ta = el('textarea', { readonly: true, value: text, 'aria-label': title, spellcheck: 'false' });
    const v = await dialog({
      title, body: ta, onOpen: () => { ta.scrollTop = 0; },
      buttons: [{ value: 'copy', label: L.aiCopy, primary: true }, { value: '', label: L.close }]
    });
    if (v === 'copy') copyText(text);
  }
  async function importAiAnswer() {
    const ta = el('textarea', { spellcheck: 'false', 'aria-label': L.aiImportTitle });
    const v = await dialog({
      title: L.aiImportTitle, body: [el('p', { class: 'hint', text: L.aiImportHelp }), ta],
      buttons: [{ value: 'ok', label: L.aiImportBtn, primary: true }, { value: '', label: L.cancel }],
      onOpen: () => ta.focus(),
      validate: () => { try { Model.parseAny(ta.value); return null; } catch (e) { return e.message; } }
    });
    if (v === 'ok') importText(ta.value, 'answer.json');
  }
  function renderHelp() {
    append($('#help-controls'), el('dl', { class: 'hdl' }, L.controls.map(([a, b]) => [el('dt', { text: a }), el('dd', { text: b })])));
    append($('#help-keys'), [
      el('dl', { class: 'hdl keys' }, L.keys.map(([a, b]) => [el('dt', {}, a.split(/(, | \/ )/).map(k => (/^(, | \/ )$/.test(k) ? k : el('kbd', { text: k })))), el('dd', { text: b })])),
      el('p', { class: 'hint', text: L.keysNote })
    ]);
    const card = (title, text, buttons) => el('div', { class: 'aicard' }, [el('h4', { text: title }), el('p', { class: 'hint', text }), el('div', { class: 'aibtns' }, buttons)]);
    append($('#help-ai'), [
      el('p', { class: 'hint', text: L.aiIntro }),
      card(L.aiToJsonTitle, L.aiToJsonText, [
        btn(L.aiCopy, () => copyText(L.promptToJson), 'primary'),
        btn(L.aiShow, () => showPrompt(L.aiToJsonTitle, L.promptToJson)),
        btn(L.aiImport, importAiAnswer)
      ]),
      card(L.aiFromJsonTitle, L.aiFromJsonText, [
        btn(L.aiCopyWithJson, () => copyText(promptWithSchema()), 'primary'),
        btn(L.aiCopy, () => copyText(L.promptFromJson)),
        btn(L.aiShow, () => showPrompt(L.aiFromJsonTitle, promptWithSchema()))
      ])
    ]);
    /* какие разделы раскрыты — запоминается */
    const open = prefs.help || {};
    document.querySelectorAll('#sidebar details[data-help]').forEach(d => {
      const k = d.dataset.help;
      if (k in open) d.open = !!open[k];
      d.addEventListener('toggle', () => { prefs.help = Object.assign({}, prefs.help, { [k]: d.open }); savePrefs(); });
    });
  }

  /* ======================= ГОРЯЧИЕ КЛАВИШИ ======================= */
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented) return;
    if (isTyping(e.target)) {
      if (e.key === 'Escape' && pc.contains(e.target)) e.target.blur();
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey, code = e.code;
    if (mod && !e.altKey) {
      switch (code) {
        case 'KeyZ': e.preventDefault(); e.shiftKey ? redo() : undo(); return;
        case 'KeyY': e.preventDefault(); redo(); return;
        case 'KeyC': if (hasTextSelection() || !sel.size) return; e.preventDefault(); copySelection(false); return;
        case 'KeyX': if (hasTextSelection() || !sel.size) return; e.preventDefault(); copySelection(true); return;
        case 'KeyV':
          if (mode !== 'edit') return;
          /* обычно придёт событие paste; если браузер его не прислал — берём копию из localStorage */
          pasteHandled = false;
          setTimeout(() => { if (!pasteHandled) { pasteHandled = true; if (!pasteText(null, 'cursor')) toast(L.clipEmpty); } }, 120);
          return;
        case 'KeyD': e.preventDefault(); duplicateSelected(); return;
        case 'KeyS': e.preventDefault(); exportJson(); return;
        case 'KeyF': e.preventDefault(); $('#q').focus(); $('#q').select(); return;
        case 'KeyA': e.preventDefault(); if (mode === 'edit') selectAll(); return;
      }
      return;
    }
    if (e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.size) { e.preventDefault(); deleteSelected(); } return; }
    if (e.key === 'Escape') {
      if (drag) { endDrag({ clientX: 0, clientY: 0 }, true); return; }
      closeMenu(); closePopup(); groupsPanel = false; setSelection([]); return;
    }
    if (code === 'KeyF' && !e.shiftKey) { e.preventDefault(); fitView(); }
    if (code === 'KeyN' && !e.shiftKey) {
      e.preventDefault(); closePopup();
      if (!pointerInside || !pointerWorld) { addTable(); return; }
      /* под курсором; внутри рамки группы — сразу в эту группу */
      const p = pointerWorld; let gid = null;
      R.groupBounds().forEach((r, g) => { if (p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) gid = g; });
      addTable(p, gid);
    }
  });

  /* ======================= КНОПКИ ======================= */
  $('#sb-toggle').addEventListener('click', () => setSidebar(!document.body.classList.contains('sb-open')));
  $('#m-view').addEventListener('click', () => setMode('view'));
  $('#m-edit').addEventListener('click', () => setMode('edit'));
  $('#b-add-table').addEventListener('click', () => addTable());
  $('#b-groups').addEventListener('click', () => { groupsPanel = !(groupsPanel && !sel.size); sel.clear(); R.refresh(); renderPanel(); });
  $('#b-undo').addEventListener('click', undo);
  $('#b-redo').addEventListener('click', redo);
  $('#fit').addEventListener('click', fitView);
  $('#b-layout').addEventListener('click', doAutoLayout);
  $('#b-snap').addEventListener('click', () => { prefs.snap = !prefs.snap; savePrefs(); $('#b-snap').setAttribute('aria-pressed', String(prefs.snap)); });
  $('#theme').addEventListener('click', () => { ERD.setTheme(ERD.currentTheme() === 'dark' ? 'light' : 'dark', true); scheduleMinimap(); });
  $('#sb-new').addEventListener('click', newDiagram);
  $('#sb-import').addEventListener('click', pickFile);
  $('#sb-export-all').addEventListener('click', exportAll);
  $('#sb-sample').addEventListener('click', loadSample);
  const dname = $('#dname');
  dname.addEventListener('input', () => {
    D.name = dname.value; document.title = (D.name || '…') + ' — ' + L.appTitle;
    changed({ render: false, panel: false, merge: 'dname' });
  });
  dname.addEventListener('blur', () => {
    History.breakMerge();
    if (!dname.value.trim()) { dname.value = D.name = L.newDiagramName; changed({ render: false, panel: false }); }
  });
  dname.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') dname.blur(); });

  const setTh = () => { document.documentElement.style.setProperty('--th', topBar.offsetHeight + 'px'); scheduleMinimap(); };
  if (window.ResizeObserver) new ResizeObserver(setTh).observe(topBar);
  addEventListener('resize', setTh);

  /* ======================= ИНИЦИАЛИЗАЦИЯ ======================= */
  function init() {
    applyI18n(); renderMenu(); renderHelp(); setTh();
    setMode(mode);
    if (wide()) setSidebar(!!prefs.sidebar); else $('#sb-toggle').setAttribute('aria-expanded', 'false');
    $('#b-snap').setAttribute('aria-pressed', String(!!prefs.snap));
    $('#minimap').hidden = !prefs.minimap; $('#mm-show').hidden = !!prefs.minimap;
    const list = Store.list();
    let d = null;
    if (list.length) {
      const last = Store.getLast();
      d = (last && Store.load(last)) || list.map(x => Store.load(x.id)).find(Boolean) || null;
    }
    if (!d) d = Samples.demo();
    openDiagram(d);
    if (!Store.persistent) toast(L.storageUnavailable, { type: 'warn', timeout: 9000 });
    setInterval(renderSidebar, 60000);
  }
  init();

  /* отладочный доступ из консоли (не используется самим приложением) */
  window.ERDApp = { get diagram() { return D; }, renderer: R, buildStandaloneHtml, importText, History };
})();
