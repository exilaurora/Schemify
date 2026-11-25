/* Преобразование логической модели по ключам и доменам. Всё выполняется в браузере. */
var Conversion = (function () {
  'use strict';

  const DIALECTS = {
    postgresql: { name: 'PostgreSQL', quote: '"', decimal: 'numeric', precision: 1000, scale: 1000, varchar: 10485760 },
    mysql: { name: 'MySQL 8.4', quote: '`', decimal: 'decimal', precision: 65, scale: 30, varchar: 65535 }
  };
  const suffixes = { conceptual: 'концептуальная модель', physical: 'физическая модель' };
  const nameFor = (source, kind) => source.name.slice(0, 200 - suffixes[kind].length - 3) + ' · ' + suffixes[kind];
  const fieldName = (t, c) => t.name + ' · ' + c.name;
  const normalizeType = t => t.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  const quoted = (name, q) => q + name.replaceAll(q, q + q) + q;

  function uniqueColumns(expression, names) {
    const list = /^\s*UNIQUE\s*\(([\s\S]*)\)\s*$/i.exec(expression)?.[1];
    if (!list) return null;
    const tokens = /\s*("(?:[^"]|"")*"|`(?:[^`]|``)*`|[^,"`]+?)\s*(,|$)/gy;
    const fields = [];
    while (tokens.lastIndex < list.length) {
      const token = tokens.exec(list);
      if (!token || (token[2] && tokens.lastIndex === list.length)) return null;
      const text = token[1].trim(), q = text[0];
      const name = q === '"' || q === '`' ? text.slice(1, -1).replaceAll(q + q, q) : text;
      if (!name || !names.has(name) || fields.includes(name)) return null;
      fields.push(name);
    }
    return fields.length ? fields : null;
  }

  function inspect(source) {
    const warnings = [];
    const tables = new Map(source.tables.map(t => {
      const names = new Set(t.columns.map(c => c.name));
      const primary = t.columns.filter(c => c.pk);
      const uniques = t.uniques.filter(s => s.trim()).map(expression => ({ expression, fields: uniqueColumns(expression, names) }));
      const records = t.columns.map(c => ({
        table: t, column: c, label: fieldName(t, c),
        unique: c.unique || (c.pk && primary.length === 1) ||
          uniques.some(u => u.fields?.length === 1 && u.fields[0] === c.name),
        indexed: c.pk || c.unique || uniques.some(u => u.fields?.includes(c.name))
      }));
      return [t.id, { t, primary, uniques, records }];
    }));
    const incoming = new Set();
    const links = new Map();
    for (const { records } of tables.values()) {
      for (const record of records) {
        const ref = record.column.ref;
        if (!ref) continue;
        const targetTable = tables.get(ref.table);
        if (targetTable) incoming.add(ref.table);
        const targets = targetTable?.records.filter(r => ref.column == null ? r.column.pk : r.column.name === ref.column) || [];
        const target = targets.length === 1 ? targets[0] : null;
        if (!target?.unique) {
          const reason = targets.length > 1 ? 'у ссылки несколько возможных целевых столбцов' :
            !target ? 'целевой столбец не найден' : 'целевой столбец не образует отдельный уникальный ключ';
          warnings.push(`Связь «${record.label}» пропущена: ${reason}.`);
          continue;
        }
        links.set(record, target);
      }
    }
    return { tables, incoming, links, warnings };
  }

  function conceptual(output, data, fold) {
    const { tables, incoming, links, warnings } = data;
    for (const { t, primary, uniques, records } of tables.values()) {
      const targets = records.map(r => links.get(r));
      const pairIsKey = primary.length === 2 || uniques.some(u => u.fields?.length === 2);
      const bridge = fold && !incoming.has(t.id) && records.length === 2 && pairIsKey &&
        records.every((r, i) => targets[i] && !r.unique && !r.column.nullable) &&
        targets[0].table.id !== targets[1].table.id;
      if (bridge) {
        output.relationships.push({
          from: targets[0].table.id, to: targets[1].table.id, name: t.name.slice(0, 160),
          fromCardinality: '0..*', toCardinality: '0..*'
        });
        warnings.push(`Связующая таблица «${t.name}» преобразована в связь многие-ко-многим.`);
        continue;
      }
      const entity = Model.newTable(t.name, t.x, t.y, t.group, 'conceptual');
      entity.id = t.id;
      entity.description = t.description;
      entity.columns = records.filter(r => !links.has(r)).map(r => Model.newColumn(r.column.name));
      output.tables.push(entity);
      for (const record of records) {
        const target = links.get(record);
        if (!target) continue;
        output.relationships.push({
          from: target.table.id, to: t.id, name: record.column.name.slice(0, 160) || ERD.STR.defaultRelationship,
          fromCardinality: record.column.nullable && !record.column.pk ? '0..1' : '1',
          toCardinality: record.unique ? '0..1' : '0..*'
        });
      }
    }
  }

  const STRING = /^(?:(?:строка|текст)\s*\(\s*(\d+)\s*\)|(?:строка|текст)\s+до\s+(\d+)\s+символ(?:а|ов)?|(?:varchar|character varying)\s*\(\s*(\d+)\s*\))$/;
  const DECIMAL = /^(?:numeric|decimal|десятичное(?: число)?|денежная сумма|сумма|дробное число)\s*\(\s*(\d+)\s*[,;]\s*(\d+)\s*\)$/;
  const RANGE = /^(?:целое(?: число)?|оценка)\s+от\s+(-?\d{1,19})\s+до\s+(-?\d{1,19})$/;
  const COMMON_TYPES = new Map([
    ['целое', 'integer'], ['целое число', 'integer'], ['int', 'integer'], ['int4', 'integer'], ['integer', 'integer'],
    ['длинное целое', 'bigint'], ['bigint', 'bigint'], ['int8', 'bigint'],
    ['короткое целое', 'smallint'], ['smallint', 'smallint'], ['int2', 'smallint'],
    ['дата', 'date'], ['date', 'date'], ['время', 'time'], ['time', 'time'],
    ['логический', 'boolean'], ['логическое', 'boolean'], ['логическое значение', 'boolean'], ['boolean', 'boolean'], ['bool', 'boolean'],
    ['строка', 'text'], ['текст', 'text'], ['text', 'text'], ['json', 'json']
  ]);

  function mapDomain(domain, dialect) {
    const value = normalizeType(domain), mysql = dialect === DIALECTS.mysql;
    const string = STRING.exec(value);
    if (string) {
      const n = Number(string[1] || string[2] || string[3]);
      return n > 0 && n <= dialect.varchar ? { type: `varchar(${n})` } : {};
    }
    const decimal = DECIMAL.exec(value);
    if (decimal) {
      const p = Number(decimal[1]), s = Number(decimal[2]);
      return p >= 1 && p <= dialect.precision && s <= p && s <= dialect.scale ? { type: `${dialect.decimal}(${p},${s})` } : {};
    }
    const range = RANGE.exec(value);
    if (range) {
      const [, first, last] = range;
      const min = BigInt(first), max = BigInt(last);
      if (min > max || min < -9223372036854775808n || max > 9223372036854775807n) return {};
      return {
        type: min >= -2147483648n && max <= 2147483647n ? 'integer' : 'bigint',
        check: name => `${name} BETWEEN ${min} AND ${max}`
      };
    }
    const sign = /^(положительное|неотрицательное) целое(?: число)?$/.exec(value);
    if (sign) return { type: 'integer', check: name => name + (sign[1] === 'положительное' ? ' > 0' : ' >= 0') };
    if (mysql && COMMON_TYPES.get(value) === 'boolean') return {
      type: 'boolean', check: name => name + ' IN (0, 1)'
    };
    if (COMMON_TYPES.has(value)) return { type: COMMON_TYPES.get(value) };
    if (/^(дата и время|дата-время|timestamp|timestamp without time zone|datetime)$/.test(value)) return { type: mysql ? 'datetime' : 'timestamp' };
    if (!mysql && /^(дата и время с часовым поясом|timestamptz|tstz|timestamp with time zone)$/.test(value)) return { type: 'timestamptz' };
    if (!mysql && /^(decimal|numeric|десятичное(?: число)?)$/.test(value)) return { type: 'numeric' };
    if (!mysql && /^(?:smallserial|serial2)$/.test(value)) return { type: 'smallint', generated: 'smallserial' };
    if (!mysql && /^(?:serial|serial4)$/.test(value)) return { type: 'integer', generated: 'serial' };
    if (!mysql && /^(?:bigserial|serial8)$/.test(value)) return { type: 'bigint', generated: 'bigserial' };
    if (!mysql && /^(uuid|jsonb|bytea|real|double precision|inet|cidr|macaddr|interval)$/.test(value)) return { type: value };
    if (mysql && /^(tinyint|mediumint|float|double|blob|longtext)$/.test(value)) return { type: value };
    const fixed = /^(char|character)\s*\(\s*(\d+)\s*\)$/.exec(value);
    if (fixed && +fixed[2] > 0 && +fixed[2] <= (mysql ? 255 : dialect.varchar)) return { type: `char(${+fixed[2]})` };
    return {};
  }

  function physical(output, data, dialect) {
    const { tables, links, warnings } = data;
    const mysql = dialect === DIALECTS.mysql, q = dialect.quote;
    const groups = [];
    const neighbors = new Map();
    for (const { t, records, uniques } of tables.values()) {
      const copy = Model.cloneTable(t);
      copy.definitions ||= [];
      const definitions = copy.definitions.slice();
      copy.uniques = uniques.flatMap(({ expression, fields }) => {
        if (fields?.length === 1 && copy.columns.filter(c => c.name === fields[0]).length === 1) {
          copy.columns.find(c => c.name === fields[0]).unique = true;
          return [];
        }
        if (fields) return ['UNIQUE(' + fields.map(n => quoted(n, q)).join(', ') + ')'];
        warnings.push(`Проверьте ограничение в таблице «${t.name}»: ${expression}`);
        return [expression];
      });
      if (mysql && (t.partitioned || t.definitions?.length || t.columns.some(c => c.defaultValue))) {
        warnings.push(`Проверьте совместимость исходных SQL-выражений таблицы «${t.name}» с MySQL.`);
      }
      records.forEach((record, i) => {
        const column = copy.columns[i];
        const target = links.get(record);
        const selfColumn = mysql && record === target;
        if (selfColumn) {
          warnings.push(`Связь «${record.label}» пропущена: MySQL не допускает внешнюю ссылку столбца на самого себя.`);
          links.delete(record);
        }
        if (column.pk) column.nullable = false;
        column.ref = target && !selfColumn ? { table: target.table.id, column: target.column.name } : null;
        Object.assign(record, { outTable: copy, outColumn: column, definitions, ...mapDomain(record.column.type, dialect) });
        neighbors.set(record, []);
      });
      output.tables.push(copy);
    }
    for (const [record, target] of links) {
      neighbors.get(record).push(target);
      neighbors.get(target).push(record);
      record.indexed = true; target.indexed = true;
      if (mysql && (record.table.partitioned || target.table.partitioned)) {
        warnings.push(`Проверьте связь «${record.label}»: InnoDB не поддерживает внешние ключи для секционированных таблиц.`);
      }
    }

    const seen = new Set();
    for (const record of neighbors.keys()) {
      if (seen.has(record)) continue;
      const members = [record];
      seen.add(record);
      for (const member of members) {
        for (const peer of neighbors.get(member)) {
          if (!seen.has(peer)) { members.push(peer); seen.add(peer); }
        }
      }
      const sink = members.find(r => !links.has(r));
      const known = new Set(members.map(r => r.type).filter(Boolean));
      let type = sink ? sink.type : known.size === 1 ? known.values().next().value : '';
      const indexed = mysql && members.some(r => r.indexed);
      if (indexed && type && invalidMysqlKey(type)) type = '';
      const needsChoice = !type || members.some(r => !r.type && r.column.type.trim());
      if (indexed && !type) {
        warnings.push(`Для ключа «${(sink || record).label}» укажите подходящий тип MySQL. Для строкового ключа задайте ограниченную длину.`);
      }
      const group = { members, indexed, suggestion: type || '', type: needsChoice ? '' : type, dialect };
      groups.push(group);
      if (!needsChoice) {
        for (const r of members) {
          if (r.type !== type) warnings.push(`Для «${r.label}» применён тип связанного ключа ${type}.`);
        }
      }
    }
    applyTypes(groups);
    return groups;
  }

  const invalidMysqlKey = type => /^(?:(?:tiny|medium|long)?(?:text|blob)|json|geometry)\b/i.test(type) ||
    /^(?:varchar|varbinary)\b(?!\s*\(\s*[1-9]\d*\s*\))/i.test(type);
  function setType(group, value) {
    const type = value.trim();
    group.type = group.indexed && invalidMysqlKey(type) ? '' : type;
    return !!group.type;
  }
  const integerType = /^(?:tinyint|smallint|mediumint|int(?:eger)?|bigint)(?:\s*\(\d+\))?(?:\s+unsigned)?$/i;
  function applyTypes(groups) {
    const sourceDefinitions = new Map();
    for (const group of groups) {
      for (const r of group.members) sourceDefinitions.set(r.outTable, r.definitions);
    }
    for (const [table, definitions] of sourceDefinitions) table.definitions = definitions.slice();
    for (const group of groups) {
      for (const r of group.members) {
        r.outColumn.type = r.generated && r.type === group.type ? r.generated : group.type;
        if (r.check && (integerType.test(group.type) || (r.type === 'boolean' && /^(?:boolean|bool)$/i.test(group.type)))) {
          const check = 'CHECK (' + r.check(quoted(r.outColumn.name, group.dialect.quote)) + ')';
          if (!r.outTable.definitions.includes(check)) r.outTable.definitions.push(check);
        }
      }
    }
  }

  function layout(diagram, positions) {
    const boxes = diagram.tables.map(t => {
      [t.x, t.y] = positions.get(t.id);
      return { x: t.x, y: t.y, right: t.x + ERD.tableWidth(t, diagram.kind), bottom: t.y + ERD.tableHeight(t, diagram.kind) };
    }).sort((a, b) => a.x - b.x);
    const overlaps = boxes.some((box, i) => {
      for (let j = i + 1; j < boxes.length && boxes[j].x < box.right + 10; j++) {
        const other = boxes[j];
        if (other.y < box.bottom + 10 && other.bottom + 10 > box.y) return true;
      }
      return false;
    });
    if (overlaps || boxes.some(b => !Number.isFinite(b.x) || !Number.isFinite(b.y))) {
      const counts = new Map();
      for (const t of diagram.tables) counts.set(t.group || '', (counts.get(t.group || '') || 0) + 1);
      const ncols = Object.create(null);
      for (const [key, count] of counts) if (count === 2 || count === 3) ncols[key] = 2;
      ERD.autoLayout(diagram, { ncols });
    }
  }

  function build(source, kind, options = {}) {
    if (source.kind !== 'logical' || !Object.hasOwn(suffixes, kind)) throw new Error('Выберите логическую модель.');
    const key = options.dialect || 'postgresql';
    const dialect = Object.hasOwn(DIALECTS, key) ? DIALECTS[key] : null;
    if (kind === 'physical' && !dialect) throw new Error('Выберите поддерживаемую СУБД.');
    const output = Model.newDiagram(nameFor(source, kind), kind, dialect?.name);
    output.groups = source.groups.map(g => ({ ...g }));
    const data = inspect(source);
    let types = [];
    if (kind === 'conceptual') conceptual(output, data, options.fold !== false);
    else types = physical(output, data, dialect);
    const positions = new Map(source.tables.map(t => [t.id, [t.x, t.y]]));
    layout(output, positions);
    return { diagram: output, types, pending: types.filter(g => !g.type), positions, warnings: data.warnings };
  }

  return { DIALECTS, build, layout, setType, applyTypes };
})();
