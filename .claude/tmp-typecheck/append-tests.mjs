
/** 已有 MySQL 分区表：除分区维护操作外与草稿一致，便于只断言分区语句。 */
function partitionedTable(method, partitions) {
  const options = {
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: 'utf8mb4_0900_ai_ci',
    comment: '',
    autoIncrement: null,
  }
  const current = currentDetail({
    columns: [currentColumn()],
    primaryKey: ['id'],
    options,
    partition: {
      method,
      expression: 'id',
      partitions: partitions.map(([name, description]) => ({
        name,
        description,
        rows: 0,
      })),
    },
  })
  const draft = {
    schema: 'app',
    name: 'users',
    comment: '',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: '',
    rowFormat: '',
    autoIncrement: null,
    columns: [draftColumn()],
    indexes: [],
    foreignKeys: [],
    partitionChanges: [],
  }
  return { current, draft }
}

/** 构造一项分区维护操作。 */
function partitionChange(action, partitions = [], items = []) {
  return {
    id: `pc-${action}-${partitions.join('-')}`,
    action,
    partitions,
    items: items.map(([name, value], index) => ({ id: `pi-${index}`, name, value })),
  }
}

test('已有分区表的可维护范围：RANGE / LIST 全部操作，HASH 只能清空，其余只读', () => {
  const range = partitionEditSupport('mysql', {
    method: 'RANGE COLUMNS',
    expression: 'created_at',
    partitions: [{ name: 'p0', description: "'2025-01-01'", rows: 0 }],
  })
  assert.equal(range.family, 'RANGE')
  assert.equal(range.columns, true)
  assert.deepEqual(range.actions, ['add', 'drop', 'truncate', 'reorganize'])
  const hash = partitionEditSupport('mysql', {
    method: 'LINEAR KEY',
    expression: 'id',
    partitions: [{ name: 'p0', description: '', rows: 0 }],
  })
  assert.deepEqual(hash.actions, ['truncate'])
  assert.ok(hash.reason)
  const sub = partitionEditSupport('mysql', {
    method: 'RANGE',
    expression: 'id',
    partitions: [
      { name: 'p0', description: '10', rows: 0 },
      { name: 'p0', description: '10', rows: 0 },
    ],
  })
  assert.deepEqual(sub.actions, [])
  assert.ok(sub.reason)
  assert.deepEqual(partitionEditSupport('mysql', null).actions, [])
  assert.deepEqual(
    partitionEditSupport('postgresql', {
      method: 'RANGE',
      expression: 'id',
      partitions: [{ name: 'p0', description: '10', rows: 0 }],
    }).actions,
    []
  )
})

test('MySQL 已有分区表生成独立的 TRUNCATE / DROP / REORGANIZE / ADD PARTITION 语句', () => {
  const { current, draft } = partitionedTable('RANGE', [
    ['p0', '100'],
    ['p1', '200'],
    ['p2', 'MAXVALUE'],
  ])
  assert.deepEqual(buildAlterTableStatements({ kind: 'mysql', current, draft }), [])
  const statements = buildAlterTableStatements({
    kind: 'mysql',
    current,
    draft: {
      ...draft,
      partitionChanges: [
        partitionChange('reorganize', ['p2'], [
          ['p2', '300'],
          ['p3', 'MAXVALUE'],
        ]),
        partitionChange('truncate', ['p1']),
        partitionChange('drop', ['p0']),
      ],
    },
  })
  assert.deepEqual(statements, [
    'ALTER TABLE `app`.`users` TRUNCATE PARTITION `p1`',
    'ALTER TABLE `app`.`users` DROP PARTITION `p0`',
    'ALTER TABLE `app`.`users` REORGANIZE PARTITION `p2` INTO (\n  PARTITION `p2` VALUES LESS THAN (300),\n  PARTITION `p3` VALUES LESS THAN MAXVALUE\n)',
  ])
  const summary = summarizeTableChanges('mysql', current, {
    ...draft,
    partitionChanges: [
      partitionChange('drop', ['p0']),
      partitionChange('reorganize', ['p2'], [['p2', '300'], ['p3', 'MAXVALUE']]),
    ],
  })
  assert.ok(summary.some(item => item.target === '分区' && item.action === 'remove' && item.name === 'p0'))
  assert.ok(summary.some(item => item.target === '分区' && item.action === 'modify' && /REORGANIZE/u.test(item.detail ?? '')))

  const alter = changes =>
    buildAlterTableStatements({
      kind: 'mysql',
      current,
      draft: { ...draft, partitionChanges: changes },
    })
  // 末尾是 MAXVALUE 时不能追加 RANGE 分区
  assert.throws(() => alter([partitionChange('add', [], [['p9', '900']])]), /MAXVALUE/u)
  // 非相邻分区不能重组
  assert.throws(() =>
    alter([partitionChange('reorganize', ['p0', 'p2'], [['p0', '300']])])
  )
  // 不能删除全部分区
  assert.throws(() => alter([partitionChange('drop', ['p0', 'p1', 'p2'])]))
  // 同一分区不能被多个操作引用
  assert.throws(() =>
    alter([partitionChange('drop', ['p0']), partitionChange('truncate', ['p0'])])
  )
  // 不存在的分区、未选择分区、重复的新分区名与注入取值都会被拦截
  assert.throws(() => alter([partitionChange('truncate', ['nope'])]))
  assert.throws(() => alter([partitionChange('drop', [])]))
  assert.throws(() =>
    alter([partitionChange('reorganize', ['p2'], [['p1', '300']])])
  )
  assert.throws(() =>
    alter([partitionChange('reorganize', ['p2'], [['p3', '1); DROP TABLE users; --']])])
  )
})

