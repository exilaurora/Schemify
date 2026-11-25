/* ============================================================================
   samples.js — учебные модели учёта успеваемости и схема
   мониторинга сети из эталона (43 таблицы, 60 связей) с той же раскладкой.
   Описание в компактной нотации эталона: [имя, тип, флаги, ссылка].
   ========================================================================== */
var Samples = (function () {
  'use strict';

  /* Сборка диаграммы из компактной нотации. flags: 'pk','uq','null'; ref: 'table' или 'table.col' */
  function build(name, groups, defs, layoutCfg, kind) {
    const d = Model.newDiagram(name, kind);
    d.groups = groups.map(([id, title, color, colorDark]) => ({ id, title, color, colorDark }));
    const byName = {};
    defs.forEach(([tn, group, description, cols, o]) => {
      o = o || {};
      const t = {
        id: Model.uid(), name: tn, group, description, partitioned: !!o.part, uniques: o.uq ? [o.uq] : [], x: 0, y: 0,
        columns: cols.map(c => ({
          name: c[0], type: c[1], pk: (c[2] || '').includes('pk'), unique: (c[2] || '').includes('uq'),
          nullable: (c[2] || '').includes('null'), ref: c[3] || null
        }))
      };
      byName[tn] = t; d.tables.push(t);
    });
    d.tables.forEach(t => t.columns.forEach(c => {
      if (!c.ref) return;
      const [tn, cn] = c.ref.split('.');
      c.ref = { table: byName[tn].id, column: cn || null };
    }));
    ERD.autoLayout(d, layoutCfg);
    return d;
  }

  function university(kind, name) {
    name = name || 'Учёт успеваемости';
    const concepts = [
      ['Студент', 'Обучающийся в вузе.', ['Номер зачётной книжки', 'ФИО']],
      ['Дисциплина', 'Учебная дисциплина.', ['Код дисциплины', 'Название']],
      ['Результат аттестации', 'Оценка за одну попытку аттестации.', ['Номер попытки', 'Дата аттестации', 'Оценка']]
    ];
    let d;
    if (kind === 'conceptual') {
      d = Model.newDiagram(name, kind);
      d.tables = concepts.map(([title, description, attributes]) => ({
        ...Model.newTable(title, 0, 0, null, kind), description,
        columns: attributes.map(attribute => Model.newColumn(attribute))
      }));
      const [student, discipline, result] = d.tables;
      d.relationships = [
        { from: student.id, to: result.id, name: 'получает', fromCardinality: '1', toCardinality: '0..*' },
        { from: discipline.id, to: result.id, name: 'оценивается в', fromCardinality: '1', toCardinality: '0..*' }
      ];
    } else if (kind === 'logical') {
      d = build(name, [], [
        ['Студент', null, concepts[0][1],
          [['Номер зачётной книжки', 'Строка', 'pk'], ['ФИО', 'Строка']]],
        ['Дисциплина', null, concepts[1][1],
          [['Код дисциплины', 'Строка', 'pk'], ['Название', 'Строка']]],
        ['Результат аттестации', null, concepts[2][1], [
          ['Код результата', 'Целое число', 'pk'], ['Номер зачётной книжки', 'Строка', '', 'Студент'],
          ['Код дисциплины', 'Строка', '', 'Дисциплина'], ['Номер попытки', 'Положительное целое'],
          ['Дата аттестации', 'Дата'], ['Оценка', 'Целое число от 2 до 5']
        ], { uq: 'UNIQUE(Номер зачётной книжки, Код дисциплины, Номер попытки)' }]
      ], null, kind);
    } else {
      d = build(name, [], [
        ['student', null, concepts[0][1], [['record_book_no', 'varchar(20)', 'pk'], ['full_name', 'text']]],
        ['discipline', null, concepts[1][1], [['discipline_code', 'varchar(20)', 'pk'], ['title', 'text']]],
        ['assessment_result', null, concepts[2][1], [
          ['result_id', 'bigint', 'pk'], ['record_book_no', 'varchar(20)', '', 'student'],
          ['discipline_code', 'varchar(20)', '', 'discipline'], ['attempt_no', 'smallint'],
          ['assessed_on', 'date'], ['grade', 'smallint']
        ], { uq: 'UNIQUE(record_book_no, discipline_code, attempt_no)' }]
      ], null, kind);
      const result = d.tables[2];
      result.columns[3].defaultValue = '1';
      result.columns[4].defaultValue = 'CURRENT_DATE';
      result.definitions = [
        'CHECK (attempt_no >= 1)', 'CHECK (grade BETWEEN 2 AND 5)',
        'CREATE INDEX ix_assessment_discipline ON assessment_result (discipline_code)'
      ];
    }
    Object.assign(d.tables[0], { x: 0, y: 0 });
    if (kind === 'conceptual') {
      const gap = 300;
      Object.assign(d.tables[1], { x: gap, y: 0 });
      d.tables[2].x = Math.round((gap + ERD.tableWidth(d.tables[1], kind) - ERD.tableWidth(d.tables[2], kind)) / 2);
      d.tables[2].y = 180;
    } else {
      Object.assign(d.tables[1], { x: 0, y: 150 });
      const leftWidth = Math.max(ERD.tableWidth(d.tables[0], kind), ERD.tableWidth(d.tables[1], kind));
      Object.assign(d.tables[2], { x: leftWidth + 96, y: 15 });
    }
    return d;
  }

  function network() {
    const ID = ['id', 'bigint', 'pk'], SID = ['id', 'smallint', 'pk'];
    const T = [];
    const t = (name, group, desc, cols, o) => T.push([name, group, desc, cols, o]);

    /* Справочники */
    t('event_type', 'ref', 'Коды событий протокола.', [SID, ['code', 'text', 'uq'], ['description', 'text']]);
    t('auth_method', 'ref', 'Метод аутентификации: password, blank password, pubkey.', [SID, ['code', 'text', 'uq']]);
    t('approval_result', 'ref', 'Результат подтверждения: allowed, denied, timeout, server_unavailable.', [SID, ['code', 'text', 'uq']]);
    t('auth_fail_reason', 'ref', 'Причина неудачного входа: bad_password, password_too_long, unknown_user, wrong_user, bad_signature.', [SID, ['code', 'text', 'uq']]);
    t('severity', 'ref', 'Справочник важности инцидентов.', [SID, ['code', 'text', 'uq']]);
    t('incident_status', 'ref', 'Справочник статусов инцидентов.', [SID, ['code', 'text', 'uq']]);

    /* Инфраструктура */
    t('location', 'infra', 'Где стоит роутер (дом, офис).', [['id', 'int', 'pk'], ['name', 'text']]);
    t('router', 'infra', 'Роутер.', [['id', 'int', 'pk'], ['location_id', 'int', '', 'location'], ['name', 'text', 'uq'], ['is_active', 'bool']]);
    t('router_run', 'infra', 'Запуск агента мониторинга на роутере.', [ID, ['router_id', 'int', '', 'router'], ['version', 'text'], ['started_at', 'tstz']], { uq: 'UNIQUE(router_id, started_at)' });
    t('router_connection', 'infra', 'TCP-сессия роутера с сервером.', [ID, ['run_id', 'bigint', '', 'router_run'], ['remote_ip', 'inet'], ['connected_at', 'tstz'], ['disconnected_at', 'tstz', 'null'], ['reason', 'text', 'null']]);
    t('wireless_network', 'infra', 'Беспроводная сеть (SSID) роутера.', [['id', 'int', 'pk'], ['router_id', 'int', '', 'router'], ['ssid', 'text']], { uq: 'UNIQUE(router_id, ssid)' });
    t('wifi_interface', 'infra', 'Wi-Fi интерфейс роутера (phy0-ap0).', [['id', 'int', 'pk'], ['router_id', 'int', '', 'router'], ['network_id', 'int', '', 'wireless_network'], ['name', 'text']], { uq: 'UNIQUE(router_id, name)' });

    /* Устройства */
    t('person', 'devices', 'Владелец устройств и SSH-ключей.', [['id', 'int', 'pk'], ['name', 'text']]);
    t('device', 'devices', 'Клиентское устройство, идентифицируется MAC-адресом.', [ID, ['mac', 'macaddr', 'uq'], ['owner_id', 'int', 'null', 'person'], ['trust_status', 'text'], ['note', 'text', 'null']]);
    t('device_group', 'devices', 'Группа устройств.', [['id', 'int', 'pk'], ['name', 'text']]);
    t('device_group_member', 'devices', 'Связь M:N: устройство ↔ группа.', [['group_id', 'int', 'pk', 'device_group'], ['device_id', 'bigint', 'pk', 'device']]);
    t('hostname_observation', 'devices', 'История имён устройства.', [ID, ['device_id', 'bigint', '', 'device'], ['hostname', 'text'], ['first_seen', 'tstz'], ['last_seen', 'tstz']]);
    t('ip_observation', 'devices', 'История IP-адресов устройства.', [ID, ['device_id', 'bigint', '', 'device'], ['router_id', 'int', '', 'router'], ['ip', 'inet'], ['first_seen', 'tstz'], ['last_seen', 'tstz']]);

    /* События Wi-Fi и трафик */
    t('raw_event', 'traffic', 'Сырые события протокола. Партиции по месяцам.', [ID, ['run_id', 'bigint', '', 'router_run'], ['event_type_id', 'smallint', '', 'event_type'], ['router_ts', 'tstz'], ['received_at', 'tstz'], ['payload', 'jsonb']], { part: true });
    t('wifi_session', 'traffic', 'Wi-Fi сессия клиента. wifi_connected открывает, wifi_device дописывает имя и IP, wifi_disconnected закрывает. При перезапуске роутера открытые сессии закрываются временем последнего router_stats. Партиции по месяцам.',
      [ID, ['device_id', 'bigint', '', 'device'], ['interface_id', 'int', '', 'wifi_interface'], ['connected_at', 'tstz'], ['disconnected_at', 'tstz', 'null'], ['hostname_observation_id', 'bigint', 'null', 'hostname_observation'], ['ip', 'inet', 'null'], ['signal_dbm', 'int', 'null'], ['waited_ms', 'int', 'null']], { part: true });
    t('traffic_sample', 'traffic', 'Замер трафика роутера, раз в минуту.', [ID, ['router_id', 'int', '', 'router'], ['period_start', 'tstz'], ['period_end', 'tstz'], ['down_bytes', 'bigint'], ['up_bytes', 'bigint']]);
    t('client_traffic', 'traffic', 'Трафик клиента за замер. Партиции по месяцам.', [ID, ['sample_id', 'bigint', '', 'traffic_sample'], ['device_id', 'bigint', 'null', 'device'], ['down_bytes', 'bigint'], ['up_bytes', 'bigint'], ['down_packets', 'bigint'], ['up_packets', 'bigint']], { part: true });
    t('client_traffic_ip', 'traffic', 'Какие адреса дали трафик.', [['client_traffic_id', 'bigint', 'pk', 'client_traffic'], ['ip', 'inet', 'pk']]);
    t('router_metric', 'traffic', 'Метрики роутера.', [ID, ['router_id', 'int', '', 'router'], ['at', 'tstz'], ['uptime', 'interval'], ['load1', 'real'], ['load5', 'real'], ['load15', 'real'], ['mem_total_kb', 'bigint'], ['mem_available_kb', 'bigint']]);
    t('interface_load', 'traffic', 'Нагрузка на интерфейс (число станций).', [['metric_id', 'bigint', 'pk', 'router_metric'], ['interface_id', 'int', 'pk', 'wifi_interface'], ['stations', 'int']]);

    /* SSH */
    t('ssh_account', 'ssh', 'Учётная запись на роутере.', [['id', 'int', 'pk'], ['router_id', 'int', '', 'router'], ['username', 'text']], { uq: 'UNIQUE(router_id, username)' });
    t('ssh_key', 'ssh', 'Публичный SSH-ключ.', [['id', 'int', 'pk'], ['fingerprint', 'text', 'uq'], ['key_type', 'text'], ['person_id', 'int', 'null', 'person'], ['label', 'text', 'null']]);
    t('ssh_session', 'ssh', 'SSH-сессия на роутере.', [ID, ['run_id', 'bigint', '', 'router_run'], ['session_no', 'int'], ['pid', 'int'], ['account_id', 'int', '', 'ssh_account'], ['client_ip', 'inet'], ['client_port', 'int'], ['auth_method_id', 'smallint', '', 'auth_method'], ['key_id', 'int', 'null', 'ssh_key'], ['started_at', 'tstz'], ['ended_at', 'tstz', 'null'], ['end_reason', 'text', 'null']], { uq: 'UNIQUE(run_id, session_no)' });
    t('ssh_approval', 'ssh', 'Подтверждение входа: решение человека или правила.', [ID, ['session_id', 'bigint', 'uq', 'ssh_session'], ['requested_at', 'tstz'], ['decided_at', 'tstz', 'null'], ['result_id', 'smallint', '', 'approval_result'], ['decided_by_user', 'int', 'null', 'app_user'], ['decided_by_rule', 'int', 'null', 'approval_rule'], ['reason', 'text', 'null'], ['killed', 'bool']]);
    t('ssh_auth_failure', 'ssh', 'Неудачная попытка входа.', [ID, ['router_id', 'int', '', 'router'], ['account_id', 'int', 'null', 'ssh_account'], ['client_ip', 'inet'], ['client_port', 'int'], ['reason_id', 'smallint', '', 'auth_fail_reason'], ['pid', 'int'], ['at', 'tstz']]);
    t('ip_ban', 'ssh', 'Бан IP-адреса.', [ID, ['ip', 'inet'], ['router_id', 'int', 'null', 'router'], ['from', 'tstz'], ['until', 'tstz', 'null'], ['reason', 'text', 'null'], ['created_by_rule', 'int', 'null', 'approval_rule']]);

    /* Правила */
    t('approval_rule', 'rules', 'Правило автоподтверждения. router_id = NULL — для всех роутеров. Условия вынесены в отдельные типизированные таблицы (нормализация).', [['id', 'int', 'pk'], ['name', 'text'], ['priority', 'int'], ['action', 'text'], ['router_id', 'int', 'null', 'router'], ['time_from', 'time', 'null'], ['time_to', 'time', 'null'], ['enabled', 'bool']]);
    t('rule_subnet', 'rules', 'Подсети, к которым применяется правило.', [ID, ['rule_id', 'int', '', 'approval_rule'], ['net', 'cidr']]);
    t('rule_account', 'rules', 'Учётные записи, к которым применяется правило.', [ID, ['rule_id', 'int', '', 'approval_rule'], ['username', 'text']]);
    t('rule_key', 'rules', 'SSH-ключи, к которым применяется правило.', [ID, ['rule_id', 'int', '', 'approval_rule'], ['key_id', 'int', '', 'ssh_key']]);

    /* Инциденты и пользователи */
    t('alert_rule', 'incidents', 'Правило генерации инцидентов.', [['id', 'int', 'pk'], ['event_type_id', 'smallint', '', 'event_type'], ['severity_id', 'smallint', '', 'severity'], ['threshold', 'int'], ['window', 'interval'], ['enabled', 'bool']]);
    t('incident', 'incidents', 'Инцидент.', [ID, ['alert_rule_id', 'int', '', 'alert_rule'], ['status_id', 'smallint', '', 'incident_status'], ['router_id', 'int', '', 'router'], ['device_id', 'bigint', 'null', 'device'], ['ssh_session_id', 'bigint', 'null', 'ssh_session'], ['assignee_id', 'int', 'null', 'app_user'], ['opened_at', 'tstz'], ['closed_at', 'tstz', 'null']]);
    t('incident_comment', 'incidents', 'Комментарий к инциденту.', [ID, ['incident_id', 'bigint', '', 'incident'], ['user_id', 'int', '', 'app_user'], ['text', 'text'], ['created_at', 'tstz']]);
    t('notification_channel', 'incidents', 'Канал уведомлений пользователя.', [['id', 'int', 'pk'], ['user_id', 'int', '', 'app_user'], ['kind', 'text'], ['address', 'text']]);
    t('notification', 'incidents', 'Журнал отправленных уведомлений.', [ID, ['channel_id', 'int', '', 'notification_channel'], ['incident_id', 'bigint', 'null', 'incident'], ['sent_at', 'tstz'], ['status', 'text']]);
    t('app_user', 'users', 'Пользователь веб-интерфейса.', [['id', 'int', 'pk'], ['login', 'text', 'uq'], ['password_hash', 'text'], ['role_id', 'smallint', '', 'role']]);
    t('role', 'users', 'Роль пользователя.', [SID, ['name', 'text', 'uq']]);
    t('user_router_access', 'users', 'Какие роутеры видит пользователь. Связь M:N.', [['user_id', 'int', 'pk', 'app_user'], ['router_id', 'int', 'pk', 'router']]);

    return build('Пример: мониторинг сети', [
      ['ref', 'Справочники', '#6f7f9c', '#8395b6'],
      ['infra', 'Инфраструктура', '#2f7dd1', '#4a97ec'],
      ['devices', 'Устройства', '#1f9d7a', '#35b895'],
      ['traffic', 'События Wi-Fi и трафик', '#d98a1c', '#eba33a'],
      ['ssh', 'SSH', '#d0473f', '#ee6a61'],
      ['rules', 'Правила автоподтверждения', '#8a5cd6', '#a683ef'],
      ['incidents', 'Инциденты', '#c2497d', '#e0679c'],
      ['users', 'Пользователи', '#5f8f2f', '#82b552']
    ], T, {
      /* раскладка эталона */
      rows: [['infra', 'devices', 'ref'], ['traffic', 'ssh'], ['rules', 'incidents', 'users']],
      ncols: { infra: 2, devices: 2, ref: 2, traffic: 3, ssh: 2, rules: 2, incidents: 2, users: 1 },
      grid: 0 /* без сетки — координаты один в один как в эталоне */
    });
  }

  return { network, university };
})();
