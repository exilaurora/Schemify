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
      const form = el('form', { method: 'dialog', novalidate: o.noValidate }, [
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
    onStats: s => { $('#stats').textContent = countObjects(s.tables, D.kind) + ' · ' + plural(s.edges, L.edgesN); },
    onView: () => { scheduleViewSave(); scheduleMinimap(); }
  });
  const st = R.st, sel = st.selected;
  const byId = id => R.idx.byId.get(id);
  const canEdit = () => { if (mode === 'edit') return true; toast(L.viewModeRO); return false; };
  const isConceptual = () => D.kind === 'conceptual';
  const countObjects = (n, kind) => plural(n, kind === 'conceptual' ? L.entitiesN : L.tablesN);
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
    snap() { return JSON.stringify({ name: D.name, kind: D.kind, dbms: D.dbms, groups: D.groups, tables: D.tables, relationships: D.relationships, notes: D.notes }); },
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
      Object.assign(D, o);
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
    renderModelControls(); renderChips(); updateEmpty(); scheduleMinimap(); updateLint();
  }
  function afterHistory() {
    cancelInline();
    R.rebuild();
    D.updatedAt = Model.now(); scheduleSave();
    $('#dname').value = D.name; document.title = D.name + ' — ' + L.appTitle;
    renderModelControls(); renderChips(); renderPanel(); updateEmpty(); scheduleMinimap(); updateLint();
  }
  function undo() { if (canEdit() && History.step(-1)) afterHistory(); }
  function redo() { if (canEdit() && History.step(1)) afterHistory(); }

  /* ======================= АВТОСОХРАНЕНИЕ И ВКЛАДКИ ======================= */
  let saveTimer = null, viewTimer = null, quotaShown = false, lastWritten = null, extClose = null;
  function setSaveState(s) {
    const e = $('#save-state');
    e.dataset.state = s;
    e.textContent = { saved: L.saved, saving: L.saving, failed: L.saveFailed, memory: L.memoryOnly }[s];
    if (s == "saved") {
      e.hidden = true;
    } else {
      e.hidden = false;
    }
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
    const { name, kind, dbms, groups, tables, relationships, notes, updatedAt } = nd;
    Object.assign(D, { name, kind, dbms, groups, tables, relationships, notes, updatedAt });
    lastWritten = updatedAt;
    R.rebuild(); History.commit();
    $('#dname').value = D.name;
    renderModelControls(); renderChips(); renderPanel(); renderSidebar(); updateEmpty(); scheduleMinimap(); updateLint();
  }

  /* ======================= ОТКРЫТИЕ ДИАГРАММ ======================= */
  function openDiagram(d, forceFit) {
    if (D && D.id !== d.id) flushSave();
    cancelInline();
    const needFit = forceFit || !d.view;
    D = d; Store.setLast(d.id);
    st.hidden.clear(); st.query = ''; $('#q').value = ''; groupsPanel = false; st.hovered = null;
    renderModelControls();
    R.setDiagram(D);
    renderChips(); setTh();
    if (needFit) fitView();
    History.reset();
    lastWritten = D.updatedAt;
    if (extClose) { extClose(); extClose = null; }
    $('#dname').value = D.name;
    document.title = D.name + ' — ' + L.appTitle;
    if (!Store.has(D.id)) flushSave(); else setSaveState(Store.persistent ? 'saved' : 'memory');
    renderChips(); renderPanel(); renderSidebar(); updateEmpty(); scheduleMinimap(); updateLint();
  }
  function updateEmpty() {
    const e = $('#empty');
    e.hidden = !!(D.tables.length || D.notes.length);
    e.textContent = isConceptual() ? 'Добавьте сущность. Связи между сущностями задаются кнопкой «Связи».' : L.emptyHint;
  }

  function renderModelControls() {
    const concept = isConceptual(), add = $('#b-add-table'), modelLabel = $('#model-level');
    add.textContent = concept ? '+ Сущность' : L.addTable;
    add.title = concept ? 'Добавить сущность (N)' : L.addTableAria;
    $('#b-relationships').hidden = !concept;
    const label = ERD.modelTitle(D);
    if (modelLabel.textContent !== label) modelLabel.textContent = label;
    $('#q').placeholder = concept ? 'Поиск сущности или атрибута…' : L.searchPh;
  }

  /* ======================= КОМАНДЫ ======================= */
  function setSelection(ids) {
    sel.clear(); ids.forEach(id => sel.add(id));
    if (ids.length) groupsPanel = false;
    R.refresh(); renderPanel();
  }
  function selectNote(id) {
    st.note = id;
    svg.querySelectorAll('.note').forEach(g => g.classList.toggle('sel', g.getAttribute('data-nid') === id));
  }
  function deleteNote(id) {
    D.notes = D.notes.filter(n => n.id !== id); st.note = null;
    changed({ panel: false });
    toast(L.noteDeleted, { actions: [{ label: L.undo.split(' (')[0], fn: undo }] });
  }
  function selectAll() { setSelection(D.tables.filter(t => R.isVisible(t)).map(t => t.id)); }
  const snapV = v => (prefs.snap ? Math.round(v / C.GRID) * C.GRID : Math.round(v));

  function addTable(pos, group) {
    if (!canEdit()) return;
    const p = pos || (() => { const c = R.viewCenter(margins()); return { x: c.x, y: c.y - 60 }; })();
    const names = new Set(D.tables.map(t => t.name));
    const prefix = isConceptual() ? 'Сущность ' : 'table_';
    let n = D.tables.length + 1; while (names.has(prefix + n)) n++;
    if (group === undefined) { const s = sel.size === 1 ? byId([...sel][0]) : null; group = s ? s.group : null; }
    const t = Model.newTable(prefix + n, snapV(p.x - (isConceptual() ? 90 : C.W / 2)), snapV(p.y - 15), group, D.kind);
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
    toast(isConceptual() ? 'Удалено сущностей: ' + n : fmt(L.deleted, { n }), { actions: [{ label: L.undo.split(' (')[0], fn: undo }] });
  }
  function duplicateSelected() {
    if (!sel.size) { toast(L.nothingSelected); return; }
    if (!canEdit()) return;
    const b = R.bounds(sel);
    const frag = Model.makeFragment(D, sel, true);
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
    const concept = isConceptual(), physical = D.kind === 'physical';
    const dupe = () => D.tables.some(x => x !== t && x.name === t.name);
    const warn = el('div', { class: 'warn', text: L.dupName, hidden: !dupe() });
    append(pc, [
      el('div', { class: 'ph' }, [textInput('tname', t.name, v => {
        t.name = v; warn.hidden = !dupe();
        changed({ ids: [t.id], merge: 'tname:' + t.id, panel: false });
      }, { class: 'tname-in', 'aria-label': concept ? 'Имя сущности' : L.tableName, onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } }), warn]),
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
      !concept ? el('label', { class: 'check' }, [el('input', {
        type: 'checkbox', checked: t.partitioned, 'data-k': 'tpart',
        onchange: e => { t.partitioned = e.target.checked; changed({ ids: [t.id] }); }
      }), L.partitionedLbl]) : null,
      field(L.description, el('textarea', {
        'data-k': 'tdesc', value: t.description, rows: 2,
        oninput: e => { t.description = e.target.value; changed({ render: false, merge: 'desc:' + t.id, panel: false }); },
        onblur: () => History.breakMerge()
      })),
      el('h3', { text: `${concept ? L.attributes : L.columns} (${t.columns.length})` })
    ]);
    const list = el('div', { class: 'cols' });
    t.columns.forEach((c, i) => list.appendChild(colRow(t, c, i, list)));
    append(pc, [list, btn(concept ? '+ Атрибут' : L.addColumn, () => addColumn(t, t.columns.length), 'addbtn', { 'data-k': 'addcol' })]);

    if (concept) {
      const edges = R.idx.edges.filter(e => e.from === t || e.to === t);
      append(pc, [el('h3', { text: L.relationships }),
        edges.map(e => btn(ERD.relationshipLabel(e), () => editRelationship(e.relation), 'relationship-row')),
        btn('+ Связь', () => editRelationship(null, t.id), 'addbtn')]);
      return;
    }

    append(pc, el('h3', { text: L.uniques }));
    t.uniques.forEach((u, i) => pc.appendChild(el('div', { class: 'uqrow' }, [
      textInput('uq' + i, u, v => { t.uniques[i] = v; changed({ ids: [t.id], merge: 'uq:' + t.id + ':' + i, panel: false }); },
        { class: 'mono', placeholder: L.uniquePh, 'aria-label': L.uniques }),
      btn('✕', () => { t.uniques.splice(i, 1); changed({ ids: [t.id] }); }, 'xbtn', { 'aria-label': L.delUnique, title: L.delUnique, 'data-k': 'uqx' + i })
    ])));
    pc.appendChild(btn(L.addUnique, () => {
      t.uniques.push(''); changed({ ids: [t.id], focus: 'uq' + (t.uniques.length - 1) });
    }, 'addbtn', { 'data-k': 'adduq' }));
    if (physical) {
      append(pc, [
        el('h3', { text: 'Индексы и ограничения СУБД' }),
        field('SQL-выражения, по одному на строку', el('textarea', {
          'data-k': 'definitions', rows: 3, value: (t.definitions || []).join('\n'),
          placeholder: 'CHECK (оценка BETWEEN 2 AND 5)\nCREATE INDEX …',
          oninput: e => {
            t.definitions = e.target.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            changed({ ids: [t.id], merge: 'definitions:' + t.id, panel: false });
          },
          onblur: () => History.breakMerge()
        }))
      ]);
    }

    const out = R.idx.edges.filter(e => e.from === t), inn = R.idx.edges.filter(e => e.to === t);
    const link = (target, txt) => el('a', { class: 'lnk', href: '#', onclick: ev => { ev.preventDefault(); linkTo(target); } }, [target.name + ' ', el('span', { text: txt })]);
    if (out.length) append(pc, [el('h3', { text: `${L.refsOut} (${out.length})` })].concat(out.map(e => link(e.to, '← ' + e.from.columns[e.fi].name))));
    if (inn.length) append(pc, [el('h3', { text: `${L.refsIn} (${inn.length})` })].concat(inn.map(e => link(e.from, '→ ' + e.from.columns[e.fi].name))));
  }

  function addColumn(t, at) {
    const names = new Set(t.columns.map(c => c.name));
    const prefix = isConceptual() ? 'Атрибут ' : 'column_';
    let n = t.columns.length + 1; while (names.has(prefix + n)) n++;
    const type = D.kind === 'logical' ? 'Строка' : '';
    t.columns.splice(at, 0, Model.newColumn(prefix + n, type));
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
    const concept = isConceptual();
    const targets = concept ? [] : [...D.tables].sort((a, b) => a.name.localeCompare(b.name));
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
    const nextColumn = e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = pc.querySelector(`[data-k="c${i + 1}-name"]`);
      if (next) next.focus(); else addColumn(t, i + 1);
    };
    return el('div', { class: 'colrow', 'data-i': i }, [
      el('div', { class: 'cl1' }, [
        handle,
        textInput(k + 'name', c.name, v => { Model.renameColumn(D, t, i, v); changed({ merge: 'cname:' + t.id + ':' + i, panel: false }); },
          { class: 'mono cname', 'aria-label': concept ? 'Имя атрибута' : L.colName, onkeydown: concept ? nextColumn : e => { if (e.key === 'Enter') { e.preventDefault(); pc.querySelector(`[data-k="${k}type"]`).focus(); } } }),
        !concept ? textInput(k + 'type', c.type, v => { c.type = v; changed({ ids: [t.id], merge: 'ctype:' + t.id + ':' + i, panel: false }); },
          {
            class: 'mono ctype', list: D.kind === 'physical' && /postgresql/i.test(D.dbms) ? 'pg-types' : null,
            placeholder: D.kind === 'physical' ? 'Тип SQL' : 'Домен',
            'aria-label': D.kind === 'physical' ? 'Тип SQL' : 'Логический домен', onkeydown: nextColumn
          }) : null,
        btn('✕', () => { Model.removeColumn(D, t, i); changed({ focus: 'addcol' }); }, 'xbtn',
          { 'aria-label': concept ? 'Удалить атрибут' : L.delColumn, 'data-k': k + 'x' })
      ]),
      !concept ? el('div', { class: 'cl2' }, [
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
      ]) : null,
      D.kind === 'physical' ? field('Значение по умолчанию (SQL)', textInput(k + 'default', c.defaultValue || '', v => {
        c.defaultValue = v;
        changed({ ids: [t.id], merge: 'default:' + t.id + ':' + i, panel: false });
      }, { class: 'mono', maxlength: 500 })) : null
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

  function pointerDown(ev) {
    if (ev.button === 2) return;
    commitInline();
    const ae = document.activeElement;
    if (ae && ae !== document.body && !svg.contains(ae) && ae.blur) ae.blur();
    const tgt = ev.target, id = R.nodeIdOf(tgt), edit = mode === 'edit';
    const base = { sx: ev.clientX, sy: ev.clientY, moved: false, pid: ev.pointerId };
    pointerWorld = R.toWorld(ev.clientX, ev.clientY);
    const onNote = !!(tgt.closest && tgt.closest('.note'));
    if (st.note && !onNote) selectNote(null);
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
    } else if (edit && tgt.closest && tgt.closest('.note')) {
      const n = D.notes.find(x => x.id === tgt.closest('.note').getAttribute('data-nid'));
      if (n) { if (sel.size) { sel.clear(); R.refresh(); renderPanel(); } selectNote(n.id); }
      drag = n ? Object.assign(base, { type: 'note', n, ox: n.x, oy: n.y }) : Object.assign(base, { type: 'none' });
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
  }
  svg.addEventListener('pointerdown', pointerDown);

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
    else if (d.type === 'note') {
      let nx = d.ox + dx / k, ny = d.oy + dy / k;
      if (prefs.snap) { nx = snapV(nx); ny = snapV(ny); }
      d.n.x = nx; d.n.y = ny; R.moveNote(d.n);
    }
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
    } else if (d.type === 'note') {
      if (d.moved && cancelled) { d.n.x = d.ox; d.n.y = d.oy; R.moveNote(d.n); }
      else if (d.moved) { d.n.x = Math.round(d.n.x); d.n.y = Math.round(d.n.y); R.moveNote(d.n); changed({ render: false, panel: false }); }
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
     по карточке или заголовку группы: касание — выбрать/открыть, провести — панорама,
     удержать и вести — перетаскивание (и связь от порта);
     два пальца в режиме правки — рамка выделения между пальцами, в просмотре — щипок.
     Масштаб одним пальцем: двойное касание, или двойное касание и тянуть вверх/вниз. */
  let lastPointerType = 'mouse', touchRect = null;
  const isHoldTarget = t => !!R.nodeIdOf(t) || (mode === 'edit' && !!t.classList && t.classList.contains('gtitle'));
  /* регистрируется раньше attachNavigation, чтобы видеть и касания, которые она перехватывает */
  addEventListener('pointerdown', e => { lastPointerType = e.pointerType; }, true);
  R.attachNavigation({
    onStart: commitInline,
    onGesture: () => { if (drag) endDrag({ clientX: 0, clientY: 0 }, true); st.hovered = null; },
    shouldPan: ev => !isHoldTarget(ev.target),
    canHold: ev => isHoldTarget(ev.target),
    onPress: pointerDown,
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
    /* из-за захвата указателя target бывает самим svg — ищем заметку по координатам */
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const noteEl = (hit && hit.closest && hit.closest('.note')) || (tgt.closest && tgt.closest('.note'));
    if (noteEl) { editNote(noteEl.getAttribute('data-nid')); return; }
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
    const noteEl = tgt.closest && tgt.closest('.note');
    const items = [];
    const add = (label, fn, kbd, danger) => items.push({ label, fn, kbd, danger });
    const sep = () => items.push('-');
    if (noteEl) {
      const nid = noteEl.getAttribute('data-nid');
      selectNote(nid);
      if (edit) {
        add(L.cmEditNote, () => editNote(nid));
        sep();
        add(L.cmDeleteNote, () => deleteNote(nid), 'Delete', true);
      }
    } else if (id) {
      if (!sel.has(id)) setSelection([id]);
      const t = byId(id), row = tgt.closest('.row'), n = sel.size;
      if (edit && row && n === 1) {
        const i = +row.getAttribute('data-i');
        add(isConceptual() ? 'Переименовать атрибут' : L.cmRenameColumn, () => renameColumnInline(t, i));
        add(isConceptual() ? 'Вставить атрибут ниже' : L.cmInsertColumn, () => addColumn(t, i + 1));
        add(isConceptual() ? 'Удалить атрибут' : L.cmDeleteColumn, () => { Model.removeColumn(D, t, i); changed(); }, null, true);
        sep();
      }
      if (edit && n === 1) {
        add(isConceptual() ? 'Переименовать сущность' : L.cmRenameTable, () => renameTableInline(t));
        add(isConceptual() ? 'Добавить атрибут' : L.cmAddColumn, () => addColumn(t, t.columns.length));
        if (isConceptual()) add('Добавить связь', () => editRelationship(null, t.id));
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
        add(n > 1 ? (isConceptual() ? 'Удалить сущности (' + n + ')' : fmt(L.cmDeleteN, { n })) : L.cmDelete, deleteSelected, 'Delete', true);
      }
    } else if (tgt.classList.contains('gbox') || tgt.classList.contains('gtitle')) {
      const gid = tgt.getAttribute('data-gid');
      if (edit) add(isConceptual() ? 'Добавить сущность в группу' : L.cmAddTableToGroup, () => addTable(p, gid), 'N');
      if (edit) add(L.cmAddNote, () => noteEditor(null, p, { x: ev.clientX, y: ev.clientY }));
      if (edit) add(isConceptual() ? 'Выделить сущности группы' : L.cmSelectGroup, () => setSelection(D.tables.filter(t => t.group === gid && R.isVisible(t)).map(t => t.id)));
      if (edit) {
        add(L.cmRenameGroup, () => renameGroupInline(gid));
        add(L.cmGroupSettings, () => { sel.clear(); groupsPanel = true; R.refresh(); renderPanel('g-' + gid + '-title'); });
        sep();
        add(L.cmDeleteGroup, () => deleteGroup(gid), null, true);
      }
    } else {
      if (edit) {
        add(isConceptual() ? 'Добавить сущность' : L.cmAddTable, () => addTable(p, null), 'N');
        add(L.cmAddNote, () => noteEditor(null, p, { x: ev.clientX, y: ev.clientY }));
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
  /* заметка: многострочный редактор; существующую правим на месте, новую создаём при подтверждении */
  function editNote(nid) {
    const n = D.notes.find(x => x.id === nid), g = svg.querySelector(`.note[data-nid="${nid}"]`);
    if (!n || !g || !canEdit()) return;
    const r = g.getBoundingClientRect();
    noteEditor(n, null, { x: r.left, y: r.top });
  }
  function noteEditor(note, world, scr) {
    if (!canEdit()) return;
    commitInline();
    const k = D.view.k;
    const inp = el('textarea', {
      class: 'inline-edit note-edit', value: note ? note.text : '', placeholder: L.notePh, spellcheck: 'false',
      style: { left: scr.x + 'px', top: scr.y + 'px', width: Math.max(220, 200 * k) + 'px' }
    });
    document.body.appendChild(inp); inp.focus(); inp.select();
    inline = {
      inp, value: note ? note.text : '',
      onCommit: v => {
        if (note) note.text = v; else D.notes.push(Model.newNote(v, world.x, world.y));
        changed({ panel: false });
      }
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitInline(); }
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
  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* пробуем встроенную команду */ }
    }
    const prev = document.activeElement;
    const ta = el('textarea', { value: text, readonly: true, style: { position: 'fixed', left: '-9999px', top: '0', opacity: '0' } });
    (document.querySelector('dialog[open]') || document.body).appendChild(ta); ta.select();
    try { return document.execCommand('copy'); } catch (e) { return false; }
    finally { ta.remove(); if (prev && prev.focus) prev.focus({ preventScroll: true }); }
  }
  function copySelection(cut) {
    if (!sel.size) { toast(L.nothingSelected); return; }
    if (cut && !canEdit()) return;
    const ids = [...sel];
    const text = JSON.stringify(Model.makeFragment(D, ids));
    Store.setClip(text);
    writeClipboard(text);
    if (cut) { Model.removeTables(D, ids); sel.clear(); changed(); }
    toast(fmt(cut ? L.cut : L.copied, { n: countObjects(ids.length, D.kind) }));
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
    if ((frag.kind === 'conceptual') !== isConceptual()) {
      toast('Вставьте фрагмент в модель того же уровня или импортируйте его как отдельную диаграмму.', { type: 'warn' });
      return;
    }
    const pos = where && typeof where === 'object' ? where
      : where === 'cursor' && pointerInside && pointerWorld ? pointerWorld : R.viewCenter(margins());
    const res = Model.insertFragment(D, frag, pos, { snap: prefs.snap ? C.GRID : 0 });
    sel.clear(); res.ids.forEach(id => sel.add(id)); groupsPanel = false;
    changed();
    toast(fmt(L.pasted, { n: countObjects(res.ids.length, D.kind) }));
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
        body: [el('p', { text: ERD.modelTitle(d) }),
          el('p', { text: fmt(L.importOne, { name: d.name, tables: countObjects(d.tables.length, d.kind), edges: plural(ne, L.edgesN) }) }),
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
        const { name, kind, dbms, groups, tables, relationships, notes } = d;
        Object.assign(D, { name, kind, dbms, groups, tables, relationships, notes });
        sel.clear(); selectNote(null); groupsPanel = false; st.hidden.clear();
        $('#dname').value = D.name;
        document.title = D.name + ' · ' + L.appTitle;
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
      `<meta name="generator" content="Schemify">\n<title>${escHtml(d.name)} · ${escHtml(ERD.modelTitle(d))}</title>\n` +
      `<style>${ERD.CSS}</style>\n</head>\n<body>\n` +
      `<script type="application/json" id="erd-data">${data}</script>\n` +
      `<script>\n"use strict";\nvar ERD = (${code})();\nERD.runViewer(JSON.parse(document.getElementById("erd-data").textContent));\n</script>\n` +
      '</body>\n</html>\n';
  }
  const exportHtml = () => exportHtmlOf(D.id);
  /* SVG: клон слоёв с вычисленными стилями (файл не зависит от CSS-переменных) */
  const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'opacity',
    'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing', 'paint-order', 'stroke-linejoin', 'white-space'];
  function inlineClone(src, forReport) {
    if (src.nodeType !== 1) return src.cloneNode(false);
    if (src.classList.contains('hit') || src.classList.contains('port') || src.classList.contains('rowhl') || src.tagName === 'title') return null;
    const cs = getComputedStyle(src);
    if (cs.display === 'none') return null;
    const dst = src.cloneNode(false);
    dst.removeAttribute('class'); dst.removeAttribute('style'); dst.removeAttribute('id');
    if (src.tagName === 'g') { if (cs.opacity !== '1') dst.setAttribute('opacity', cs.opacity); }
    else {
      const overrides = forReport ? Report.styleFor(src) : {};
      dst.setAttribute('style', STYLE_PROPS.map(p => p + ':' + (overrides[p] ?? cs.getPropertyValue(p))).join(';'));
    }
    src.childNodes.forEach(ch => { const c = inlineClone(ch, forReport); if (c) dst.appendChild(c); });
    return dst;
  }
  function buildSvg(forReport = false, visibleOnly = true) {
    const saved = { sel: [...sel], hov: st.hovered, q: st.query, hidden: [...st.hidden] };
    svg.classList.add('exporting');
    try {
      sel.clear(); st.hovered = null; st.query = '';
      if (!visibleOnly) st.hidden.clear();
      R.drawGroups();
      const stats = R.refresh();
      const b = R.bounds();
      if (!b) throw new Error('Нет видимых объектов. Покажите группы или экспортируйте всю модель.');
      const layers = [R.gl, R.el, R.nl, R.tl];
      for (const layer of layers) {
        const box = layer.getBBox();
        if (!box.width && !box.height) continue;
        b.x0 = Math.min(b.x0, box.x - 10); b.y0 = Math.min(b.y0, box.y - 10);
        b.x1 = Math.max(b.x1, box.x + box.width + 10); b.y1 = Math.max(b.y1, box.y + box.height + 10);
      }
      const legend = forReport && stats.tables ? Report.legend(D.kind, stats.edges > 0) : [];
      const x0 = b.x0, y0 = b.y0, legendY = b.y1 + 10;
      const legendWidth = Math.max(0, ...legend.map(s => ERD.measure(s, '12px sans-serif') + 32));
      const w = Math.ceil(Math.max(b.x1 - x0, legendWidth)), h = Math.ceil(b.y1 - y0 + (legend.length ? 12 + legend.length * 17 : 0));
      const cs = getComputedStyle(document.documentElement), v = p => cs.getPropertyValue(p).trim();
      const out = ERD.mk('svg', { width: w, height: h, viewBox: `${x0} ${y0} ${w} ${h}` });
      ERD.mk('rect', { x: x0, y: y0, width: w, height: h, fill: forReport ? '#fff' : v('--bg') }, out);
      if (!forReport) {
        const defs = ERD.mk('defs', {}, out);
        const pat = ERD.mk('pattern', { id: 'dots', width: C.GRID, height: C.GRID, patternUnits: 'userSpaceOnUse' }, defs);
        ERD.mk('circle', { cx: 1.2, cy: 1.2, r: 1.2, fill: v('--grid') }, pat);
        ERD.mk('rect', { x: x0, y: y0, width: w, height: h, fill: 'url(#dots)' }, out);
      }
      layers.forEach(layer => out.appendChild(inlineClone(layer, forReport)));
      legend.forEach((s, i) => {
        ERD.mk('text', { x: x0 + 12, y: legendY + i * 17, fill: '#000', 'font-family': 'sans-serif', 'font-size': 12 }, out).textContent = s;
      });
      return { out, w, h };
    } finally {
      saved.hidden.forEach(id => st.hidden.add(id));
      saved.sel.forEach(id => sel.add(id)); st.hovered = saved.hov; st.query = saved.q;
      R.drawGroups(); R.refresh(); svg.classList.remove('exporting');
    }
  }
  const svgText = out => '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(out);
  function exportSvg() {
    try { download(safeName(D.name) + '.svg', svgText(buildSvg().out), 'image/svg+xml'); }
    catch (e) { toast(fmt(L.exportFailed, { msg: e.message }), { type: 'error' }); }
  }
  function exportPng() {
    let s;
    try { s = buildSvg(); } catch (e) { toast(fmt(L.exportFailed, { msg: e.message }), { type: 'error' }); return; }
    const scale = Math.max(0.1, Math.min(2, 16000 / s.w, 16000 / s.h, Math.sqrt(2.4e8 / (s.w * s.h))));
    const img = new Image(), name = safeName(D.name) + '.png';
    img.onload = () => {
      try {
        const cv = el('canvas', { width: Math.round(s.w * scale), height: Math.round(s.h * scale) });
        const ctx = cv.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, s.w, s.h);
        cv.toBlob(b => { if (b) download(name, b); else toast(fmt(L.exportFailed, { msg: 'canvas' }), { type: 'error' }); }, 'image/png');
      } catch (e) { toast(fmt(L.exportFailed, { msg: e.message }), { type: 'error' }); }
    };
    img.onerror = () => toast(fmt(L.exportFailed, { msg: 'SVG → PNG' }), { type: 'error' });
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText(s.out));
  }
  async function exportReport() {
    if (!D.tables.length && !D.notes.length) { toast('Добавьте данные в модель, чтобы экспортировать рисунок.'); return; }
    const number = el('input', { type: 'text', value: '1', maxlength: 20, placeholder: '1, 2.1 или А.1', required: true });
    const type = ERD.MODEL_KINDS[D.kind].title;
    const title = el('textarea', { class: 'caption-text', rows: 2, maxlength: 250, required: true,
      value: type + ' базы данных «' + D.name + '»' + (D.dbms ? ' (' + D.dbms + ')' : '') });
    const width = el('input', { type: 'number', min: 40, max: 260, step: 1, value: 160, required: true });
    const visibleOnly = el('input', { type: 'checkbox' });
    const caption = el('textarea', { class: 'caption-text', rows: 2, readonly: true, onclick: e => e.target.select() });
    const error = el('p', { class: 'err', role: 'alert' });
    const status = el('p', { class: 'hint', role: 'status' });
    const updateCaption = () => {
      caption.value = 'Рисунок ' + number.value.trim() + ' – ' + title.value.trim().replace(/\s+/g, ' ').replace(/\.+$/, '');
      status.textContent = '';
    };
    [number, title].forEach(input => input.addEventListener('input', updateCaption));
    updateCaption();
    const toFile = async (button, format) => {
      if (!width.reportValidity()) return;
      button.disabled = true;
      error.textContent = '';
      status.textContent = '';
      try {
        const figure = buildSvg(true, visibleOnly.checked), mm = Number(width.value);
        const base = safeName(D.name) + ' - рисунок';
        if (format === 'svg') download(base + '.svg', Report.vector(figure, mm), 'image/svg+xml');
        else download(base + '.png', await Report.raster(figure, mm), 'image/png');
        status.textContent = 'Рисунок сохранён.';
      } catch (e) { error.textContent = fmt(L.exportFailed, { msg: e.message }); }
      finally { button.disabled = false; }
    };
    await dialog({
      title: 'Рисунок для отчёта',
      noValidate: true,
      body: [
        el('div', { class: 'dlg-pair' }, [field('Номер рисунка', number), field('Ширина при вставке, мм', width)]),
        field('Наименование рисунка', title),
        el('label', { class: 'check' }, [visibleOnly, 'Только видимые группы']),
        el('div', { class: 'pactions' }, [
          btn('Скачать SVG', e => toFile(e.currentTarget, 'svg'), 'primary'),
          btn(`Скачать PNG · ${Report.DPI} dpi`, e => toFile(e.currentTarget, 'png'))
        ]),
        field('Подпись к рисунку', caption),
        btn('Копировать подпись', async () => {
          if (!number.reportValidity() || !title.reportValidity()) return;
          const copied = await writeClipboard(caption.value);
          status.textContent = copied ? 'Подпись скопирована.' : 'Подпись выделена. Нажмите Ctrl+C или Cmd+C.';
          if (!copied) { caption.focus(); caption.select(); }
        }),
        el('p', { class: 'hint', text: 'Вставьте рисунок в Word или LibreOffice Writer. Подпись разместите по центру под рисунком. Размер и нумерацию можно подстроить под методичку кафедры.' }),
        error, status
      ],
      buttons: [{ value: '', label: L.close }]
    });
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
      const info = cur ? { name: D.name, kind: D.kind, tables: D.tables.length, updatedAt: D.updatedAt } : x;
      const open = ev => { ev.preventDefault(); openDiagramMenu(x.id, info.name, ev); };
      ul.appendChild(el('li', { class: 'ditem' + (cur ? ' cur' : '') }, [
        el('button', {
          type: 'button', class: 'dopen', 'aria-current': cur ? 'true' : null, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
          'data-k': 'o' + x.id, onclick: open, oncontextmenu: open,
          ondblclick: () => { closePopup(); switchTo(x.id); }
        }, [
          el('span', { class: 'dn', text: info.name }),
          el('span', { class: 'dm', text: ERD.MODEL_KINDS[ERD.modelKind(info.kind)].title }),
          el('span', { class: 'dm', text: countObjects(info.tables || 0, info.kind) + ' · ' + timeLabel(info.updatedAt) }),
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
  function kindSelect(value) {
    return el('select', {}, Object.entries(ERD.MODEL_KINDS).map(([kind, { title }]) =>
      el('option', { value: kind, text: title, selected: value === kind })));
  }
  async function convertDiagram() {
    if (D.kind !== 'logical' || !D.tables.length) {
      toast('Откройте логическую модель с таблицами, чтобы построить из неё новую диаграмму.');
      return;
    }
    const source = D, kind = el('select', {}, ['conceptual', 'physical'].map(value =>
      el('option', { value, text: ERD.MODEL_KINDS[value].title })));
    const dialect = el('select', {}, Object.entries(Conversion.DIALECTS).map(([value, spec]) =>
      el('option', { value, text: spec.name })));
    const fold = el('input', { type: 'checkbox', checked: true });
    const dialectField = field('Целевая СУБД', dialect);
    const foldField = el('label', { class: 'check conversion-fold' }, [fold, 'Сворачивать связующие таблицы без собственных атрибутов']);
    const switchOptions = () => {
      dialectField.hidden = kind.value !== 'physical';
      foldField.hidden = kind.value !== 'conceptual';
    };
    kind.addEventListener('change', switchOptions);
    switchOptions();
    while (true) {
      const action = await dialog({
        title: 'Построить из текущей модели',
        body: [field('Целевая модель', kind), dialectField, foldField,
          el('p', { class: 'hint', text: 'Исходная модель «' + source.name + '» сохранится отдельно.' })],
        buttons: [{ value: 'preview', label: 'Предпросмотр', primary: true }, { value: '', label: L.cancel }],
        onOpen: () => kind.focus()
      });
      if (action !== 'preview' || D !== source) return;
      const converted = Conversion.build(source, kind.value, { dialect: dialect.value, fold: fold.checked });
      const result = await previewConversion(converted);
      if (D !== source) return;
      if (result === 'back') continue;
      if (result === 'save') {
        openDiagram(converted.diagram, true);
        if (mode !== 'edit') setMode('edit');
      }
      return;
    }
  }

  async function previewConversion({ diagram, types, pending, positions, warnings }) {
    const concept = diagram.kind === 'conceptual';
    const title = el('input', { type: 'text', value: diagram.name, maxlength: 200 });
    const drawing = ERD.mk('svg', { class: 'conversion-preview', role: 'img', 'aria-label': 'Предпросмотр новой диаграммы' });
    const preview = new ERD.Renderer(drawing);
    preview.vp.querySelectorAll('[id]').forEach(layer => layer.removeAttribute('id'));
    preview.vp.removeAttribute('id');
    let frame;
    const redraw = () => {
      if (types.length) Conversion.applyTypes(types);
      Conversion.layout(diagram, positions);
      preview.rebuild();
      const b = preview.vp.getBBox(), pad = 20;
      drawing.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`);
    };
    const queueRedraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(redraw);
    };
    const tableNames = new Map(diagram.tables.map(t => [t.id, t.name]));
    const relationshipFields = diagram.relationships.map((relation, i) => {
      const first = tableNames.get(relation.from), last = tableNames.get(relation.to);
      const card = (name, key) => field(name, cardinalitySelect(relation[key], value => { relation[key] = value; queueRedraw(); }));
      return el('fieldset', { class: 'conversion-row' }, [
        el('legend', { text: `${first} → ${last}` }),
        field('Название связи', el('input', {
          type: 'text', value: relation.name, maxlength: 160, 'aria-label': 'Название связи ' + (i + 1),
          oninput: e => { relation.name = e.target.value.trim() || ERD.STR.defaultRelationship; queueRedraw(); }
        })),
        el('div', { class: 'dlg-pair' }, [card('Кратность у «' + first + '» (первая)', 'fromCardinality'), card('Кратность у «' + last + '» (вторая)', 'toCardinality')])
      ]);
    });
    const typeFields = pending.map(group => {
      const names = group.members.map(r => r.label);
      const domains = [...new Set(group.members.map(r => r.column.type.trim() || 'без домена'))];
      const label = names.join(', ');
      const input = el('input', {
        type: 'text', maxlength: 200, class: 'mono', autocomplete: 'off', spellcheck: 'false',
        list: diagram.dbms === 'PostgreSQL' ? 'pg-types' : null,
        placeholder: group.suggestion || (group.indexed ? 'Например, varchar(20)' : 'Например, decimal(12,2)'),
        oninput: e => { Conversion.setType(group, e.target.value); queueRedraw(); }
      });
      return el('div', { class: 'conversion-row' }, [field(label, input), el('p', { class: 'hint', text: 'Домены · ' + domains.join(', ') })]);
    });
    const action = await dialog({
      title: 'Предпросмотр · ' + ERD.modelTitle(diagram),
      body: [
        field('Название новой модели', title), drawing,
        el('p', { class: 'hint', text: countObjects(diagram.tables.length, diagram.kind) + ' · ' +
          plural(ERD.buildIndex(diagram).edges.length, L.edgesN) }),
        concept && relationshipFields.length ? el('details', { class: 'conversion-section', open: relationshipFields.length <= 5 }, [
          el('summary', { text: 'Названия и кратности связей' }),
          el('p', { class: 'hint', text: L.conceptLegend }),
          el('div', { class: 'conversion-fields' }, relationshipFields)
        ]) : null,
        typeFields.length ? el('section', { class: 'conversion-section', 'aria-label': 'Уточнение типов' }, [
          el('p', { text: 'Укажите SQL-типы для полей ниже. Связанные столбцы получают общий тип.' }),
          el('div', { class: 'conversion-fields' }, typeFields)
        ]) : null,
        warnings.length ? el('details', { class: 'conversion-section', open: true }, [
          el('summary', { text: 'Что проверить · ' + warnings.length }),
          el('ul', { class: 'warns' }, warnings.map(w => el('li', { text: w })))
        ]) : null
      ],
      buttons: [{ value: 'save', label: 'Создать отдельную модель', primary: true },
        { value: 'back', label: 'Назад' }, { value: '', label: L.cancel }],
      onOpen: dlg => {
        dlg.classList.add('conversion-dialog');
        preview.setDiagram({ ...diagram, view: null });
        preview.vp.removeAttribute('transform');
        redraw();
      },
      validate: v => {
        if (v !== 'save') return null;
        if (!title.value.trim()) return 'Введите название модели.';
        if (pending.some(g => !g.type)) return diagram.dbms === 'MySQL 8.4'
          ? 'Заполните SQL-типы. Для строковых ключей укажите, например, varchar(20).'
          : 'Заполните SQL-типы перечисленных полей.';
        return null;
      }
    });
    cancelAnimationFrame(frame);
    if (action === 'save') {
      diagram.name = title.value.trim();
      Conversion.applyTypes(types);
      Conversion.layout(diagram, positions);
    }
    return action;
  }

  function cardinalitySelect(current, onChange) {
    return el('select', { onchange: onChange ? e => onChange(e.target.value) : null },
      ERD.CARDINALITIES.map(value => el('option', { value, text: value, selected: value === current })));
  }

  async function newDiagram(withExample = false) {
    const kind = kindSelect(D.kind), name = el('input', { type: 'text', maxlength: 200 });
    const dbms = el('input', { type: 'text', value: 'PostgreSQL', maxlength: 80 });
    const useSample = el('input', { type: 'checkbox', checked: withExample });
    const dbmsField = field('СУБД', dbms);
    const hint = el('p', { class: 'hint' });
    const hintForKind = () => {
      hint.textContent = ERD.MODEL_KINDS[kind.value].hint;
      dbmsField.hidden = kind.value !== 'physical' || useSample.checked;
      name.placeholder = useSample.checked ? 'Учёт успеваемости' : L.newDiagramName;
    };
    kind.addEventListener('change', hintForKind);
    useSample.addEventListener('change', hintForKind);
    hintForKind();
    const result = await dialog({
      title: 'Новая модель БД',
      body: [field('Уровень модели', kind), hint, field('Название', name),
        el('label', { class: 'check' }, [useSample, 'Заполнить примером «Учёт успеваемости»']), dbmsField],
      buttons: [{ value: 'ok', label: 'Создать', primary: true },
        ...(!withExample && D.kind === 'logical' && D.tables.length ? [{ value: 'convert', label: 'Построить из текущей…' }] : []),
        { value: '', label: L.cancel }],
      onOpen: () => kind.focus()
    });
    if (result === 'convert') { await convertDiagram(); return; }
    if (result !== 'ok') return;
    flushSave();
    const n = Store.list().length + 1;
    const title = name.value.trim();
    openDiagram(useSample.checked ? Samples.university(kind.value, title) :
      Model.newDiagram(title || L.newDiagramName + ' ' + n, kind.value, dbms.value.trim()));
    if (mode !== 'edit') setMode('edit');
  }
  async function editModelProperties() {
    const d = D, readOnly = mode !== 'edit';
    const name = el('input', { type: 'text', value: d.name, maxlength: 200, readonly: readOnly });
    const dbms = el('input', { type: 'text', value: d.dbms, maxlength: 80, readonly: readOnly });
    const result = await dialog({
      title: ERD.MODEL_KINDS[d.kind].title,
      body: [field('Название', name), d.kind === 'physical' ? field('СУБД', dbms) : null,
        el('p', { class: 'hint', text: ERD.MODEL_KINDS[d.kind].hint })],
      buttons: readOnly ? [{ value: '', label: L.close }] :
        [{ value: 'ok', label: 'Сохранить', primary: true }, { value: '', label: L.cancel }],
      validate: v => v === 'ok' && (!name.value.trim() || (d.kind === 'physical' && !dbms.value.trim())) ? 'Заполните поля.' : null
    });
    if (result !== 'ok' || D !== d) return;
    D.name = name.value.trim();
    D.dbms = dbms.value.trim();
    $('#dname').value = D.name;
    document.title = D.name + ' · ' + L.appTitle;
    changed({ render: false });
    renderSidebar();
  }
  async function showRelationships() {
    if (!D.tables.length) { toast('Сначала добавьте сущность.'); return; }
    const edges = R.idx.edges;
    const result = await dialog({
      title: 'Связи сущностей',
      body: [el('p', { class: 'hint', text: L.conceptLegend }),
        edges.length ? el('div', { class: 'relationship-list' }, edges.map((e, i) =>
          el('button', { type: 'submit', class: 'relationship-row', value: String(i), text: ERD.relationshipLabel(e) }))) : null],
      buttons: [{ value: 'add', label: '+ Связь', primary: true, focus: true }, { value: '', label: L.close }]
    });
    if (result == null) return;
    const [from, to] = sel;
    await editRelationship(result === 'add' ? null : edges[Number(result)].relation, from, to);
  }
  async function editRelationship(relation, fromId, toId) {
    if (!D.tables.length) { toast('Сначала добавьте сущность.'); return; }
    const d = D;
    const entities = [...d.tables].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const first = relation?.from || fromId || entities[0].id;
    const second = relation?.to || toId || entities.find(t => t.id !== first)?.id || first;
    const entitySelect = current => el('select', {}, entities.map(t =>
      el('option', { value: t.id, text: t.name, selected: t.id === current })));
    const from = entitySelect(first), to = entitySelect(second);
    const fromCardinality = cardinalitySelect(relation?.fromCardinality || '1');
    const toCardinality = cardinalitySelect(relation?.toCardinality || '0..*');
    const name = el('input', { type: 'text', value: relation?.name || '', maxlength: 160, placeholder: 'Например, «получает»' });
    const result = await dialog({
      title: relation ? 'Изменение связи' : 'Новая связь',
      body: [field('Название связи', name), el('p', { class: 'hint', text: L.conceptLegend }),
        el('div', { class: 'dlg-pair' }, [field('Первая сущность', from), field('Кратность у первой сущности', fromCardinality)]),
        el('div', { class: 'dlg-pair' }, [field('Вторая сущность', to), field('Кратность у второй сущности', toCardinality)]),
        el('p', { class: 'hint', text: L.conceptRanges })],
      buttons: [{ value: 'ok', label: 'Сохранить', primary: true },
        ...(relation ? [{ value: 'delete', label: 'Удалить связь', danger: true }] : []), { value: '', label: L.cancel }],
      onOpen: () => name.focus(),
      validate: v => v === 'ok' && !name.value.trim() ? 'Введите название связи.' : null
    });
    if (!result || D !== d) return;
    if (result === 'delete') d.relationships = d.relationships.filter(r => r !== relation);
    else {
      const values = { from: from.value, to: to.value, name: name.value.trim(), fromCardinality: fromCardinality.value, toCardinality: toCardinality.value };
      if (relation) Object.assign(relation, values); else d.relationships.push(values);
    }
    changed();
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


  /* ======================= ПРОВЕРКА СХЕМЫ ======================= */
  function updateLint() {
    const b = $('#b-lint'); if (!b || !D) return;
    const n = Model.lint(D).filter(i => i.kind !== 'noPk').length;
    b.hidden = !n; b.textContent = fmt(L.lintBtn, { n });
  }
  function applyFix(fixes) {
    if (!canEdit()) return;
    fixes.forEach(f => f());
    changed({ panel: false });
    toast(fmt(L.lintFixed, { n: fixes.length }));
  }
  async function openLint() {
    const issues = Model.lint(D);
    if (!issues.length) { toast(L.lintNone); return; }
    const fixable = issues.filter(i => i.fix);
    const body = el('ul', { class: 'lint-list' }, issues.map(i => el('li', {}, [
      el('span', { text: i.msg }),
      i.fix ? el('button', { type: 'button', text: L.lintFix, onclick: ev => { ev.preventDefault(); applyFix([i.fix]); ev.target.closest('li').remove(); } }) : null
    ])));
    const v = await dialog({
      title: L.lintTitle, body,
      buttons: (fixable.length ? [{ value: 'all', label: L.lintFixAll, primary: true }] : []).concat([{ value: '', label: L.cancel }])
    });
    if (v === 'all') applyFix(Model.lint(D).filter(i => i.fix).map(i => i.fix));
  }
  $('#b-lint').addEventListener('click', openLint);

  /* ======================= МЕНЮ «ФАЙЛ» ======================= */
  const menu = $('#file-menu'), fileBtn = $('#b-file');
  const ACTIONS = {
    import: pickFile, exportJson, exportHtml, exportSvg, exportPng, exportAll, exportReport, prompts: () => openPrompts(),
    convert: convertDiagram,
    copy: () => copySelection(false), paste: () => pasteFromButton(), pasteJson: openPasteJson,
    lint: openLint, newDiagram: () => newDiagram(), sample: () => newDiagram(true), networkSample: loadSample,
    minimap: () => setMinimap(!prefs.minimap)
  };
  function renderMenu() {
    const items = [['import', L.mImport], ['convert', 'Построить из текущей модели…'], ['exportReport', 'Рисунок для отчёта…'], ['exportJson', L.mExportJson, 'Ctrl+S'], ['exportHtml', L.mExportHtml], ['exportSvg', L.mExportSvg],
      ['exportPng', L.mExportPng], ['exportAll', L.mExportAll], '-', ['copy', L.mCopy, 'Ctrl+C'], ['paste', L.mPaste, 'Ctrl+V'],
      ['pasteJson', L.mPasteJson], '-', ['lint', L.mLint], ['newDiagram', L.mNewDiagram], ['sample', 'Учебный пример…'],
      ['networkSample', L.mSample], ['prompts', 'Промпты для моделей…'], '-', ['minimap', L.minimap]];
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
    o.notes.forEach(n => { delete n.x; delete n.y; delete n.id; });
    return JSON.stringify(o, null, 2);
  }
  async function openPrompts(initialKind = D.kind) {
    const kind = kindSelect(initialKind);
    const action = el('select', {}, [
      el('option', { value: 'generate', text: 'Построить модель или перейти к другому уровню' }),
      el('option', { value: 'describe', text: 'Описать рисунок в отчёте' }),
      el('option', { value: 'code', text: 'Сгенерировать SQL или модели SQLAlchemy' })
    ]);
    const withModel = el('input', { type: 'checkbox' });
    const ta = el('textarea', { readonly: true, spellcheck: 'false', rows: 17, 'aria-label': 'Текст промпта' });
    const status = el('p', { class: 'hint', role: 'status' });
    const hint = el('p', { class: 'hint' });
    const refresh = () => {
      kind.disabled = action.value !== 'generate';
      const source = withModel.checked ? schemaForAi(D) : '';
      ta.value = Prompts.build(action.value, kind.disabled ? D.kind : kind.value, source);
      ta.scrollTop = 0;
      status.textContent = '';
      hint.textContent = action.value === 'generate' ? 'Дополните промпт заданием и импортируйте JSON из ответа.' :
        'Приложите модель и укажите требования кафедры или целевую СУБД.';
    };
    [kind, action, withModel].forEach(control => control.addEventListener('change', refresh));
    refresh();
    const result = await dialog({
      title: 'Промпты для моделей БД',
      body: [
        field('Задача', action), field('Уровень модели', kind),
        el('label', { class: 'check' }, [withModel, 'Включить JSON открытой модели']),
        hint, ta, status,
        btn(L.aiCopy, async () => {
          if (await writeClipboard(ta.value)) status.textContent = L.aiCopied;
          else { ta.focus(); ta.select(); status.textContent = 'Текст выделен. Нажмите Ctrl+C или Cmd+C.'; }
        }, 'primary')
      ],
      buttons: [{ value: 'import', label: L.aiImport }, { value: '', label: L.close }]
    });
    if (result === 'import') await importAiAnswer();
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
    append($('#help-ai'), [
      el('p', { class: 'hint', text: 'Шаблоны для построения моделей и пояснительного текста к рисункам.' }),
      el('div', { class: 'aibtns' }, Object.entries(ERD.MODEL_KINDS).map(([kind, { title }]) =>
        btn(title, () => openPrompts(kind))).concat(btn(L.aiImport, importAiAnswer)))
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
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.note && !sel.size) { e.preventDefault(); if (canEdit()) deleteNote(st.note); return; }
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
  $('#b-relationships').addEventListener('click', showRelationships);
  $('#model-level').addEventListener('click', editModelProperties);
  $('#b-groups').addEventListener('click', () => { groupsPanel = !(groupsPanel && !sel.size); sel.clear(); R.refresh(); renderPanel(); });
  $('#b-undo').addEventListener('click', undo);
  $('#b-redo').addEventListener('click', redo);
  // $('#fit').addEventListener('click', fitView);
  $('#b-layout').addEventListener('click', doAutoLayout);
  $('#b-snap').addEventListener('click', () => { prefs.snap = !prefs.snap; savePrefs(); $('#b-snap').setAttribute('aria-pressed', String(prefs.snap)); });
  $('#theme').addEventListener('click', () => { ERD.setTheme(ERD.currentTheme() === 'dark' ? 'light' : 'dark', true); scheduleMinimap(); });
  $('#sb-new').addEventListener('click', () => newDiagram());
  $('#sb-import').addEventListener('click', pickFile);
  $('#sb-export-all').addEventListener('click', exportAll);
  $('#sb-sample').addEventListener('click', () => newDiagram(true));
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
    if (!d) d = Samples.university('logical');
    openDiagram(d);
    if (!Store.persistent) toast(L.storageUnavailable, { type: 'warn', timeout: 9000 });
    setInterval(renderSidebar, 60000);
  }
  init();

  /* отладочный доступ из консоли (не используется самим приложением) */
  window.ERDApp = { get diagram() { return D; }, renderer: R, buildStandaloneHtml, importText, History };
})();