test('LIST 分区可追加，HASH 分区只能清空', () => {
  const list = partitionedTable('LIST', [['p0', '1,2']])
  assert.deepEqual(
    buildAlterTableStatements({
      kind: 'mysql',
      current: list.current,
      draft: {
        ...list.draft,
        partitionChanges: [partitionChange('add', [], [['p1', '3, 4']])],
      },
    }),
    ['ALTER TABLE `app`.`users` ADD PARTITION (\n  PARTITION `p1` VALUES IN (3, 4)\n)']
  )
  const hash = partitionedTable('HASH', [['p0', ''], ['p1', '']])
  assert.throws(() =>
    buildAlterTableStatements({
      kind: 'mysql',
      current: hash.current,
      draft: {
        ...hash.draft,
        partitionChanges: [partitionChange('add', [], [['p2', '']])],
      },
    })
  )
  assert.deepEqual(
    buildAlterTableStatements({
      kind: 'mysql',
      current: hash.current,
      draft: {
        ...hash.draft,
        partitionChanges: [partitionChange('truncate', ['p1'])],
      },
    }),
    ['ALTER TABLE `app`.`users` TRUNCATE PARTITION `p1`']
  )
})

const SQLITE_ITEMS_DDL = [
  'CREATE TABLE "items" (id INTEGER PRIMARY KEY AUTOINCREMENT, price REAL, note TEXT DEFAULT \'a, b (c)\', CONSTRAINT chk_price CHECK (price >= 0), CHECK (price < 1000));',
  'CREATE INDEX idx_price ON items(price);',
  'CREATE TRIGGER trg_items AFTER INSERT ON items BEGIN SELECT 1; END;',
].join('\n\n')

/** SQLite 已有表：字段与草稿一致，只改检查约束。 */
function sqliteItems(overrides = {}) {
  const current = currentDetail({
    schema: 'main',
    name: 'items',
    columns: [
      currentColumn({ dataType: 'INTEGER' }),
      currentColumn({ name: 'price', dataType: 'REAL', nullable: true, primaryKey: false, autoIncrement: false, ordinal: 2 }),
      currentColumn({ name: 'note', dataType: 'TEXT', nullable: true, primaryKey: false, autoIncrement: false, defaultValue: "'a, b (c)'", ordinal: 3 }),
    ],
    primaryKey: ['id'],
    ddl: SQLITE_ITEMS_DDL,
    checks: sqliteTableChecks(SQLITE_ITEMS_DDL),
    ...overrides,
  })
  const draft = {
    schema: 'main',
    name: 'items',
    comment: '',
    engine: '',
    charset: '',
    collation: '',
    rowFormat: '',
    autoIncrement: null,
    columns: [
      draftColumn({ originalName: 'id', dataType: 'INTEGER' }),
      draftColumn({ id: 'c2', name: 'price', originalName: 'price', dataType: 'REAL', nullable: true, primaryKey: false, autoIncrement: false }),
      draftColumn({ id: 'c3', name: 'note', originalName: 'note', dataType: 'TEXT', nullable: true, primaryKey: false, autoIncrement: false, defaultValue: "'a, b (c)'" }),
    ],
    indexes: [],
    foreignKeys: [],
    checks: current.checks.map((check, index) => ({ id: `k${index}`, ...check })),
  }
  return { current, draft }
}

