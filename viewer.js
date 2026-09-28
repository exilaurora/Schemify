/* ============================================================================
   viewer.js — общий модуль отрисовки ER-диаграммы.

   Используется редактором (app.js) и ЦЕЛИКОМ вшивается в экспортируемый HTML
   через ERDCoreFactory.toString(). Поэтому:
     • внутри фабрики нельзя ссылаться на внешние переменные;
     • в исходнике фабрики не должно встречаться закрывающего тега скрипта.
   Здесь же лежат: константы размеров, словарь строк интерфейса, базовый CSS
   (темы и стиль диаграммы как в эталоне), геометрия связей, авто-раскладка,
   класс Renderer, панель деталей и автономный просмотрщик runViewer().
   ========================================================================== */
function ERDCoreFactory() {
  'use strict';

  /* ---------- КОНСТАНТЫ ---------- */
  const C = {
    W: 300, HEAD: 30, ROW: 21, GAP: 26, GPAD: 20, GHEAD: 46,
    UQ_LINE: 14, FOOT: 6, R: 8, GRID: 24, MIN_K: 0.12, MAX_K: 3,
    GROUP_GAP_X: 50, GROUP_GAP_Y: 30
  };
  const MONO = 'ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace';
  const MONO2 = 'ui-monospace,Menlo,Consolas,monospace';
  const FONT = {
    name: '600 13px ' + MONO,
    col: '11.5px ' + MONO,
    type: '10px ' + MONO2,
    foot: 'italic 10px ' + MONO2
  };
  const THEME_KEY = 'erd:theme';
  const NS = 'http://www.w3.org/2000/svg';

  /* ---------- СЛОВАРЬ СТРОК (весь интерфейс) ---------- */
  const STR = {
    appTitle: 'ER-редактор',
    schemaSuffix: 'схема БД',
    viewerSubtitle: 'схема БД',
    search: 'Поиск',
    searchPh: 'Поиск таблицы или поля…',
    fit: 'По размеру',
    resetLayout: 'Сбросить раскладку',
    theme: 'Тема',
    themeAria: 'Переключить светлую/тёмную тему',
    close: 'Закрыть',
    noGroup: 'Без группы',
    partitioned: 'PARTITIONED',
    partSuffix: ' · партиционированная',
    columns: 'Столбцы',
    refsOut: 'Ссылается на',
    refsIn: 'На неё ссылаются',
    nullAllowed: '  (NULL допускается)',
    tablesN: ['таблица', 'таблицы', 'таблиц'],
    edgesN: ['связь', 'связи', 'связей'],
    legendTitle: 'Как читать',
    legendNotNull: 'связь FK (NOT NULL)',
    legendNull: 'FK допускает NULL',
    legendEnds: '● конец у FK-поля   ▏ конец у PK-поля',
    legendHint: 'Наведи на таблицу — подсветятся связи · клик — детали · тяни карточки · колесо — зум',
    legendEditHint: 'Двойной клик по фону — новая таблица · тяни ● у строки к таблице — FK · Shift+тяни — рамка выделения',
    canvasAria: 'Холст диаграммы',

    /* редактор: верхняя панель */
    diagrams: 'Диаграммы',
    toggleSidebar: 'Показать/скрыть список диаграмм',
    diagramName: 'Название диаграммы',
    modeView: 'Просмотр',
    modeEdit: 'Правка',
    modeAria: 'Режим работы',
    addTable: '+ Таблица',
    addTableAria: 'Добавить таблицу',
    addGroup: '+ Группа',
    groupsBtn: 'Группы',
    undo: 'Отменить (Ctrl+Z)',
    redo: 'Повторить (Ctrl+Shift+Z)',
    autoLayout: 'Авторасстановка',
    snap: 'Сетка',
    snapAria: 'Привязка к сетке',
    fileMenu: 'Файл',
    minimap: 'Мини-карта',
    minimapAria: 'Мини-карта: клик — перейти',
    saved: 'Сохранено',
    saving: 'Сохранение…',
    saveFailed: 'Не сохранено',
    memoryOnly: 'Без сохранения',

    /* меню «Файл» */
    mImport: 'Импорт JSON / HTML…',
    mExportJson: 'Экспорт JSON',
    mExportHtml: 'Экспорт HTML',
    mExportSvg: 'Экспорт SVG',
    mExportPng: 'Экспорт PNG',
    mExportAll: 'Экспорт всех диаграмм',
    mCopy: 'Копировать',
    mPaste: 'Вставить',
    mPasteJson: 'Вставить из JSON…',
    mSample: 'Загрузить пример (netwatch)',
    mNewDiagram: 'Новая диаграмма',

    /* боковая панель диаграмм */
    newDiagram: '+ Новая',
    newDiagramName: 'Новая диаграмма',
    rename: 'Переименовать',
    duplicate: 'Дублировать',
    del: 'Удалить',
    copySuffix: ' (копия)',
    justNow: 'только что',
    minAgo: '{n} мин назад',
    today: 'сегодня {t}',
    yesterday: 'вчера {t}',
    deleteDiagramQ: 'Удалить диаграмму «{name}»? Это действие нельзя отменить.',
    deleteTitle: 'Удаление',
    renameTitle: 'Переименование',
    importBtn: 'Импорт…',
    exportAllBtn: 'Экспорт всех',
    sampleBtn: 'Пример',

    /* панель таблицы */
    tableName: 'Имя таблицы',
    group: 'Группа',
    newGroupOpt: '＋ Новая группа…',
    partitionedLbl: 'Партиционированная (PARTITIONED)',
    description: 'Описание',
    addColumn: '+ Столбец',
    colName: 'Имя столбца',
    colType: 'Тип',
    dragHandle: 'Перетащите, чтобы изменить порядок (или Alt+↑/↓)',
    delColumn: 'Удалить столбец',
    fkNone: '— без FK —',
    fkTarget: 'FK: таблица',
    fkColumn: 'FK: столбец',
    fkPk: 'PK',
    fkNoPk: 'PK (нет PK!)',
    fkBroken: '⚠ цель не найдена',
    uniques: 'Ограничения UNIQUE',
    addUnique: '+ UNIQUE',
    uniquePh: 'UNIQUE(col_a, col_b)',
    delUnique: 'Удалить ограничение',
    dupName: 'Такое имя уже есть в диаграмме',
    duplicateTable: 'Дублировать',
    deleteTable: 'Удалить',
    copyBtn: 'Копировать',
    pasteBtn: 'Вставить',
    selectedN: 'Выделено: {n}',
    moveToGroup: 'Переместить в группу',
    groupFromSel: 'Новая группа из выделенных',
    groupsTitle: 'Группы',
    groupTitle: 'Название группы',
    colorLight: 'Цвет (светлая тема)',
    colorDark: 'Цвет (тёмная тема)',
    delGroup: 'Удалить группу',
    selectGroupTables: 'Выделить таблицы группы',
    groupN: 'Группа {n}',
    noGroups: 'Групп пока нет. Таблицы без группы рисуются без рамки.',
    emptyHint: 'Диаграмма пуста. Двойной клик по фону или «+ Таблица» — создать таблицу; «Файл → Загрузить пример» — схема netwatch.',

    /* уведомления */
    undone: 'Отменено',
    redone: 'Повторено',
    nothingSelected: 'Ничего не выделено',
    copied: 'Скопировано: {n}',
    cut: 'Вырезано: {n}',
    pasted: 'Вставлено: {n}',
    renamedOnPaste: 'Переименованы из-за совпадения имён: {list}',
    clipEmpty: 'Буфер пуст: скопируйте таблицы (Ctrl+C) или вставьте JSON вручную',
    clipBadFormat: 'В буфере нет фрагмента схемы',
    deleted: 'Удалено таблиц: {n}',
    groupDeleted: 'Группа «{name}» удалена, её таблицы перенесены в «Без группы»',
    movedToGroup: 'Перенесено в группу «{name}»',
    linkCreated: 'Связь {from} → {to}',
    linkNoPk: 'У таблицы «{name}» нет PK — перетащите на конкретную строку',
    viewModeRO: 'Режим просмотра: правка отключена',
    quotaTitle: 'Хранилище браузера переполнено',
    quotaText: 'Не удалось сохранить диаграмму: в localStorage закончилось место. Экспортируйте диаграмму в JSON, чтобы не потерять изменения, и удалите ненужные диаграммы.',
    storageUnavailable: 'Хранилище браузера недоступно — изменения не сохранятся после закрытия вкладки',
    externalChange: 'Диаграмма изменена в другой вкладке',
    externalDeleted: 'Диаграмма удалена в другой вкладке. Изменения здесь сохранятся как новая копия.',
    reload: 'Обновить',
    dismiss: 'Скрыть',
    exported: 'Файл сохранён: {name}',
    exportFailed: 'Не удалось экспортировать: {msg}',
    sampleLoaded: 'Пример загружен: {n} таблиц',

    /* импорт */
    importTitle: 'Импорт',
    importOne: 'Диаграмма «{name}»: {tables}, {edges}.',
    importBundle: 'В архиве диаграмм: {n}.',
    importCollide: 'Совпадает id с уже существующими: {n}.',
    importCollideOne: 'Диаграмма с таким id уже есть в хранилище — при создании будет присвоен новый id.',
    importAsNew: 'Создать новую диаграмму',
    importReplace: 'Заменить текущую',
    importAllNew: 'Добавить как новые',
    importOverwrite: 'Перезаписать совпадающие',
    cancel: 'Отмена',
    ok: 'OK',
    importFailed: 'Не удалось импортировать файл',
    importDone: 'Импортировано диаграмм: {n}',
    warnings: 'Предупреждения',
    dropHint: 'Отпустите файл для импорта',
    pasteJsonTitle: 'Вставить из JSON',
    pasteJsonHelp: 'Вставьте JSON фрагмента (erd-generator-clipboard) или целой диаграммы (erd-generator).',
    pasteJsonBtn: 'Вставить',

    /* ошибки валидации */
    eJson: 'Файл не является корректным JSON: {msg}',
    eNotObject: 'Ожидался JSON-объект',
    eFormat: 'Неизвестный формат файла. Ожидается «erd-generator», «erd-generator-bundle» или «erd-generator-clipboard»',
    eVersion: 'Файл создан более новой версией формата ({v}); поддерживается версия до {max}',
    eTables: 'В диаграмме нет массива tables',
    eBundle: 'В архиве нет массива diagrams',
    eHtml: 'В HTML-файле не найдены данные диаграммы (script type="application/json")',
    wNoFormat: 'Поле format отсутствует — файл прочитан как диаграмма',
    wBadTable: 'Пропущен некорректный элемент tables[{i}]',
    wBadColumn: 'Таблица «{t}»: пропущен некорректный столбец #{i}',
    wDupId: 'Таблица «{t}»: повторяющийся id заменён',
    wBadGroup: 'Пропущена некорректная группа #{i}',
    wUnknownGroup: 'Таблица «{t}»: группа «{g}» не найдена — таблица без группы',
    wBrokenRef: 'Связь {t}.{c} → «{target}» не найдена и проигнорирована',
    wBadDiagram: 'Диаграмма #{i} пропущена: {msg}',
    wNoPos: 'У части таблиц не было координат — выполнена авторасстановка'
  };

  function fmt(s, o) {
    return String(s).replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? o[k] : m));
  }
  function plural(n, forms) {
    const a = Math.abs(n) % 100, b = a % 10;
    const f = a > 10 && a < 20 ? forms[2] : b > 1 && b < 5 ? forms[1] : b === 1 ? forms[0] : forms[2];
    return n + ' ' + f;
  }

  /* ---------- БАЗОВЫЙ CSS (темы + диаграмма, как в эталоне) ---------- */
  const CSS = `
:root{
  --bg:#f4f5f7; --panel:#ffffff; --card:#ffffff; --card-line:#d5d9e0; --text:#1c2230; --muted:#7a8394;
  --edge:#8b93a3; --grid:#e3e6eb; --shadow:0 2px 10px rgba(20,30,50,.10);
  --c-ref:#6f7f9c; --c-infra:#2f7dd1; --c-devices:#1f9d7a; --c-traffic:#d98a1c;
  --c-ssh:#d0473f; --c-rules:#8a5cd6; --c-incidents:#c2497d; --c-users:#5f8f2f;
  --accent:#2f7dd1; --fk:#2f7dd1; --pk:#d98a1c; --danger:#d0473f; --ok:#1f9d7a; --nogroup:#6f7f9c;
  color-scheme:light;
}
[data-theme=dark]{
  --bg:#12151c; --panel:#1b2029; --card:#1e2430; --card-line:#333c4d; --text:#e6e9ef; --muted:#8b95a8;
  --edge:#6c768a; --grid:#1b2029; --shadow:0 2px 14px rgba(0,0,0,.5);
  --c-ref:#8395b6; --c-infra:#4a97ec; --c-devices:#35b895; --c-traffic:#eba33a;
  --c-ssh:#ee6a61; --c-rules:#a683ef; --c-incidents:#e0679c; --c-users:#82b552;
  --accent:#4a97ec; --fk:#4a97ec; --pk:#eba33a; --danger:#ee6a61; --ok:#35b895; --nogroup:#8395b6;
  color-scheme:dark;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
#top{position:fixed;left:0;right:0;top:0;z-index:5;display:flex;gap:10px;align-items:center;flex-wrap:wrap;
  padding:8px 14px;background:var(--panel);border-bottom:1px solid var(--card-line);box-shadow:var(--shadow)}
#top h1{font-size:15px;margin:0 6px 0 0;font-weight:650;white-space:nowrap}
#top h1 small{font-weight:400;color:var(--muted);margin-left:6px}
input[type=search]{background:var(--bg);color:var(--text);border:1px solid var(--card-line);border-radius:8px;
  padding:6px 10px;font-size:13px;width:190px;outline:none}
input[type=search]:focus{border-color:var(--accent)}
button{background:var(--bg);color:var(--text);border:1px solid var(--card-line);border-radius:8px;
  padding:6px 10px;font-size:13px;cursor:pointer;font-family:inherit}
button:hover{border-color:var(--muted)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;cursor:pointer;
  border:1px solid var(--card-line);background:var(--bg);user-select:none;color:var(--text)}
.chip i{width:9px;height:9px;border-radius:50%;background:var(--c)}
.chip.off{opacity:.45}
.chip.off i{background:transparent;border:1.5px solid var(--c)}
#svg{position:fixed;inset:0;width:100%;height:100%;cursor:grab;touch-action:none;
  background-image:radial-gradient(var(--grid) 1.2px,transparent 1.2px);background-size:24px 24px}
#svg.panning{cursor:grabbing}
.gbox{fill:var(--c);fill-opacity:.07;stroke:var(--c);stroke-opacity:.35;stroke-width:1.2;stroke-dasharray:5 5}
.gtitle{fill:var(--c);font-size:15px;font-weight:700;letter-spacing:.3px;user-select:none}
.node{cursor:move;transition:opacity .15s}
.node text{user-select:none}
.node .body{fill:var(--card);stroke:var(--card-line);stroke-width:1}
.node .head{fill:var(--c)}
.node.sel .body{stroke:var(--c);stroke-width:2.5}
.node .tname{fill:#fff;font:${FONT.name}}
.node .pbadge{fill:#fff;fill-opacity:.9;font:700 8.5px system-ui,sans-serif}
.node .pbg{fill:#fff;fill-opacity:.22}
.node .cn{fill:var(--text);font:${FONT.col}}
.node .cn.fkc{fill:var(--fk)}
.node .ct{fill:var(--muted);font:${FONT.type};text-anchor:end}
.node .flag{font:700 8px system-ui,sans-serif;fill:var(--muted)}
.node .flag.pk{fill:var(--pk)}
.node .flag.fk{fill:var(--fk)}
.node .foot{fill:var(--muted);font:${FONT.foot}}
.node .rowhl{fill:var(--c);fill-opacity:.0}
.node .row:hover .rowhl{fill-opacity:.1}
.node.dim,.gbox.dim,.gtitle.dim{opacity:.16}
.node.match .body{stroke:var(--pk);stroke-width:2.5}
.edge{fill:none;stroke:var(--edge);stroke-width:1.3;stroke-opacity:.55;transition:opacity .15s}
.edge.nl{stroke-dasharray:3 4}
.edge.hl{stroke:var(--c);stroke-opacity:1;stroke-width:2.2;stroke-dasharray:7 5;animation:flow .7s linear infinite}
.edge.dim{stroke-opacity:.06}
.emark{fill:var(--edge);fill-opacity:.7}
.emark.hl{fill:var(--c);fill-opacity:1}
.emark.dim{fill-opacity:.06}
.hit{fill:none;stroke:transparent;stroke-width:12;pointer-events:stroke}
@keyframes flow{to{stroke-dashoffset:-24}}
@media (prefers-reduced-motion:reduce){.edge.hl{animation:none}}
#panel{position:fixed;right:12px;top:calc(var(--th,56px) + 10px);bottom:12px;width:330px;z-index:4;background:var(--panel);
  border:1px solid var(--card-line);border-radius:12px;box-shadow:var(--shadow);overflow:auto;padding:14px 16px;
  transform:translateX(calc(100% + 20px));transition:transform .2s;visibility:hidden}
#panel.open{transform:none;visibility:visible}
#panel h2{margin:0 0 2px;font:650 16px ${MONO2};word-break:break-all;padding-right:28px}
#panel .g{font-size:12px;color:var(--c);font-weight:600;margin-bottom:8px}
#panel p{font-size:13px;line-height:1.45;margin:6px 0 10px;white-space:pre-wrap;overflow-wrap:anywhere}
#panel h3{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:14px 0 6px}
#panel table{width:100%;border-collapse:collapse;font:11.5px ${MONO2}}
#panel td{padding:3px 4px;border-bottom:1px solid var(--card-line);overflow-wrap:anywhere}
#panel td:last-child{color:var(--muted);text-align:right}
#panel .lnk{display:block;padding:4px 0;font:12px ${MONO2};color:var(--fk);cursor:pointer;text-decoration:none}
#panel .lnk:hover{text-decoration:underline}
#panel .lnk span{color:var(--muted)}
#panel .uq{font:11.5px ${MONO2};color:var(--muted);margin:2px 0}
#close{position:absolute;right:8px;top:8px;padding:2px 8px}
#legend{position:fixed;left:12px;bottom:12px;z-index:3;background:var(--panel);border:1px solid var(--card-line);
  border-radius:10px;padding:8px 12px;font-size:11.5px;color:var(--muted);line-height:1.7;box-shadow:var(--shadow)}
#legend b{color:var(--text);font-weight:600}
.ls{display:inline-block;width:26px;vertical-align:middle;border-top:2px solid var(--edge);margin-right:6px}
.ls.d{border-top-style:dotted}
#stats{color:var(--muted);font-size:12px;margin-left:auto;white-space:nowrap}
@media(max-width:800px){
  #panel{top:auto;left:8px;right:8px;width:auto;bottom:8px;height:46%;transform:translateY(calc(100% + 20px))}
  #legend{display:none} input[type=search]{width:130px}
}
`;

  /* ---------- DOM-ХЕЛПЕРЫ (только textContent, без innerHTML) ---------- */
  const PROPS = { value: 1, checked: 1, disabled: 1, selected: 1 };
  function append(e, kids) {
    if (kids == null) return e;
    if (!Array.isArray(kids)) kids = [kids];
    for (const c of kids) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) append(e, c);
      else e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') { for (const s in v) e.style.setProperty(s, v[s]); }
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (PROPS[k]) e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    return append(e, kids);
  }
  function mk(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /* ---------- ТЕМЫ И ЦВЕТА ГРУПП ---------- */
  function initialTheme() {
    try { const t = localStorage.getItem(THEME_KEY); if (t === 'dark' || t === 'light') return t; } catch (e) { /* нет доступа */ }
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function setTheme(t, persist) {
    document.documentElement.setAttribute('data-theme', t);
    if (persist) try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* нет доступа */ }
  }
  function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const GID = /^[A-Za-z0-9_-]{1,64}$/;
  const colorVar = gid => (gid ? 'var(--c-' + gid + ')' : 'var(--nogroup)');
  const gkey = t => t.group || '';
  function applyGroupColors(groups) {
    let st = document.getElementById('erd-group-colors');
    if (!st) { st = document.createElement('style'); st.id = 'erd-group-colors'; document.head.appendChild(st); }
    let a = '', b = '';
    (groups || []).forEach(g => {
      if (!GID.test(g.id)) return;
      if (HEX.test(g.color)) a += '--c-' + g.id + ':' + g.color + ';';
      if (HEX.test(g.colorDark)) b += '--c-' + g.id + ':' + g.colorDark + ';';
    });
    st.textContent = ':root{' + a + '}:root[data-theme=dark]{' + b + '}';
  }
  function injectCSS() {
    if (document.getElementById('erd-base-css')) return;
    const st = document.createElement('style'); st.id = 'erd-base-css'; st.textContent = CSS;
    document.head.insertBefore(st, document.head.firstChild);
  }

  /* ---------- ИЗМЕРЕНИЕ ТЕКСТА И РАЗМЕРЫ КАРТОЧЕК ---------- */
  let ctx2d = null; const mcache = new Map();
  function measure(text, font) {
    const key = font + '\u0000' + text;
    let w = mcache.get(key);
    if (w != null) return w;
    if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d');
    ctx2d.font = font; w = ctx2d.measureText(text).width;
    if (mcache.size > 20000) mcache.clear();
    mcache.set(key, w);
    return w;
  }
  const uniquesOf = t => (t.uniques || []).filter(u => u && String(u).trim());
  function tableHeight(t) {
    const u = uniquesOf(t).length;
    return C.HEAD + t.columns.length * C.ROW + (u ? C.FOOT + u * C.UQ_LINE : C.FOOT);
  }
  function tableWidth(t) {
    let w = C.W;
    w = Math.max(w, 12 + measure(t.name, FONT.name) + (t.partitioned ? 100 : 14));
    t.columns.forEach(c => {
      w = Math.max(w, 50 + measure(c.name + (c.nullable ? '?' : ''), FONT.col) + 16 + measure(c.type || '', FONT.type) + 10);
    });
    uniquesOf(t).forEach(u => { w = Math.max(w, 20 + measure(u, FONT.foot)); });
    return Math.ceil(w);
  }

  /* ---------- ИНДЕКС: СВЯЗИ ВЫВОДЯТСЯ ИЗ columns[].ref ---------- */
  function resolveRef(byId, ref) {
    const tt = byId.get(ref.table);
    if (!tt) return null;
    const ti = ref.column != null ? tt.columns.findIndex(x => x.name === ref.column) : tt.columns.findIndex(x => x.pk);
    return ti < 0 ? null : { to: tt, ti };
  }
  function buildIndex(d) {
    const byId = new Map(), neigh = new Map(), fk = new Set(), edges = [], broken = [];
    d.tables.forEach(t => { byId.set(t.id, t); neigh.set(t.id, new Set()); });
    d.tables.forEach(t => t.columns.forEach((c, i) => {
      if (!c.ref) return;
      const r = resolveRef(byId, c.ref);
      if (!r) { broken.push({ t, i }); return; }
      edges.push({ from: t, fi: i, to: r.to, ti: r.ti, nullable: !!c.nullable });
      fk.add(t.id + '\u0000' + i);
      neigh.get(t.id).add(r.to.id); neigh.get(r.to.id).add(t.id);
    }));
    return { byId, edges, neigh, fk, broken };
  }
  function groupById(d, gid) { return gid ? d.groups.find(g => g.id === gid) || null : null; }

  /* ---------- АВТОРАСКЛАДКА: группы блоками, внутри — masonry ---------- */
  function autoLayout(d, cfg) {
    cfg = cfg || {};
    const members = new Map();
    const keys = d.groups.map(g => g.id);
    keys.forEach(k => members.set(k, []));
    d.tables.forEach(t => {
      const k = t.group && members.has(t.group) ? t.group : '';
      if (!members.has(k)) { members.set(k, []); keys.push(k); }
      members.get(k).push(t);
    });
    const live = keys.filter(k => members.get(k).length);
    const ncolsOf = k => {
      if (cfg.ncols && cfg.ncols[k]) return cfg.ncols[k];
      const n = members.get(k).length;
      return n <= 3 ? 1 : n <= 8 ? 2 : Math.min(8, Math.ceil(Math.sqrt(n / 2)));
    };
    /* раскладка одного блока в координатах (0,0); возвращает размеры */
    const block = k => {
      const ts = members.get(k), n = ncolsOf(k);
      const colW = Math.max(C.W, ...ts.map(tableWidth));
      const colY = Array(n).fill(C.GHEAD), pos = [];
      ts.forEach(t => {
        const ci = colY.indexOf(Math.min(...colY));
        pos.push([t, C.GPAD + ci * (colW + C.GAP), colY[ci]]);
        colY[ci] += tableHeight(t) + C.GAP;
      });
      return { pos, w: n * (colW + C.GAP) - C.GAP + C.GPAD * 2, h: Math.max(...colY) };
    };
    const blocks = new Map(live.map(k => [k, block(k)]));
    let rows = cfg.rows ? cfg.rows.map(r => r.filter(k => blocks.has(k))).filter(r => r.length) : null;
    const used = new Set(rows ? rows.flat() : []);
    const rest = live.filter(k => !used.has(k));
    if (rest.length) {
      /* жадная упаковка блоков в ряды с целевой шириной ~ 16:9 */
      const area = rest.reduce((s, k) => s + blocks.get(k).w * blocks.get(k).h, 0);
      const target = Math.max(...rest.map(k => blocks.get(k).w), Math.sqrt(area * 1.8));
      const packed = []; let cur = [], cw = 0;
      rest.forEach(k => {
        const w = blocks.get(k).w;
        if (cur.length && cw + C.GROUP_GAP_X + w > target) { packed.push(cur); cur = []; cw = 0; }
        cw += (cur.length ? C.GROUP_GAP_X : 0) + w; cur.push(k);
      });
      if (cur.length) packed.push(cur);
      rows = (rows || []).concat(packed);
    }
    let y = 0;
    (rows || []).forEach(r => {
      let x = 0, bottom = y;
      r.forEach(k => {
        const b = blocks.get(k);
        b.pos.forEach(([t, px, py]) => { t.x = x + px; t.y = y + py; });
        x += b.w + C.GROUP_GAP_X; bottom = Math.max(bottom, y + b.h);
      });
      y = bottom + C.GROUP_GAP_Y;
    });
  }

  /* ---------- ОТРИСОВКА ---------- */
  class Renderer {
    constructor(svg, opts) {
      this.svg = svg; this.opts = opts || {};
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      this.vp = mk('g', { id: 'vp' }, svg);
      this.gl = mk('g', { id: 'gl' }, this.vp);
      this.el = mk('g', { id: 'el' }, this.vp);
      this.nl = mk('g', { id: 'nl' }, this.vp);
      this.ol = mk('g', { id: 'ol' }, this.vp);
      this.nodes = new Map(); this.gEls = new Map();
      this.edges = []; this.edgesBy = new Map();
      this.idx = null; this.d = null;
      this.st = { selected: new Set(), hovered: null, query: '', hidden: new Set() };
    }
    get view() { return this.d.view; }
    setDiagram(d) {
      this.d = d;
      if (!d.view || !isFinite(d.view.x) || !isFinite(d.view.y) || !(d.view.k > 0)) d.view = { x: 0, y: 0, k: 1 };
      this.st.selected.clear(); this.st.hovered = null;
      this.rebuild(); this.applyView();
    }
    /* полная (ids не задан) или частичная перерисовка карточек; связи и группы — всегда */
    rebuild(ids) {
      const d = this.d;
      this.idx = buildIndex(d);
      applyGroupColors(d.groups);
      for (const [id, n] of this.nodes) if (!this.idx.byId.has(id)) { n.g.remove(); this.nodes.delete(id); }
      if (!ids) {
        this.nl.textContent = ''; this.nodes.clear();
        d.tables.forEach(t => this._node(t));
      } else {
        const only = new Set(ids);
        d.tables.forEach(t => {
          const old = this.nodes.get(t.id);
          if (!old) this._node(t); else if (only.has(t.id)) this._node(t, old.g);
        });
      }
      for (const id of this.st.selected) if (!this.idx.byId.has(id)) this.st.selected.delete(id);
      if (this.st.hovered && !this.idx.byId.has(this.st.hovered)) this.st.hovered = null;
      this._syncGroups(); this._buildEdges(); this.drawGroups(); this.refresh();
    }
    _node(t, replace) {
      const w = tableWidth(t), h = tableHeight(t), fk = this.idx.fk;
      const g = mk('g', { class: 'node', 'data-id': t.id });
      g.style.setProperty('--c', colorVar(t.group));
      mk('rect', { class: 'body', width: w, height: h, rx: C.R }, g);
      mk('path', { class: 'head', d: `M0 8a8 8 0 0 1 8-8h${w - 16}a8 8 0 0 1 8 8v${C.HEAD - 8}H0z` }, g);
      mk('text', { class: 'tname', x: 12, y: 20 }, g).textContent = t.name;
      if (t.partitioned) {
        mk('rect', { class: 'pbg', x: w - 92, y: 8, width: 82, height: 15, rx: 7 }, g);
        mk('text', { class: 'pbadge', x: w - 51, y: 19, 'text-anchor': 'middle' }, g).textContent = STR.partitioned;
      }
      t.columns.forEach((c, i) => {
        const ry = C.HEAD + i * C.ROW, isFk = fk.has(t.id + '\u0000' + i);
        const r = mk('g', { class: 'row', 'data-i': i }, g);
        mk('rect', { class: 'rowhl', x: 1, y: ry, width: w - 2, height: C.ROW }, r);
        const flags = [];
        if (c.pk) flags.push('PK'); if (isFk) flags.push('FK'); if (c.unique) flags.push('UQ');
        mk('text', { class: 'flag ' + (flags[0] === 'PK' ? 'pk' : flags[0] === 'FK' ? 'fk' : ''), x: 8, y: ry + 14 }, r).textContent = flags.join('·');
        mk('text', { class: 'cn' + (isFk ? ' fkc' : ''), x: 50, y: ry + 14.5 }, r).textContent = c.name + (c.nullable ? '?' : '');
        mk('text', { class: 'ct', x: w - 10, y: ry + 14 }, r).textContent = c.type || '';
        if (this.opts.ports) mk('circle', { class: 'port', cx: w, cy: ry + C.ROW / 2, r: 5 }, r);
      });
      uniquesOf(t).forEach((u, i) => {
        mk('text', { class: 'foot', x: 10, y: C.HEAD + t.columns.length * C.ROW + 13 + i * C.UQ_LINE }, g).textContent = u;
      });
      if (replace) this.nl.replaceChild(g, replace); else this.nl.appendChild(g);
      this.nodes.set(t.id, { g, w, h });
      this.place(t);
    }
    _syncGroups() {
      const live = new Set();
      this.d.groups.forEach(gr => {
        live.add(gr.id);
        let ge = this.gEls.get(gr.id);
        if (!ge) {
          const r = mk('rect', { class: 'gbox', rx: 16, 'data-gid': gr.id });
          const tx = mk('text', { class: 'gtitle', 'data-gid': gr.id });
          ge = { r, tx }; this.gEls.set(gr.id, ge);
        }
        this.gl.appendChild(ge.r); this.gl.appendChild(ge.tx);
        ge.r.style.setProperty('--c', colorVar(gr.id)); ge.tx.style.setProperty('--c', colorVar(gr.id));
        ge.tx.textContent = gr.title;
      });
      for (const [gid, ge] of this.gEls) if (!live.has(gid)) { ge.r.remove(); ge.tx.remove(); this.gEls.delete(gid); }
    }
    _buildEdges() {
      this.el.textContent = ''; this.edgesBy = new Map();
      this.edges = this.idx.edges;
      this.edges.forEach(e => {
        e.path = mk('path', { class: 'edge' + (e.nullable ? ' nl' : '') }, this.el);
        e.hit = mk('path', { class: 'hit' }, this.el);
        e.m1 = mk('circle', { class: 'emark', r: 3.6 }, this.el);
        e.m2 = mk('rect', { class: 'emark', width: 2.4, height: 11, y: -5.5, rx: 1 }, this.el);
        mk('title', {}, e.hit).textContent = `${e.from.name}.${e.from.columns[e.fi].name} → ${e.to.name}.${e.to.columns[e.ti].name}` + (e.nullable ? STR.nullAllowed : '');
        const c = colorVar(e.to.group);
        e.path.style.setProperty('--c', c); e.m1.style.setProperty('--c', c); e.m2.style.setProperty('--c', c);
        [e.from.id, e.to.id].forEach(id => {
          if (!this.edgesBy.has(id)) this.edgesBy.set(id, []);
          const a = this.edgesBy.get(id); if (a[a.length - 1] !== e) a.push(e);
        });
      });
      this.drawEdges(this.edges);
    }
    info(id) { return this.nodes.get(id); }
    place(t) { const n = this.nodes.get(t.id); if (n) n.g.setAttribute('transform', `translate(${t.x},${t.y})`); }
    geom(e) {
      const A = this.nodes.get(e.from.id), B = this.nodes.get(e.to.id);
      const y1 = e.from.y + C.HEAD + e.fi * C.ROW + C.ROW / 2, y2 = e.to.y + C.HEAD + e.ti * C.ROW + C.ROW / 2;
      const fl = e.from.x, fr = fl + A.w, tl = e.to.x, tr = tl + B.w; let s1, s2;
      if (fr + 12 <= tl) { s1 = 1; s2 = -1; } else if (tr + 12 <= fl) { s1 = -1; s2 = 1; } else { s1 = 1; s2 = 1; }
      const x1 = s1 > 0 ? fr : fl, x2 = s2 > 0 ? tr : tl;
      const d = s1 === s2 ? 55 + Math.abs(y1 - y2) * 0.12 : Math.max(50, Math.abs(x2 - x1) / 2);
      return { x1, y1, x2, y2, d: `M${x1} ${y1}C${x1 + s1 * d} ${y1},${x2 + s2 * d} ${y2},${x2} ${y2}` };
    }
    drawEdges(list) {
      list.forEach(e => {
        const g = this.geom(e); e.path.setAttribute('d', g.d); e.hit.setAttribute('d', g.d);
        e.m1.setAttribute('cx', g.x1); e.m1.setAttribute('cy', g.y1);
        e.m2.setAttribute('x', g.x2 - 1.2); e.m2.setAttribute('y', g.y2 - 5.5);
      });
    }
    /* границы групп по видимым таблицам (exclude — множество id, которые не учитывать) */
    groupBounds(exclude) {
      const b = new Map(), hid = this.st.hidden;
      this.d.tables.forEach(t => {
        if (!t.group || hid.has(t.group) || (exclude && exclude.has(t.id))) return;
        const n = this.nodes.get(t.id); if (!n) return;
        let r = b.get(t.group);
        if (!r) { r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; b.set(t.group, r); }
        r.x0 = Math.min(r.x0, t.x); r.y0 = Math.min(r.y0, t.y);
        r.x1 = Math.max(r.x1, t.x + n.w); r.y1 = Math.max(r.y1, t.y + n.h);
      });
      b.forEach(r => { r.x0 -= C.GPAD; r.y0 -= C.GHEAD; r.x1 += C.GPAD; r.y1 += C.GPAD; });
      return b;
    }
    drawGroups() {
      const b = this.groupBounds();
      for (const [gid, ge] of this.gEls) {
        const r = b.get(gid);
        if (!r) { ge.r.style.display = ge.tx.style.display = 'none'; continue; }
        ge.r.style.display = ge.tx.style.display = '';
        ge.r.setAttribute('x', r.x0); ge.r.setAttribute('y', r.y0);
        ge.r.setAttribute('width', r.x1 - r.x0); ge.r.setAttribute('height', r.y1 - r.y0);
        ge.tx.setAttribute('x', r.x0 + 16); ge.tx.setAttribute('y', r.y0 + 28);
      }
    }
    /* быстрый путь для перетаскивания: только затронутые карточки, связи и рамки */
    moveTables(ids) {
      const es = new Set();
      ids.forEach(id => {
        const t = this.idx.byId.get(id); if (!t) return;
        this.place(t); (this.edgesBy.get(id) || []).forEach(e => es.add(e));
      });
      this.drawEdges(es); this.drawGroups();
    }
    matches(q) {
      const m = new Set(); q = (q || '').trim().toLowerCase(); if (!q) return m;
      this.d.tables.forEach(t => {
        if (t.name.toLowerCase().includes(q) || t.columns.some(c => c.name.toLowerCase().includes(q))) m.add(t.id);
      });
      return m;
    }
    isVisible(t) { return !this.st.hidden.has(gkey(t)); }
    /* подсветка: выбор/наведение → связи и соседи, остальное затемняется */
    refresh() {
      const st = this.st, idx = this.idx;
      let focus = null;
      if (st.selected.size) focus = st.selected;
      else if (st.hovered && this.nodes.has(st.hovered)) focus = new Set([st.hovered]);
      let near = null;
      if (focus) { near = new Set(focus); focus.forEach(id => { const n = idx.neigh.get(id); if (n) n.forEach(x => near.add(x)); }); }
      const q = st.query.trim(), matches = this.matches(q), nearGroups = new Set();
      let vt = 0, ve = 0;
      this.d.tables.forEach(t => {
        const n = this.nodes.get(t.id); if (!n) return;
        const vis = this.isVisible(t); if (vis) vt++;
        n.g.style.display = vis ? '' : 'none';
        let dim = false;
        if (near) dim = !near.has(t.id); else if (q) dim = !matches.has(t.id);
        if (near && near.has(t.id)) nearGroups.add(gkey(t));
        n.g.classList.toggle('dim', dim);
        n.g.classList.toggle('sel', st.selected.has(t.id));
        n.g.classList.toggle('match', !!q && matches.has(t.id));
      });
      for (const [gid, ge] of this.gEls) {
        const d = !!focus && !nearGroups.has(gid);
        ge.r.classList.toggle('dim', d); ge.tx.classList.toggle('dim', d);
      }
      this.edges.forEach(e => {
        const vis = this.isVisible(e.from) && this.isVisible(e.to); if (vis) ve++;
        [e.path, e.hit, e.m1, e.m2].forEach(x => { x.style.display = vis ? '' : 'none'; });
        const rel = !!focus && (focus.has(e.from.id) || focus.has(e.to.id));
        [e.path, e.m1, e.m2].forEach(x => { x.classList.toggle('hl', rel); x.classList.toggle('dim', !!focus && !rel); });
      });
      const stats = { tables: vt, edges: ve, matches };
      if (this.opts.onStats) this.opts.onStats(stats);
      return stats;
    }
    /* ---- камера ---- */
    applyView() {
      const v = this.d.view;
      this.vp.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`);
      if (this.opts.onView) this.opts.onView(v);
    }
    toWorld(cx, cy) {
      const r = this.svg.getBoundingClientRect(), v = this.d.view;
      return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
    }
    zoomAt(cx, cy, k2) {
      const v = this.d.view, r = this.svg.getBoundingClientRect();
      k2 = Math.min(C.MAX_K, Math.max(C.MIN_K, k2));
      const mx = cx - r.left, my = cy - r.top;
      v.x = mx - (mx - v.x) * (k2 / v.k); v.y = my - (my - v.y) * (k2 / v.k); v.k = k2;
      this.applyView();
    }
    onWheel(ev) {
      ev.preventDefault();
      this.zoomAt(ev.clientX, ev.clientY, this.d.view.k * Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.036 : 0.0012)));
    }
    /* границы видимых таблиц с отступом под рамки групп */
    bounds(onlyIds) {
      const ts = this.d.tables.filter(t => this.isVisible(t) && this.nodes.has(t.id) && (!onlyIds || onlyIds.has(t.id)));
      if (!ts.length) return null;
      return {
        x0: Math.min(...ts.map(t => t.x)) - C.GPAD - 10,
        y0: Math.min(...ts.map(t => t.y)) - C.GHEAD - 10,
        x1: Math.max(...ts.map(t => t.x + this.nodes.get(t.id).w)) + C.GPAD + 10,
        y1: Math.max(...ts.map(t => t.y + this.nodes.get(t.id).h)) + C.GPAD + 10
      };
    }
    fit(m) {
      m = Object.assign({ top: 0, left: 0, right: 0, bottom: 0 }, m);
      const b = this.bounds(); if (!b) return;
      const vw = Math.max(100, innerWidth - m.left - m.right), vh = Math.max(100, innerHeight - m.top - m.bottom);
      const k = Math.max(C.MIN_K, Math.min(vw / (b.x1 - b.x0), vh / (b.y1 - b.y0), 1.2));
      const v = this.d.view;
      v.k = k; v.x = m.left + (vw - (b.x1 - b.x0) * k) / 2 - b.x0 * k; v.y = m.top + (vh - (b.y1 - b.y0) * k) / 2 - b.y0 * k;
      this.applyView();
    }
    centerAt(wx, wy, m, minK) {
      m = Object.assign({ top: 0, left: 0, right: 0, bottom: 0 }, m);
      const v = this.d.view; if (minK) v.k = Math.max(v.k, minK);
      v.x = m.left + (innerWidth - m.left - m.right) / 2 - wx * v.k;
      v.y = m.top + (innerHeight - m.top - m.bottom) / 2 - wy * v.k;
      this.applyView();
    }
    centerOn(t, m) {
      const n = this.nodes.get(t.id); if (!n) return;
      this.centerAt(t.x + n.w / 2, t.y + n.h / 2, m, 0.9);
    }
    /* центр видимой области в мировых координатах */
    viewCenter(m) {
      m = Object.assign({ top: 0, left: 0, right: 0, bottom: 0 }, m);
      const v = this.d.view;
      return { x: (m.left + (innerWidth - m.left - m.right) / 2 - v.x) / v.k, y: (m.top + (innerHeight - m.top - m.bottom) / 2 - v.y) / v.k };
    }
    nodeIdOf(target) {
      const n = target && target.closest ? target.closest('.node') : null;
      return n ? n.getAttribute('data-id') : null;
    }
  }

  /* ---------- ПАНЕЛЬ ДЕТАЛЕЙ (только чтение) ---------- */
  function renderDetails(pc, d, idx, t, onLink) {
    pc.textContent = '';
    const g = groupById(d, t.group);
    const out = idx.edges.filter(e => e.from === t), inn = idx.edges.filter(e => e.to === t);
    const link = (target, txt) => el('a', {
      class: 'lnk', href: '#',
      onclick: ev => { ev.preventDefault(); onLink(target); }
    }, [target.name + ' ', el('span', { text: txt })]);
    append(pc, [
      el('h2', { text: t.name }),
      el('div', { class: 'g', style: { '--c': colorVar(t.group) }, text: (g ? g.title : STR.noGroup) + (t.partitioned ? STR.partSuffix : '') }),
      t.description ? el('p', { text: t.description }) : null,
      el('h3', { text: STR.columns }),
      el('table', {}, t.columns.map((c, i) => {
        const fl = [c.pk && 'PK', idx.fk.has(t.id + '\u0000' + i) && 'FK', c.unique && 'UQ', c.nullable && 'NULL'].filter(Boolean).join(' ');
        return el('tr', {}, [el('td', { text: c.name }), el('td', { text: c.type || '' }), el('td', { text: fl })]);
      })),
      uniquesOf(t).map(u => el('p', { class: 'uq', text: u })),
      out.length ? [el('h3', { text: `${STR.refsOut} (${out.length})` }), out.map(e => link(e.to, '← ' + e.from.columns[e.fi].name))] : null,
      inn.length ? [el('h3', { text: `${STR.refsIn} (${inn.length})` }), inn.map(e => link(e.from, '→ ' + e.from.columns[e.fi].name))] : null
    ].flat(2));
  }

  function buildLegend(box, extra) {
    box.textContent = '';
    append(box, [
      el('b', { text: STR.legendTitle }), el('br'),
      el('span', { class: 'ls' }), STR.legendNotNull + '   ', el('span', { class: 'ls d' }), STR.legendNull, el('br'),
      STR.legendEnds, el('br'),
      el('span', { class: 'lh', text: extra || STR.legendHint })
    ]);
  }

  /* чипы групп: показать/скрыть */
  function buildChips(box, d, hidden, onToggle) {
    box.textContent = '';
    const items = d.groups.map(g => ({ key: g.id, title: g.title, c: colorVar(g.id) }));
    if (d.tables.some(t => !t.group)) items.push({ key: '', title: STR.noGroup, c: colorVar('') });
    items.forEach(it => {
      const off = hidden.has(it.key);
      const b = el('button', {
        class: 'chip' + (off ? ' off' : ''), type: 'button', style: { '--c': it.c }, 'aria-pressed': String(!off),
        onclick: () => {
          hidden.has(it.key) ? hidden.delete(it.key) : hidden.add(it.key);
          b.classList.toggle('off', hidden.has(it.key)); b.setAttribute('aria-pressed', String(!hidden.has(it.key)));
          onToggle(it.key);
        }
      }, [el('i'), it.title]);
      box.appendChild(b);
    });
  }

  /* ---------- АВТОНОМНЫЙ ПРОСМОТРЩИК (для экспортированного HTML) ---------- */
  function runViewer(data) {
    const d = data || {};
    d.name = String(d.name || '');
    d.groups = Array.isArray(d.groups) ? d.groups : [];
    d.tables = Array.isArray(d.tables) ? d.tables : [];
    d.tables.forEach(t => { t.columns = Array.isArray(t.columns) ? t.columns : []; t.x = +t.x || 0; t.y = +t.y || 0; });
    setTheme(initialTheme());
    const initial = d.tables.map(t => [t, t.x, t.y]);
    const hadView = d.view && d.view.k > 0;
    const view0 = hadView ? Object.assign({}, d.view) : null;

    let q, chips, stats, pc, panel, closeB;
    const top = el('div', { id: 'top' }, [
      el('h1', {}, [d.name, el('small', { text: STR.viewerSubtitle })]),
      q = el('input', { id: 'q', type: 'search', placeholder: STR.searchPh, 'aria-label': STR.search }),
      chips = el('div', { id: 'chips' }),
      el('button', { id: 'fit', type: 'button', text: STR.fit, onclick: () => fitV() }),
      el('button', { id: 'reset', type: 'button', text: STR.resetLayout, onclick: resetV }),
      el('button', { id: 'theme', type: 'button', text: STR.theme, 'aria-label': STR.themeAria, onclick: () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark', true) }),
      stats = el('span', { id: 'stats', 'aria-live': 'polite' })
    ]);
    const svg = mk('svg', { id: 'svg', role: 'application', 'aria-label': STR.canvasAria });
    panel = el('div', { id: 'panel', role: 'complementary' }, [
      closeB = el('button', { id: 'close', type: 'button', text: '✕', 'aria-label': STR.close }),
      pc = el('div', { id: 'pc' })
    ]);
    const legend = el('div', { id: 'legend' });
    buildLegend(legend);
    document.body.append(top, svg, panel, legend);
    const th = () => document.documentElement.style.setProperty('--th', top.offsetHeight + 'px');
    th(); addEventListener('resize', th);
    if (window.ResizeObserver) new ResizeObserver(th).observe(top);

    const R = new Renderer(svg, {
      onStats: s => { stats.textContent = plural(s.tables, STR.tablesN) + ' · ' + plural(s.edges, STR.edgesN); }
    });
    R.setDiagram(d);
    const st = R.st, T = () => top.offsetHeight;
    const margins = () => ({ top: T(), right: panel.classList.contains('open') && innerWidth > 800 ? 340 : 0 });
    const fitV = () => R.fit({ top: T() });
    if (view0) { d.view = view0; R.applyView(); } else fitV();

    function select(id) {
      st.selected.clear(); if (id) st.selected.add(id);
      R.refresh();
      const t = id && R.idx.byId.get(id);
      if (t) { renderDetails(pc, d, R.idx, t, tt => { select(tt.id); R.centerOn(tt, margins()); }); panel.classList.add('open'); }
      else panel.classList.remove('open');
    }
    function resetV() {
      initial.forEach(([t, x, y]) => { t.x = x; t.y = y; });
      R.rebuild();
      if (view0) { Object.assign(d.view, view0); R.applyView(); } else fitV();
    }
    closeB.onclick = () => select(null);
    buildChips(chips, d, st.hidden, () => {
      const s = [...st.selected][0];
      if (s && !R.isVisible(R.idx.byId.get(s))) select(null);
      R.drawGroups(); R.refresh();
    });
    q.addEventListener('input', () => { st.query = q.value; R.refresh(); });
    q.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const m = R.matches(q.value); const t = d.tables.find(x => m.has(x.id) && R.isVisible(x));
      if (t) R.centerOn(t, margins());
    });
    addEventListener('keydown', e => { if (e.key === 'Escape') select(null); });

    svg.addEventListener('wheel', ev => R.onWheel(ev), { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', ev => {
      if (ev.button > 1) return;
      const id = R.nodeIdOf(ev.target), t = id && R.idx.byId.get(id);
      drag = { t, sx: ev.clientX, sy: ev.clientY, ox: t ? t.x : d.view.x, oy: t ? t.y : d.view.y, moved: false };
      svg.setPointerCapture(ev.pointerId); if (!t) svg.classList.add('panning');
    });
    svg.addEventListener('pointermove', ev => {
      if (!drag) {
        const id = R.nodeIdOf(ev.target);
        if (id !== st.hovered) { st.hovered = id; if (!st.selected.size) R.refresh(); }
        return;
      }
      const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.t) { drag.t.x = drag.ox + dx / d.view.k; drag.t.y = drag.oy + dy / d.view.k; R.moveTables([drag.t.id]); }
      else { d.view.x = drag.ox + dx; d.view.y = drag.oy + dy; R.applyView(); }
    });
    svg.addEventListener('pointerup', () => {
      if (drag && !drag.moved) select(drag.t ? (st.selected.has(drag.t.id) ? null : drag.t.id) : null);
      drag = null; svg.classList.remove('panning');
    });
    svg.addEventListener('pointerleave', () => { if (!drag && st.hovered) { st.hovered = null; if (!st.selected.size) R.refresh(); } });
    return R;
  }

  return {
    C, FONT, STR, CSS, NS, HEX, GID, THEME_KEY,
    fmt, plural, el, mk, append,
    initialTheme, setTheme, currentTheme, applyGroupColors, injectCSS, colorVar, gkey,
    measure, tableWidth, tableHeight, uniquesOf, buildIndex, resolveRef, groupById, autoLayout,
    Renderer, renderDetails, buildLegend, buildChips, runViewer
  };
}

/* Подключение в редакторе: CSS и тема применяются сразу (скрипт в <head>, без мигания). */
var ERD = ERDCoreFactory();
ERD.injectCSS();
ERD.setTheme(ERD.initialTheme());
