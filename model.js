/* ============================================================================
   model.js — слой данных: создание объектов, валидация и нормализация
   импортируемого JSON, миграции версий формата, фрагменты буфера обмена.
   Нормализованная диаграмма всегда имеет канонический порядок ключей —
   так экспорт JSON стабилен и совпадает после round-trip.
   ========================================================================== */
var Model = (function () {
  'use strict';
  const S = ERD.STR, fmt = ERD.fmt;
  const FORMAT = 'erd-generator', BUNDLE = 'erd-generator-bundle', CLIP = 'erd-generator-clipboard';
  const VERSION = 1;

  /* Популярные типы PostgreSQL для подсказок (datalist) */
  const PG_TYPES = ['bigint', 'int', 'integer', 'smallint', 'serial', 'bigserial', 'numeric', 'numeric(12,2)', 'real',
    'double precision', 'money', 'text', 'varchar(255)', 'char(1)', 'citext', 'bool', 'boolean', 'uuid', 'date', 'time',
    'timetz', 'timestamp', 'timestamptz', 'tstz', 'interval', 'json', 'jsonb', 'bytea', 'inet', 'cidr', 'macaddr',
    'tsvector', 'int[]', 'text[]', 'point', 'geometry', 'enum'];

  /* Палитра групп — пары цветов эталона (светлая / тёмная тема) */
  const PALETTE = [
    ['#2f7dd1', '#4a97ec'], ['#1f9d7a', '#35b895'], ['#d98a1c', '#eba33a'], ['#d0473f', '#ee6a61'],
    ['#8a5cd6', '#a683ef'], ['#c2497d', '#e0679c'], ['#5f8f2f', '#82b552'], ['#6f7f9c', '#8395b6']
  ];

  class ModelError extends Error {}

  function uid() {
    if (window.crypto && crypto.randomUUID) { try { return crypto.randomUUID(); } catch (e) { /* небезопасный контекст */ } }
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256 | 0; });
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  const groupId = () => 'g_' + uid().slice(0, 8);
  const now = () => new Date().toISOString();

  /* ---------- цвета ---------- */
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
    }
    return [h, s * 100, l * 100];
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  /* более светлый и насыщенный вариант для тёмной темы (как пары в эталоне) */
  function lighten(hex) {
    if (!ERD.HEX.test(hex)) return '#8395b6';
    const known = PALETTE.find(p => p[0] === hex.toLowerCase());
    if (known) return known[1];
    const [h, s, l] = hexToHsl(hex);
    return hslToHex(h, Math.min(100, s + 12), Math.min(82, l + 10));
  }
  function nextColor(groups) {
    const used = new Set(groups.map(g => (g.color || '').toLowerCase()));
    const p = PALETTE.find(c => !used.has(c[0])) || PALETTE[groups.length % PALETTE.length];
    return { color: p[0], colorDark: p[1] };
  }

  /* ---------- конструкторы ---------- */
  function newDiagram(name) {
    return { format: FORMAT, version: VERSION, id: uid(), name: name || S.newDiagramName, updatedAt: now(), view: null, groups: [], tables: [] };
  }
  function newGroup(title, groups) {
    const c = nextColor(groups || []);
    return { id: groupId(), title: title || '', color: c.color, colorDark: c.colorDark };
  }
  function newColumn(name, type, o) {
    o = o || {};
    return { name: name || '', type: type || '', pk: !!o.pk, unique: !!o.unique, nullable: !!o.nullable, ref: o.ref || null };
  }
  function newTable(name, x, y, group) {
    return {
      id: uid(), name, group: group || null, description: '', partitioned: false, uniques: [],
      x: Math.round(x || 0), y: Math.round(y || 0), columns: [newColumn('id', 'bigint', { pk: true })]
    };
  }

  /* ---------- нормализация ---------- */
  const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' ? String(v) : '').slice(0, max || 10000);
  const num = v => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null);
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

  function normGroups(raw, warnings) {
    const out = [], map = new Map();
    (Array.isArray(raw) ? raw : []).forEach((g, i) => {
      if (!isObj(g)) { warnings.push(fmt(S.wBadGroup, { i })); return; }
      let id = str(g.id, 64);
      const orig = id;
      if (!ERD.GID.test(id) || out.some(x => x.id === id)) id = groupId();
      const color = ERD.HEX.test(g.color) ? g.color.toLowerCase() : nextColor(out).color;
      const colorDark = ERD.HEX.test(g.colorDark) ? g.colorDark.toLowerCase() : lighten(color);
      const title = str(g.title, 200) || str(g.name, 200) || orig || id;
      out.push({ id, title, color, colorDark });
      if (orig && !map.has(orig)) map.set(orig, id);
    });
    return { groups: out, map };
  }

  function normColumn(c) {
    if (typeof c === 'string') c = { name: c };
    if (!isObj(c)) return null;
    let ref = null;
    if (isObj(c.ref) && str(c.ref.table)) ref = { table: str(c.ref.table, 200), column: c.ref.column == null || c.ref.column === '' ? null : str(c.ref.column, 200) };
    return {
      name: str(c.name, 200), type: str(c.type, 200),
      pk: !!c.pk, unique: !!c.unique, nullable: !!c.nullable && !c.pk, ref
    };
  }

  /* таблицы: id, группы, столбцы; ссылки остаются «как есть» — их проверяет checkRefs */
  function normTables(raw, gmap, warnings) {
    const out = [], ids = new Set(), idMap = new Map();
    (Array.isArray(raw) ? raw : []).forEach((t, i) => {
      if (!isObj(t)) { warnings.push(fmt(S.wBadTable, { i })); return; }
      const name = str(t.name, 200) || 'table_' + (i + 1);
      let id = str(t.id, 200);
      if (!id || ids.has(id)) { if (id) warnings.push(fmt(S.wDupId, { t: name })); const old = id; id = uid(); if (old && !idMap.has(old)) idMap.set(old, id); }
      ids.add(id);
      let group = t.group == null || t.group === '' ? null : str(t.group, 64);
      if (group != null) {
        if (gmap.has(group)) group = gmap.get(group);
        else { warnings.push(fmt(S.wUnknownGroup, { t: name, g: group })); group = null; }
      }
      const cols = [];
      (Array.isArray(t.columns) ? t.columns : []).forEach((c, ci) => {
        const n = normColumn(c);
        if (n) cols.push(n); else warnings.push(fmt(S.wBadColumn, { t: name, i: ci + 1 }));
      });
      const uniques = (Array.isArray(t.uniques) ? t.uniques : typeof t.uniques === 'string' ? [t.uniques] : [])
        .map(u => str(u, 500)).filter(u => u.trim());
      const x = num(t.x), y = num(t.y);
      out.push({
        id, name, group, description: str(t.description), partitioned: !!t.partitioned, uniques,
        x: x == null ? null : Math.round(x * 100) / 100, y: y == null ? null : Math.round(y * 100) / 100, columns: cols
      });
    });
    return { tables: out, ids, idMap };
  }

  /* битые ссылки не роняют приложение: связь убирается, выдаётся предупреждение */
  function checkRefs(tables, warnings, allowIds) {
    const byId = new Map(tables.map(t => [t.id, t]));
    tables.forEach(t => t.columns.forEach(c => {
      if (!c.ref) return;
      if (allowIds && allowIds.has(c.ref.table)) return;
      if (!ERD.resolveRef(byId, c.ref)) {
        const tt = byId.get(c.ref.table);
        warnings.push(fmt(S.wBrokenRef, { t: t.name, c: c.name, target: tt ? tt.name + '.' + (c.ref.column || 'PK') : c.ref.table }));
        c.ref = null;
      }
    }));
  }
  /* ссылки по старым id → новые; ссылка по имени таблицы (частая ошибка ИИ) → её id */
  function remapRefs(tables, idMap) {
    const ids = new Set(tables.map(t => t.id)), byName = new Map();
    tables.forEach(t => { if (!byName.has(t.name)) byName.set(t.name, t.id); });
    tables.forEach(t => t.columns.forEach(c => {
      if (!c.ref) return;
      if (idMap.has(c.ref.table)) c.ref.table = idMap.get(c.ref.table);
      else if (!ids.has(c.ref.table) && byName.has(c.ref.table)) c.ref.table = byName.get(c.ref.table);
    }));
  }

  /* миграции: ключ — исходная версия, функция поднимает объект на версию выше */
  const MIGRATIONS = {
    0: d => {
      /* v0 (черновой): uniques строкой, ref строкой-именем таблицы */
      (d.tables || []).forEach(t => {
        if (typeof t.uniques === 'string') t.uniques = [t.uniques];
        (t.columns || []).forEach(c => {
          if (typeof c.ref === 'string') {
            const [tn, cn] = c.ref.split('.');
            const tt = (d.tables || []).find(x => x.name === tn);
            c.ref = tt ? { table: tt.id, column: cn || null } : { table: c.ref, column: null };
          }
        });
      });
      d.version = 1; return d;
    }
  };
  function migrate(d) {
    let v = d.version == null ? 1 : num(d.version);
    if (v == null) v = 0;
    if (v > VERSION) throw new ModelError(fmt(S.eVersion, { v, max: VERSION }));
    while (v < VERSION) { d = (MIGRATIONS[v] || (x => x))(d); v++; }
    return d;
  }

  function normalizeDiagram(raw, warnings) {
    warnings = warnings || [];
    if (!isObj(raw)) throw new ModelError(S.eNotObject);
    if (raw.format == null) { if (!Array.isArray(raw.tables)) throw new ModelError(S.eFormat); warnings.push(S.wNoFormat); }
    else if (raw.format !== FORMAT) throw new ModelError(S.eFormat);
    raw = migrate(raw);
    if (!Array.isArray(raw.tables)) throw new ModelError(S.eTables);
    const { groups, map } = normGroups(raw.groups, warnings);
    const { tables, idMap } = normTables(raw.tables, map, warnings);
    remapRefs(tables, idMap);
    checkRefs(tables, warnings);
    let view = null;
    if (isObj(raw.view) && num(raw.view.x) != null && num(raw.view.y) != null && num(raw.view.k) > 0) {
      view = { x: num(raw.view.x), y: num(raw.view.y), k: Math.min(ERD.C.MAX_K, Math.max(ERD.C.MIN_K, num(raw.view.k))) };
    }
    const d = {
      format: FORMAT, version: VERSION, id: str(raw.id, 200) || uid(), name: str(raw.name, 200) || S.newDiagramName,
      updatedAt: str(raw.updatedAt, 40) || now(), view, groups, tables
    };
    ensurePositions(d, warnings);
    return { diagram: d, warnings };
  }

  function ensurePositions(d, warnings) {
    if (d.tables.some(t => t.x == null || t.y == null)) {
      ERD.autoLayout(d);
      if (warnings) warnings.push(S.wNoPos);
    }
  }

  /* канонический объект для экспорта / сохранения */
  function toJSON(d) {
    return {
      format: FORMAT, version: VERSION, id: d.id, name: d.name, updatedAt: d.updatedAt,
      view: d.view ? { x: round2(d.view.x), y: round2(d.view.y), k: Math.round(d.view.k * 10000) / 10000 } : null,
      groups: d.groups.map(g => ({ id: g.id, title: g.title, color: g.color, colorDark: g.colorDark })),
      tables: d.tables.map(cloneTable)
    };
  }
  const round2 = v => Math.round(v * 100) / 100;
  function cloneTable(t) {
    return {
      id: t.id, name: t.name, group: t.group, description: t.description, partitioned: t.partitioned,
      uniques: t.uniques.slice(), x: round2(t.x), y: round2(t.y),
      columns: t.columns.map(c => ({ name: c.name, type: c.type, pk: c.pk, unique: c.unique, nullable: c.nullable, ref: c.ref ? { table: c.ref.table, column: c.ref.column } : null }))
    };
  }

  /* ---------- разбор любого поддерживаемого текста ---------- */
  function extractFromHtml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const s = doc.getElementById('erd-data') || doc.querySelector('script[type="application/json"]');
    if (!s || !s.textContent.trim()) throw new ModelError(S.eHtml);
    return s.textContent;
  }
  /* ответ нейросети: снимаем обёртку ```json … ``` и текст вокруг JSON-объекта */
  function unwrapJSON(text) {
    const t = text.trim();
    if (t[0] === '{' || t[0] === '[') return t;
    const fence = t.match(/```[a-zA-Z]*\s*\n([\s\S]*?)```/);
    if (fence && /^\s*[{[]/.test(fence[1])) return fence[1];
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    return a >= 0 && b > a ? t.slice(a, b + 1) : t;
  }
  function parseJSON(text) {
    try { return JSON.parse(text); } catch (e) { throw new ModelError(fmt(S.eJson, { msg: e.message })); }
  }
  /* → {kind:'diagram'|'bundle'|'clipboard', diagrams?, fragment?, warnings} */
  function parseAny(text, filename) {
    text = String(text || '').replace(/^﻿/, '');
    const looksHtml = /\.html?$/i.test(filename || '') || /^\s*</.test(text);
    const raw = parseJSON(looksHtml && !/^\s*```/.test(text) ? extractFromHtml(text) : unwrapJSON(text));
    if (!isObj(raw)) throw new ModelError(S.eNotObject);
    const warnings = [];
    if (raw.format === BUNDLE) {
      if (!Array.isArray(raw.diagrams)) throw new ModelError(S.eBundle);
      const diagrams = [];
      raw.diagrams.forEach((r, i) => {
        try { diagrams.push(normalizeDiagram(r, warnings).diagram); }
        catch (e) { warnings.push(fmt(S.wBadDiagram, { i: i + 1, msg: e.message })); }
      });
      if (!diagrams.length) throw new ModelError(S.eBundle);
      return { kind: 'bundle', diagrams, warnings };
    }
    if (raw.format === CLIP) return { kind: 'clipboard', fragment: normalizeFragment(raw, warnings), warnings };
    return { kind: 'diagram', diagrams: [normalizeDiagram(raw, warnings).diagram], warnings };
  }

  /* ---------- фрагменты (копирование / вставка) ---------- */
  /* только связи, обе стороны которых входят в выделение */
  function makeFragment(d, ids) {
    const set = new Set(ids);
    const tables = d.tables.filter(t => set.has(t.id)).map(cloneTable);
    tables.forEach(t => t.columns.forEach(c => { if (c.ref && !set.has(c.ref.table)) c.ref = null; }));
    const gids = new Set(tables.map(t => t.group).filter(Boolean));
    return {
      format: CLIP, version: VERSION, source: { diagram: d.id, name: d.name }, copiedAt: now(),
      groups: d.groups.filter(g => gids.has(g.id)).map(g => Object.assign({}, g)), tables
    };
  }
  function normalizeFragment(raw, warnings) {
    warnings = warnings || [];
    if (!isObj(raw)) throw new ModelError(S.eNotObject);
    if (raw.format === FORMAT) { const d = normalizeDiagram(raw, warnings).diagram; return { groups: d.groups, tables: d.tables }; }
    if (raw.format !== CLIP) throw new ModelError(S.eFormat);
    if (num(raw.version) > VERSION) throw new ModelError(fmt(S.eVersion, { v: raw.version, max: VERSION }));
    const { groups, map } = normGroups(raw.groups, warnings);
    const { tables, idMap } = normTables(raw.tables, map, warnings);
    remapRefs(tables, idMap);
    const ids = new Set(tables.map(t => t.id));
    tables.forEach(t => t.columns.forEach(c => { if (c.ref && !ids.has(c.ref.table)) c.ref = null; }));
    checkRefs(tables, warnings);
    let x = 0; tables.forEach(t => { if (t.x == null || t.y == null) { t.x = x; t.y = 0; x += ERD.C.W + ERD.C.GAP; } });
    return { groups, tables };
  }

  function uniqueName(name, taken) {
    if (!taken.has(name)) return name;
    let n = name + '_copy', i = 2;
    while (taken.has(n)) n = name + '_copy' + i++;
    return n;
  }

  /* Вставка фрагмента в диаграмму. Возвращает {ids, renamed, groupsCreated}.
     keepExternalRefs — для дублирования внутри той же диаграммы. */
  function insertFragment(d, frag, pos, opts) {
    opts = opts || {};
    const gmap = new Map(); let groupsCreated = 0;
    frag.groups.forEach(g => {
      let tg = d.groups.find(x => x.id === g.id) ||
        d.groups.find(x => x.title.trim().toLowerCase() === g.title.trim().toLowerCase());
      if (!tg) {
        tg = { id: d.groups.some(x => x.id === g.id) ? groupId() : g.id, title: g.title, color: g.color, colorDark: g.colorDark };
        d.groups.push(tg); groupsCreated++;
      }
      gmap.set(g.id, tg.id);
    });
    const idMap = new Map(frag.tables.map(t => [t.id, uid()]));
    const taken = new Set(d.tables.map(t => t.name)), renamed = [];
    const tables = frag.tables.map(t => {
      const c = cloneTable(t);
      c.id = idMap.get(t.id);
      c.group = t.group ? gmap.get(t.group) || (d.groups.some(g => g.id === t.group) ? t.group : null) : null;
      const nn = uniqueName(t.name, taken); if (nn !== t.name) renamed.push(t.name + ' → ' + nn);
      c.name = nn; taken.add(nn);
      c.columns.forEach(col => {
        if (!col.ref) return;
        if (idMap.has(col.ref.table)) col.ref.table = idMap.get(col.ref.table);
        else if (!(opts.keepExternalRefs && d.tables.some(x => x.id === col.ref.table))) col.ref = null;
      });
      return c;
    });
    /* сдвиг: центр фрагмента → pos, без точного наложения на существующие таблицы */
    if (tables.length && pos) {
      const x0 = Math.min(...tables.map(t => t.x)), y0 = Math.min(...tables.map(t => t.y));
      const x1 = Math.max(...tables.map(t => t.x + ERD.tableWidth(t))), y1 = Math.max(...tables.map(t => t.y + ERD.tableHeight(t)));
      let dx = pos.x - (x0 + x1) / 2, dy = pos.y - (y0 + y1) / 2;
      if (opts.snap) { dx = Math.round(dx / opts.snap) * opts.snap; dy = Math.round(dy / opts.snap) * opts.snap; }
      const occupied = new Set(d.tables.map(t => Math.round(t.x) + ',' + Math.round(t.y)));
      const step = opts.snap ? opts.snap * 2 : 40;
      for (let k = 0; k < 50 && tables.some(t => occupied.has(Math.round(t.x + dx) + ',' + Math.round(t.y + dy))); k++) { dx += step; dy += step; }
      tables.forEach(t => { t.x = Math.round(t.x + dx); t.y = Math.round(t.y + dy); });
    }
    tables.forEach(t => d.tables.push(t));
    return { ids: tables.map(t => t.id), renamed, groupsCreated };
  }

  /* удаление таблиц: ссылки на них превращаются в обычные столбцы */
  function removeTables(d, ids) {
    const set = new Set(ids);
    d.tables = d.tables.filter(t => !set.has(t.id));
    d.tables.forEach(t => t.columns.forEach(c => { if (c.ref && set.has(c.ref.table)) c.ref = null; }));
  }
  function renameColumn(d, t, i, name) {
    const old = t.columns[i].name;
    if (old === name) return;
    d.tables.forEach(x => x.columns.forEach(c => { if (c.ref && c.ref.table === t.id && c.ref.column === old) c.ref.column = name; }));
    t.columns[i].name = name;
  }
  function removeColumn(d, t, i) {
    const old = t.columns[i];
    t.columns.splice(i, 1);
    d.tables.forEach(x => x.columns.forEach(c => { if (c.ref && c.ref.table === t.id && c.ref.column === old.name) c.ref = null; }));
  }

  return {
    FORMAT, BUNDLE, CLIP, VERSION, PG_TYPES, PALETTE, ModelError,
    uid, groupId, now, lighten, nextColor, newDiagram, newGroup, newTable, newColumn,
    normalizeDiagram, ensurePositions, toJSON, cloneTable, parseAny, extractFromHtml,
    makeFragment, normalizeFragment, insertFragment, uniqueName, removeTables, renameColumn, removeColumn
  };
})();