test('从 SQLite 建表语句解析表级检查约束，未命名约束按顺序编号', () => {
  assert.deepEqual(sqliteTableChecks(SQLITE_ITEMS_DDL), [
    { name: 'chk_price', expression: 'price >= 0' },
    { name: 'check_1', expression: 'price < 1000' },
  ])
  assert.deepEqual(sqliteTableChecks('CREATE TABLE t (a INT);'), [])
  assert.equal(sqliteTableChecks('CREATE TABLE t AS SELECT 1 AS a;'), undefined)
})

test('SQLite 修改检查约束在同一事务中重建表并原样恢复索引与触发器', () => {
  const { current, draft } = sqliteItems()
  assert.deepEqual(buildAlterTableStatements({ kind: 'sqlite', current, draft }), [])
  const statements = buildAlterTableStatements({
    kind: 'sqlite',
    current,
    draft: {
      ...draft,
      checks: [
        { id: 'k0', name: 'chk_price', expression: 'price > 0' },
        { id: 'k1', name: 'check_1', expression: 'price < 1000' },
      ],
    },
  })
  const sql = statements.join(';\n')
  // 先确认没有其他表的外键引用此表
  assert.match(statements[0], /^-- .*\n-- .*\nCREATE TEMP TABLE temp\."_mh_rebuild_guard"/u)
  assert.match(statements[1], /pragma_foreign_key_list\(m\.name, 'main'\).*f\."table" = 'items' COLLATE NOCASE/u)
  // 未变化的约束和字段原文保留，变化的约束按草稿重新生成
  const create = statements.find(item => /CREATE TABLE "main"\."_mh_rebuild_items"/u.test(item))
  assert.ok(create)
  assert.match(create, /note TEXT DEFAULT 'a, b \(c\)'/u)
  assert.match(create, /CHECK \(price < 1000\)/u)
  assert.match(create, /CONSTRAINT "chk_price" CHECK \(price > 0\)/u)
  assert.doesNotMatch(create, /price >= 0/u)
  assert.ok(statements.includes('INSERT INTO "main"."_mh_rebuild_items" ("id", "price", "note") SELECT "id", "price", "note" FROM "main"."items"'))
  // AUTOINCREMENT 计数器随表迁移
  assert.match(sql, /INSERT INTO "main"\.sqlite_sequence \(name, seq\) SELECT '_mh_rebuild_items', seq/u)
  const drop = statements.findIndex(item => /DROP TABLE "main"\."items"$/u.test(item))
  assert.ok(drop > 0)
  assert.equal(statements[drop + 1], 'ALTER TABLE "main"."_mh_rebuild_items" RENAME TO "items"')
  assert.match(statements[drop + 2], /^-- .*\nCREATE INDEX idx_price ON items\(price\)$/u)
  assert.equal(statements[drop + 3], 'CREATE TRIGGER trg_items AFTER INSERT ON items BEGIN SELECT 1; END')

  // 与其他修改混在一起时要求先单独保存
  assert.throws(() =>
    buildAlterTableStatements({
      kind: 'sqlite',
      current,
      draft: {
        ...draft,
        comment: '',
        columns: [...draft.columns, draftColumn({ id: 'c4', name: 'extra', dataType: 'TEXT', nullable: true, primaryKey: false, autoIncrement: false })],
        checks: [],
      },
    })
  )
  // 自引用外键的表拒绝重建
  const selfReferencing = sqliteItems({
    foreignKeys: [{ name: 'fk_parent', columns: ['price'], referencedSchema: 'main', referencedTable: 'items', referencedColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' }],
  })
  assert.throws(() =>
    buildAlterTableStatements({
      kind: 'sqlite',
      current: selfReferencing.current,
      draft: { ...selfReferencing.draft, checks: [] },
    })
  )
})
