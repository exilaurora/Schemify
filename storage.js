/* ============================================================================
   storage.js — слой хранилища (localStorage).
   Ключи:  erd:index        — индекс диаграмм [{id,name,updatedAt,tables}]
           erd:d:<id>       — диаграмма целиком (формат erd-generator)
           erd:last         — id последней открытой диаграммы
           erd:clip         — последний скопированный фрагмент
           erd:prefs        — настройки редактора
           erd:theme        — тема (читает и viewer.js)
   Если localStorage недоступен — работаем в памяти (Store.persistent === false).
   ========================================================================== */
var Store = (function () {
  'use strict';
  const P = 'erd:', K = { index: P + 'index', last: P + 'last', clip: P + 'clip', prefs: P + 'prefs' };
  const DK = id => P + 'd:' + id;

  let ls = null;
  try {
    ls = window.localStorage;
    const probe = P + 'probe'; ls.setItem(probe, '1'); ls.removeItem(probe);
  } catch (e) {
    const m = new Map();
    ls = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k),
      key: i => [...m.keys()][i] || null, get length() { return m.size; } };
    ls.memory = true;
  }

  const isQuota = e => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  const get = k => { try { return ls.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => ls.setItem(k, v); /* может бросить QuotaExceededError */
  const json = (k, def) => { try { const v = JSON.parse(get(k)); return v == null ? def : v; } catch (e) { return def; } };

  function rebuildIndex() {
    const out = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || k.indexOf(P + 'd:') !== 0) continue;
      try {
        const d = JSON.parse(ls.getItem(k));
        out.push({ id: d.id, name: d.name, updatedAt: d.updatedAt, tables: (d.tables || []).length });
      } catch (e) { /* повреждённая запись — пропускаем */ }
    }
    try { set(K.index, JSON.stringify(out)); } catch (e) { /* не критично */ }
    return out;
  }
  function list() {
    const idx = json(K.index, null);
    const arr = Array.isArray(idx) ? idx.filter(x => x && x.id && get(DK(x.id)) != null) : rebuildIndex();
    return arr.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  function writeIndexEntry(d) {
    const idx = (json(K.index, []) || []).filter(x => x && x.id !== d.id);
    idx.push({ id: d.id, name: d.name, updatedAt: d.updatedAt, tables: d.tables.length });
    set(K.index, JSON.stringify(idx));
  }
  function has(id) { return get(DK(id)) != null; }
  function raw(id) { return get(DK(id)); }
  /* загрузка с нормализацией; null — если записи нет или она повреждена */
  function load(id) {
    const s = get(DK(id)); if (s == null) return null;
    try { return Model.normalizeDiagram(JSON.parse(s)).diagram; } catch (e) { return null; }
  }
  function save(d) {
    const text = JSON.stringify(Model.toJSON(d));
    set(DK(d.id), text);
    writeIndexEntry(d);
    return text;
  }
  /* сохраняет только камеру поверх сохранённой версии (не затирая чужие изменения из другой вкладки) */
  function saveView(id, view) {
    const s = get(DK(id)); if (s == null) return false;
    const o = JSON.parse(s);
    o.view = { x: Math.round(view.x * 100) / 100, y: Math.round(view.y * 100) / 100, k: Math.round(view.k * 10000) / 10000 };
    set(DK(id), JSON.stringify(o));
    return true;
  }
  function remove(id) {
    try { ls.removeItem(DK(id)); } catch (e) { /* ignore */ }
    const idx = (json(K.index, []) || []).filter(x => x && x.id !== id);
    try { set(K.index, JSON.stringify(idx)); } catch (e) { /* ignore */ }
  }

  return {
    persistent: !ls.memory, isQuota, K, DK,
    idFromKey: k => (k && k.indexOf(P + 'd:') === 0 ? k.slice(P.length + 2) : null),
    list, has, raw, load, save, saveView, remove,
    getLast: () => get(K.last), setLast: id => { try { set(K.last, id); } catch (e) { /* ignore */ } },
    getPrefs: () => json(K.prefs, {}), setPrefs: p => { try { set(K.prefs, JSON.stringify(p)); } catch (e) { /* ignore */ } },
    getClip: () => get(K.clip), setClip: s => { try { set(K.clip, s); return true; } catch (e) { return false; } }
  };
})();
