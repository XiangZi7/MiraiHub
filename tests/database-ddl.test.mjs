import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
await load('src/i18n/index.ts')
const {
  buildAlterTableSql,
  buildAlterTableStatements,
  droppableTriggerFunctions,
  buildCreateTableSql,
  buildCreateTableStatements,
  summarizeTableChanges,
  validateTableDraft,
  parseStoredType,
  normalizeDataTypeLabel,
  designerColumnFromStored,
  designerIndexFromStored,
  partitionEditSupport,
  sqliteTableChecks,
} = await load('src/utils/database-ddl.ts')

function optionsDraft(overrides = {}) {
  return {
    schema: 'app',
    name: 'users',
    comment: '',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: 'utf8mb4_bin',
    rowFormat: 'DYNAMIC',
    autoIncrement: '9007199254740993',
    columns: [draftColumn()],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  }
}

test('新建表和修改表完整保留大整数自增值、排序规则与行格式', () => {
  const draft = optionsDraft()
  const created = buildCreateTableSql({ kind: 'mysql', draft })
  assert.match(
    created,
    /COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC AUTO_INCREMENT=9007199254740993/
  )
  const current = currentDetail({
    columns: [currentColumn()],
    primaryKey: ['id'],
    options: {
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collation: 'utf8mb4_general_ci',
      rowFormat: 'Compact',
      comment: '',
      autoIncrement: '12',
    },
  })
  const sql = buildAlterTableSql({ kind: 'mysql', current, draft })
  assert.match(
    sql,
    /COLLATE=utf8mb4_bin, ROW_FORMAT=DYNAMIC, AUTO_INCREMENT=9007199254740993/
  )
  assert.doesNotMatch(sql, /MODIFY COLUMN/)
  current.options = {
    ...current.options,
    ...draft,
    autoIncrement: draft.autoIncrement,
  }
  assert.equal(buildAlterTableSql({ kind: 'mysql', current, draft }), '')
  assert.match(
    buildAlterTableSql({
      kind: 'mysql',
      current,
      draft: { ...draft, collation: '' },
    }),
    /DEFAULT CHARSET=utf8mb4/
  )
})

test('自增值与表选项拒绝无效、越界和注入输入', () => {
  for (const autoIncrement of [
    '0',
    '-1',
    '1.5',
    'abc',
    '1e3',
    '18446744073709551616',
    '1; DROP TABLE x',
  ])
    assert.equal(
      validateTableDraft({
        kind: 'mysql',
        draft: optionsDraft({ autoIncrement }),
      }).valid,
      false
    )
  assert.equal(
    validateTableDraft({
      kind: 'mysql',
      draft: optionsDraft({ autoIncrement: '18446744073709551615' }),
    }).valid,
    true
  )
  assert.equal(
    validateTableDraft({
      kind: 'mysql',
      draft: optionsDraft({ collation: 'latin1_bin' }),
    }).valid,
    false
  )
  assert.equal(
    validateTableDraft({
      kind: 'mysql',
      draft: optionsDraft({ engine: 'InnoDB;DROP' }),
    }).valid,
    false
  )
  assert.equal(
    validateTableDraft({
      kind: 'mysql',
      draft: optionsDraft({ columns: [draftColumn({ autoIncrement: false })] }),
    }).valid,
    false
  )
})

test('PostgreSQL 仅修改 identity 计数器也生成可执行 SQL，serial 不被误操作', () => {
  const current = currentDetail({
    columns: [currentColumn()],
    primaryKey: ['id'],
    options: { comment: '', autoIncrement: null },
  })
  const draft = optionsDraft({ autoIncrement: '100' })
  assert.equal(
    buildAlterTableSql({ kind: 'postgresql', current, draft }),
    'ALTER TABLE "app"."users" ALTER COLUMN "id" RESTART WITH 100'
  )
  assert.match(
    buildCreateTableSql({ kind: 'postgresql', draft }),
    /RESTART WITH 100;/
  )
  current.columns[0].defaultValue = "nextval('app.users_id_seq'::regclass)"
  assert.throws(
    () => buildAlterTableSql({ kind: 'postgresql', current, draft }),
    /ALTER SEQUENCE/
  )
})

function draftColumn(overrides = {}) {
  return {
    id: 'c',
    name: 'id',
    dataType: 'BIGINT',
    length: '',
    nullable: false,
    primaryKey: true,
    unique: false,
    unsigned: false,
    autoIncrement: true,
    defaultValue: '',
    comment: '',
    ...overrides,
  }
}

function currentColumn(overrides = {}) {
  return {
    name: 'id',
    dataType: 'bigint',
    nullable: false,
    defaultValue: null,
    ordinal: 1,
    primaryKey: true,
    autoIncrement: true,
    comment: null,
    ...overrides,
  }
}

function currentDetail(overrides = {}) {
  return {
    schema: 'app',
    name: 'users',
    kind: 'table',
    columns: [],
    indexes: [],
    foreignKeys: [],
    primaryKey: [],
    rowEstimate: null,
    ddl: '',
    options: null,
    ...overrides,
  }
}

test('解析 MySQL 与 PostgreSQL 存储类型并归一别名', () => {
  assert.deepEqual(parseStoredType('bigint(20) unsigned', 'mysql'), {
    base: 'bigint',
    length: '20',
    unsigned: true,
  })
  assert.deepEqual(parseStoredType('varchar(255)', 'mysql'), {
    base: 'varchar',
    length: '255',
    unsigned: false,
  })
  assert.deepEqual(parseStoredType('int', 'mysql'), {
    base: 'int',
    length: '',
    unsigned: false,
  })
  assert.deepEqual(parseStoredType('int(10) unsigned zerofill', 'mysql'), {
    base: 'int',
    length: '10',
    unsigned: true,
  })
  assert.deepEqual(parseStoredType('character varying(255)', 'postgresql'), {
    base: 'varchar',
    length: '255',
    unsigned: false,
  })
  assert.equal(
    normalizeDataTypeLabel('timestamp with time zone', 'postgresql'),
    'TIMESTAMPTZ'
  )
  assert.equal(normalizeDataTypeLabel('integer', 'postgresql'), 'INTEGER')
})

test('无差异时 ALTER 返回空字符串', () => {
  const current = currentDetail({
    columns: [currentColumn()],
    primaryKey: ['id'],
    options: {
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collation: 'utf8mb4_0900_ai_ci',
      comment: '说明',
      autoIncrement: 50,
    },
  })
  const draft = {
    schema: 'app',
    name: 'users',
    comment: '说明',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    autoIncrement: 50,
    columns: [draftColumn()],
    indexes: [],
    foreignKeys: [],
  }
  assert.equal(buildAlterTableSql({ kind: 'mysql', current, draft }), '')
})

test('MySQL 修改自增计数器与表选项生成合并 ALTER', () => {
  const current = currentDetail({
    columns: [currentColumn()],
    primaryKey: ['id'],
    options: {
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collation: 'utf8mb4_0900_ai_ci',
      comment: null,
      autoIncrement: 100,
    },
  })
  const draft = {
    schema: 'app',
    name: 'users',
    comment: '用户表',
    engine: 'MyISAM',
    charset: 'utf8',
    autoIncrement: 1000,
    columns: [draftColumn()],
    indexes: [],
    foreignKeys: [],
  }
  const sql = buildAlterTableSql({ kind: 'mysql', current, draft })
  assert.match(
    sql,
    /ALTER TABLE `app`\.`users` ENGINE=MyISAM, DEFAULT CHARSET=utf8, COMMENT='用户表', AUTO_INCREMENT=1000/u
  )
})

test('MySQL 新增、删除、修改字段', () => {
  const current = currentDetail({
    columns: [
      currentColumn(),
      currentColumn({
        name: 'age',
        dataType: 'int',
        nullable: true,
        defaultValue: '0',
        ordinal: 2,
        primaryKey: false,
        autoIncrement: false,
      }),
      currentColumn({
        name: 'legacy',
        dataType: 'varchar(255)',
        nullable: true,
        ordinal: 3,
        primaryKey: false,
        autoIncrement: false,
      }),
    ],
    primaryKey: ['id'],
  })
  const draft = {
    schema: 'app',
    name: 'users',
    comment: '',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    autoIncrement: null,
    columns: [
      draftColumn(),
      draftColumn({
        id: 'c2',
        name: 'age',
        dataType: 'INT',
        nullable: false,
        primaryKey: false,
        autoIncrement: false,
        defaultValue: '0',
      }),
      draftColumn({
        id: 'c3',
        name: 'email',
        dataType: 'VARCHAR',
        length: '255',
        nullable: false,
        primaryKey: false,
        autoIncrement: false,
      }),
    ],
    indexes: [],
    foreignKeys: [],
  }
  const sql = buildAlterTableSql({ kind: 'mysql', current, draft })
  assert.match(sql, /DROP COLUMN `legacy`/u)
  assert.match(sql, /MODIFY COLUMN `age` INT NOT NULL DEFAULT 0/u)
  assert.match(sql, /ADD COLUMN `email` VARCHAR\(255\) NOT NULL/u)
})

test('MySQL 主键集合变化生成 DROP/ADD PRIMARY KEY', () => {
  const current = currentDetail({
    columns: [
      currentColumn(),
      currentColumn({
        name: 'code',
        dataType: 'varchar(32)',
        nullable: true,
        ordinal: 2,
        primaryKey: false,
        autoIncrement: false,
      }),
    ],
    primaryKey: ['id'],
    indexes: [
      {
        name: 'PRIMARY',
        columns: ['id'],
        unique: true,
        primary: true,
        subPart: null,
      },
    ],
  })
  const draft = {
    schema: 'app',
    name: 'users',
    comment: '',
    engine: '',
    charset: '',
    autoIncrement: null,
    columns: [
      draftColumn({ primaryKey: false, nullable: true, autoIncrement: false }),
      draftColumn({
        id: 'c1',
        name: 'code',
        dataType: 'VARCHAR',
        length: '32',
        nullable: false,
        primaryKey: true,
        autoIncrement: false,
      }),
    ],
    indexes: [],
    foreignKeys: [],
  }
  const sql = buildAlterTableSql({ kind: 'mysql', current, draft })
  assert.match(sql, /DROP PRIMARY KEY/u)
  assert.match(sql, /ADD PRIMARY KEY \(`code`\)/u)
})

test('PostgreSQL 类型与可空差异生成 ALTER COLUMN 语句', () => {
  const current = currentDetail({
    columns: [
      currentColumn(),
      currentColumn({
        name: 'name',
        dataType: 'character varying(255)',
        nullable: true,
        ordinal: 2,
        primaryKey: false,
        autoIncrement: false,
        comment: '用户名',
      }),
    ],
    primaryKey: ['id'],
  })
  const draft = {
    schema: 'app',
    name: 'users',
    comment: '',
    engine: '',
    charset: '',
    autoIncrement: null,
    columns: [
      draftColumn(),
      draftColumn({
        id: 'c1',
        name: 'name',
        dataType: 'VARCHAR',
        length: '500',
        nullable: false,
        primaryKey: false,
        autoIncrement: false,
      }),
    ],
    indexes: [],
    foreignKeys: [],
  }
  const sql = buildAlterTableSql({ kind: 'postgresql', current, draft })
  assert.match(
    sql,
    /ALTER TABLE "app"\."users" ALTER COLUMN "name" TYPE VARCHAR\(500\)/u
  )
  assert.match(
    sql,
    /ALTER TABLE "app"\."users" ALTER COLUMN "name" SET NOT NULL/u
  )
  assert.match(sql, /COMMENT ON COLUMN "app"\."users"\."name" IS ''/u)
})

test('PostgreSQL 自增差异生成 ADD/DROP IDENTITY', () => {
  const current = currentDetail({
    columns: [currentColumn()],
    primaryKey: ['id'],
  })
  const draft = {
    schema: 'app',
    name: 'users',
    comment: '',
    engine: '',
    charset: '',
    autoIncrement: null,
    columns: [draftColumn({ autoIncrement: false })],
    indexes: [],
    foreignKeys: [],
  }
  const sql = buildAlterTableSql({ kind: 'postgresql', current, draft })
  assert.match(sql, /ALTER COLUMN "id" DROP IDENTITY/u)

  const restored = {
    ...current,
    columns: [currentColumn({ autoIncrement: false })],
  }
  const addIdentity = {
    ...draft,
    columns: [draftColumn()],
  }
  const addSql = buildAlterTableSql({
    kind: 'postgresql',
    current: restored,
    draft: addIdentity,
  })
  assert.match(
    addSql,
    /ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY/u
  )
})

test('表改名与换 schema 的语句放在最后', () => {
  const current = currentDetail({
    columns: [currentColumn()],
    primaryKey: ['id'],
  })
  const draft = {
    schema: 'app',
    name: 'members',
    comment: '',
    engine: '',
    charset: '',
    autoIncrement: null,
    columns: [draftColumn()],
    indexes: [],
    foreignKeys: [],
  }
  const sql = buildAlterTableSql({ kind: 'mysql', current, draft })
  assert.ok(
    sql.trim().endsWith('RENAME TABLE `app`.`users` TO `app`.`members`')
  )

  const pgSql = buildAlterTableSql({ kind: 'postgresql', current, draft })
  assert.ok(
    pgSql.trim().endsWith('ALTER TABLE "app"."users" RENAME TO "members"')
  )

  const schemaMove = { ...draft, name: 'users', schema: 'archive' }
  const mysqlMove = buildAlterTableSql({
    kind: 'mysql',
    current,
    draft: schemaMove,
  })
  assert.ok(
    mysqlMove.trim().endsWith('RENAME TABLE `app`.`users` TO `archive`.`users`')
  )
  const pgMove = buildAlterTableSql({
    kind: 'postgresql',
    current,
    draft: schemaMove,
  })
  assert.ok(pgMove.includes('SET SCHEMA "archive"'))
})

test('外键规则变化触发重建，复合外键保持原样', () => {
  const columns = [
    currentColumn({
      name: 'order_id',
      dataType: 'bigint',
      nullable: true,
      ordinal: 2,
      primaryKey: false,
      autoIncrement: false,
    }),
    currentColumn({
      name: 'a',
      dataType: 'int',
      nullable: true,
      ordinal: 3,
      primaryKey: false,
      autoIncrement: false,
    }),
    currentColumn({
      name: 'b',
      dataType: 'int',
      nullable: true,
      ordinal: 4,
      primaryKey: false,
      autoIncrement: false,
    }),
  ]
  const draftColumns = [
    draftColumn(),
    draftColumn({
      id: 'c1',
      name: 'order_id',
      dataType: 'BIGINT',
      nullable: true,
      primaryKey: false,
      autoIncrement: false,
    }),
    draftColumn({
      id: 'c2',
      name: 'a',
      dataType: 'INT',
      nullable: true,
      primaryKey: false,
      autoIncrement: false,
    }),
    draftColumn({
      id: 'c3',
      name: 'b',
      dataType: 'INT',
      nullable: true,
      primaryKey: false,
      autoIncrement: false,
    }),
  ]
  const base = {
    schema: 'app',
    name: 'orders',
    comment: '',
    engine: '',
    charset: '',
    autoIncrement: null,
    indexes: [],
  }
  const current = currentDetail({
    ...base,
    columns,
    primaryKey: ['id'],
    foreignKeys: [
      {
        name: 'fk_order',
        columns: ['order_id'],
        referencedSchema: 'app',
        referencedTable: 'orders',
        referencedColumns: ['id'],
        updateRule: 'CASCADE',
        deleteRule: 'SET NULL',
      },
      {
        name: 'fk_multi',
        columns: ['a', 'b'],
        referencedSchema: 'app',
        referencedTable: 'items',
        referencedColumns: ['x', 'y'],
        updateRule: 'NO ACTION',
        deleteRule: 'CASCADE',
      },
    ],
  })
  const unchanged = {
    ...base,
    columns: draftColumns,
    foreignKeys: [
      {
        id: 'f1',
        name: 'fk_order',
        columns: ['order_id'],
        referencedSchema: 'app',
        referencedTable: 'orders',
        referencedColumns: ['id'],
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      {
        id: 'f2',
        name: 'fk_multi',
        columns: ['a', 'b'],
        referencedSchema: 'app',
        referencedTable: 'items',
        referencedColumns: ['x', 'y'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
    ],
  }
  const unchangedSql = buildAlterTableSql({
    kind: 'mysql',
    current,
    draft: unchanged,
  })
  assert.doesNotMatch(unchangedSql, /fk_order/u)
  assert.doesNotMatch(unchangedSql, /fk_multi/u)

  const changed = {
    ...unchanged,
    foreignKeys: [
      {
        id: 'f1',
        name: 'fk_order',
        columns: ['order_id'],
        referencedSchema: 'app',
        referencedTable: 'orders',
        referencedColumns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      {
        id: 'f2',
        name: 'fk_multi',
        columns: ['a', 'b'],
        referencedSchema: 'app',
        referencedTable: 'items',
        referencedColumns: ['x', 'y'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
    ],
  }
  const changedSql = buildAlterTableSql({
    kind: 'mysql',
    current,
    draft: changed,
  })
  assert.match(changedSql, /DROP FOREIGN KEY `fk_order`/u)
  assert.match(
    changedSql,
    /ADD CONSTRAINT `fk_order` FOREIGN KEY \(`order_id`\) REFERENCES `app`\.`orders` \(`id`\) ON DELETE CASCADE ON UPDATE CASCADE/u
  )
})

test('字段改名生成 CHANGE / RENAME COLUMN 而不是删列重建', () => {
  const current = currentDetail({
    columns: [
      currentColumn(),
      currentColumn({
        name: 'nick',
        dataType: 'varchar(32)',
        nullable: true,
        ordinal: 2,
        primaryKey: false,
        autoIncrement: false,
      }),
    ],
    primaryKey: ['id'],
  })
  const draft = {
    ...optionsDraft({ engine: '', charset: '', collation: '', rowFormat: '' }),
    autoIncrement: null,
    columns: [
      draftColumn(),
      draftColumn({
        id: 'c1',
        originalName: 'nick',
        name: 'nickname',
        dataType: 'VARCHAR',
        length: '32',
        nullable: true,
        primaryKey: false,
        autoIncrement: false,
      }),
    ],
  }
  const mysql = buildAlterTableSql({ kind: 'mysql', current, draft })
  assert.match(mysql, /CHANGE COLUMN `nick` `nickname` VARCHAR\(32\) NULL/u)
  assert.doesNotMatch(mysql, /DROP COLUMN/u)
  const pg = buildAlterTableSql({
    kind: 'postgresql',
    current: currentDetail({
      ...current,
      columns: current.columns.map(column => ({
        ...column,
        dataType:
          column.name === 'nick' ? 'character varying(32)' : 'bigint',
      })),
    }),
    draft,
  })
  assert.match(pg, /RENAME COLUMN "nick" TO "nickname"/u)
  assert.doesNotMatch(pg, /DROP COLUMN/u)
})

test('MySQL 调整字段顺序只移动必要的字段', () => {
  const columns = ['a', 'b', 'c'].map((name, index) =>
    currentColumn({
      name,
      dataType: 'int',
      ordinal: index + 1,
      primaryKey: false,
      autoIncrement: false,
      nullable: true,
    })
  )
  const current = currentDetail({ columns })
  const draftOf = name =>
    draftColumn({
      id: name,
      originalName: name,
      name,
      dataType: 'INT',
      nullable: true,
      primaryKey: false,
      autoIncrement: false,
    })
  const draft = {
    ...optionsDraft({ engine: '', charset: '', collation: '', rowFormat: '' }),
    autoIncrement: null,
    columns: [draftOf('c'), draftOf('a'), draftOf('b')],
  }
  const sql = buildAlterTableSql({ kind: 'mysql', current, draft })
  assert.match(sql, /MODIFY COLUMN `c` INT NULL FIRST/u)
  assert.doesNotMatch(sql, /`a` INT NULL AFTER|`b` INT NULL AFTER/u)

  draft.columns = [
    draftOf('a'),
    draftColumn({
      id: 'n',
      name: 'n',
      dataType: 'INT',
      nullable: true,
      primaryKey: false,
      autoIncrement: false,
    }),
    draftOf('b'),
    draftOf('c'),
  ]
  assert.match(
    buildAlterTableSql({ kind: 'mysql', current, draft }),
    /ADD COLUMN `n` INT NULL AFTER `a`/u
  )
})

test('索引定义变化会重建，前缀、降序、方法与注释都会输出', () => {
  const current = currentDetail({
    columns: [
      currentColumn(),
      currentColumn({
        name: 'title',
        dataType: 'varchar(200)',
        ordinal: 2,
        primaryKey: false,
        autoIncrement: false,
      }),
    ],
    primaryKey: ['id'],
    indexes: [
      {
        name: 'idx_title',
        columns: ['title'],
        unique: false,
        primary: false,
        subPart: null,
        indexType: 'BTREE',
      },
    ],
  })
  const hydrated = designerIndexFromStored(
    current.indexes[0],
    current.columns,
    'mysql',
    'i'
  )
  const draft = {
    ...optionsDraft({ engine: '', charset: '', collation: '', rowFormat: '' }),
    autoIncrement: null,
    columns: current.columns.map((column, index) =>
      designerColumnFromStored(column, 'mysql', current, `c${index}`)
    ),
    indexes: [hydrated],
  }
  assert.equal(buildAlterTableSql({ kind: 'mysql', current, draft }), '')
  draft.indexes = [
    {
      ...hydrated,
      columnOptions: { title: { prefix: '20', descending: true } },
      comment: '标题',
    },
  ]
  const sql = buildAlterTableSql({ kind: 'mysql', current, draft })
  assert.match(sql, /DROP INDEX `idx_title`/u)
  assert.match(
    sql,
    /ADD INDEX `idx_title` \(`title`\(20\) DESC\) USING BTREE COMMENT '标题'/u
  )
})

test('生成列与 ON UPDATE、字符集按 MySQL 语法输出', () => {
  const sql = buildCreateTableSql({
    kind: 'mysql',
    draft: optionsDraft({
      autoIncrement: null,
      columns: [
        draftColumn(),
        draftColumn({
          id: 'g',
          name: 'total',
          dataType: 'DECIMAL',
          length: '10,2',
          primaryKey: false,
          autoIncrement: false,
          nullable: true,
          generatedExpression: 'price * qty',
          generatedStored: true,
        }),
        draftColumn({
          id: 'u',
          name: 'updated_at',
          dataType: 'TIMESTAMP',
          primaryKey: false,
          autoIncrement: false,
          defaultValue: 'CURRENT_TIMESTAMP',
          onUpdateCurrentTimestamp: true,
        }),
        draftColumn({
          id: 's',
          name: 'code',
          dataType: 'VARCHAR',
          length: '8',
          primaryKey: false,
          autoIncrement: false,
          charset: 'ascii',
          collation: 'ascii_bin',
        }),
      ],
    }),
  })
  assert.match(
    sql,
    /`total` DECIMAL\(10,2\) GENERATED ALWAYS AS \(price \* qty\) STORED NULL/u
  )
  assert.match(
    sql,
    /`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP/u
  )
  assert.match(sql, /`code` VARCHAR\(8\) CHARACTER SET ascii COLLATE ascii_bin/u)
})

test('MySQL 字符串默认值回填为字面量，自增非键字段被拦截', () => {
  const column = designerColumnFromStored(
    currentColumn({
      name: 'status',
      dataType: 'varchar(10)',
      defaultValue: "it's",
      primaryKey: false,
      autoIncrement: false,
    }),
    'mysql',
    { options: null, primaryKey: [] },
    's'
  )
  assert.equal(column.defaultValue, "'it''s'")
  const validation = validateTableDraft({
    kind: 'mysql',
    draft: optionsDraft({
      autoIncrement: null,
      columns: [draftColumn({ primaryKey: false })],
    }),
  })
  assert.equal(validation.valid, false)
  assert.ok(validation.columnErrors.c?.length)
})

test('建表输出多列外键、检查约束、触发器与 MySQL 分区', () => {
  const draft = optionsDraft({
    autoIncrement: null,
    columns: [
      draftColumn(),
      draftColumn({ id: 'c2', name: 'a', dataType: 'INT', primaryKey: false, autoIncrement: false, nullable: true }),
      draftColumn({ id: 'c3', name: 'b', dataType: 'INT', primaryKey: false, autoIncrement: false, nullable: true }),
    ],
    foreignKeys: [
      { id: 'f', name: 'fk_ab', columns: ['a', 'b'], referencedSchema: 'app', referencedTable: 'items', referencedColumns: ['x', 'y'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
    ],
    checks: [{ id: 'k', name: 'chk_a', expression: 'a >= 0' }],
    triggers: [{ id: 't', name: 'trg_a', timing: 'BEFORE', events: ['INSERT'], level: 'ROW', body: 'SET NEW.a = 1; SET NEW.b = 2', functionName: '' }],
  })
  const statements = buildCreateTableStatements({ kind: 'mysql', draft })
  assert.match(statements[0], /FOREIGN KEY \(`a`, `b`\) REFERENCES `app`\.`items` \(`x`, `y`\)/u)
  assert.match(statements[0], /CONSTRAINT `chk_a` CHECK \(a >= 0\)/u)
  assert.match(statements[1], /CREATE TRIGGER `trg_a` BEFORE INSERT .* FOR EACH ROW BEGIN/su)
  const mismatch = validateTableDraft({
    kind: 'mysql',
    draft: { ...draft, foreignKeys: [{ ...draft.foreignKeys[0], referencedColumns: ['x'] }] },
  })
  assert.equal(mismatch.valid, false)
  assert.ok(mismatch.foreignKeyErrors.f?.length)

  const partitioned = buildCreateTableSql({
    kind: 'mysql',
    draft: optionsDraft({
      autoIncrement: null,
      partition: { method: 'HASH', expression: 'id', count: '4', items: [] },
    }),
  })
  assert.match(partitioned, /PARTITION BY HASH \(id\) PARTITIONS 4/u)
  const summary = summarizeTableChanges('mysql', null, draft)
  assert.ok(summary.some(item => item.target === '触发器' && item.action === 'add'))
})

test('AI 生成的草稿：带索引与注释的建表输出，及精度、重复索引列、PRIMARY 索引名校验', () => {
  const columns = [
    draftColumn({ comment: '主键', unsigned: true }),
    draftColumn({
      id: 'u',
      name: 'user_id',
      primaryKey: false,
      autoIncrement: false,
      comment: '用户',
    }),
    draftColumn({
      id: 'a',
      name: 'amount',
      dataType: 'DECIMAL',
      length: '10,2',
      primaryKey: false,
      autoIncrement: false,
      comment: '金额',
    }),
  ]
  const index = {
    id: 'i',
    name: 'idx_user_id',
    kind: 'index',
    method: 'btree',
    columns: ['user_id'],
    columnOptions: {},
  }
  const draft = optionsDraft({
    name: 'orders',
    comment: '订单',
    autoIncrement: null,
    columns,
    indexes: [index],
  })
  assert.equal(validateTableDraft({ kind: 'mysql', draft }).valid, true)
  const sql = buildCreateTableSql({ kind: 'mysql', draft })
  assert.match(sql, /`amount` DECIMAL\(10,2\)/u)
  assert.match(sql, /COMMENT '金额'/u)
  assert.match(sql, /KEY `idx_user_id` \(`user_id`\)/u)

  const badScale = optionsDraft({
    autoIncrement: null,
    columns: [columns[0], { ...columns[2], length: '4,6' }],
  })
  assert.equal(validateTableDraft({ kind: 'mysql', draft: badScale }).valid, false)

  const duplicated = optionsDraft({
    autoIncrement: null,
    columns,
    indexes: [{ ...index, columns: ['user_id', 'user_id'] }],
  })
  assert.equal(validateTableDraft({ kind: 'mysql', draft: duplicated }).valid, false)

  const reserved = optionsDraft({
    autoIncrement: null,
    columns,
    indexes: [{ ...index, name: 'PRIMARY' }],
  })
  assert.equal(validateTableDraft({ kind: 'mysql', draft: reserved }).valid, false)
})

test('删除 PostgreSQL 触发器时默认连带删除专属函数，可按勾选保留', () => {
  const trigger = {
    name: 'trg_a',
    timing: 'BEFORE',
    events: ['INSERT'],
    level: 'ROW',
    body: '',
    function: 'public.fn_a',
    functionExclusive: true,
  }
  const current = currentDetail({ schema: 'public', triggers: [trigger] })
  const draft = optionsDraft({
    schema: 'public',
    autoIncrement: null,
    engine: '',
    charset: '',
    collation: '',
    rowFormat: '',
    triggers: [],
  })
  const dropped = droppableTriggerFunctions('postgresql', current, draft)
  assert.deepEqual(dropped, [{ trigger: 'trg_a', function: 'public.fn_a' }])
  assert.ok(
    buildAlterTableStatements({ kind: 'postgresql', current, draft }).includes(
      'DROP FUNCTION IF EXISTS public.fn_a()'
    )
  )
  assert.ok(
    !buildAlterTableStatements({
      kind: 'postgresql',
      current,
      draft: { ...draft, keepTriggerFunctions: ['public.fn_a'] },
    }).some(statement => statement.startsWith('DROP FUNCTION'))
  )
  assert.deepEqual(droppableTriggerFunctions('mysql', current, draft), [])
  assert.deepEqual(
    droppableTriggerFunctions(
      'postgresql',
      currentDetail({ triggers: [{ ...trigger, functionExclusive: false }] }),
      draft
    ),
    []
  )
})

function partitionedDetail(method, partitions) {
  return currentDetail({
    columns: [currentColumn()],
    primaryKey: ['id'],
    // 表选项与 optionsDraft 一致，断言里只剩分区语句
    options: {
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collation: 'utf8mb4_bin',
      rowFormat: 'DYNAMIC',
      comment: '',
      autoIncrement: null,
    },
    partition: {
      method,
      expression: 'id',
      partitions: partitions.map(([name, description]) => ({
        name,
        description,
        rows: null,
      })),
    },
  })
}

function partitionDraft(partitionChanges) {
  return optionsDraft({ autoIncrement: null, partitionChanges })
}

test('已有表的分区维护：RANGE / LIST 支持全部操作，HASH 只能清空，其它情况只读', () => {
  const rangeColumns = partitionEditSupport(
    'mysql',
    partitionedDetail('RANGE COLUMNS', [['p0', "'2025-01-01'"]]).partition
  )
  assert.deepEqual(rangeColumns.actions, ['add', 'drop', 'truncate', 'reorganize'])
  assert.equal(rangeColumns.columns, true)
  const hash = partitionEditSupport(
    'mysql',
    partitionedDetail('LINEAR KEY', [['p0', ''], ['p1', '']]).partition
  )
  assert.deepEqual(hash.actions, ['truncate'])
  assert.ok(hash.reason)
  for (const support of [
    partitionEditSupport('postgresql', partitionedDetail('RANGE', [['p0', '1']]).partition),
    partitionEditSupport('mysql', null),
    // 子分区在 information_schema 里每个子分区一行，分区名重复
    partitionEditSupport(
      'mysql',
      partitionedDetail('RANGE', [['p0', '1'], ['p0', '1']]).partition
    ),
  ]) {
    assert.deepEqual(support.actions, [])
    assert.ok(support.reason)
  }
})

test('MySQL 已有分区表生成 TRUNCATE / DROP / REORGANIZE / ADD PARTITION 独立语句', () => {
  const current = partitionedDetail('RANGE', [
    ['p0', '100'],
    ['p1', '200'],
    ['p2', '300'],
    ['p_max', 'MAXVALUE'],
  ])
  const statements = buildAlterTableStatements({
    kind: 'mysql',
    current,
    draft: partitionDraft([
      // 故意乱序：输出固定为 TRUNCATE → DROP → REORGANIZE
      {
        id: 'r',
        action: 'reorganize',
        partitions: ['p_max'],
        items: [
          { id: 'a', name: 'p3', value: '400' },
          { id: 'b', name: 'p_max', value: 'MAXVALUE' },
        ],
      },
      { id: 'd', action: 'drop', partitions: ['p1'], items: [] },
      { id: 't', action: 'truncate', partitions: ['p0'], items: [] },
    ]),
  })
  assert.deepEqual(statements, [
    'ALTER TABLE `app`.`users` TRUNCATE PARTITION `p0`',
    'ALTER TABLE `app`.`users` DROP PARTITION `p1`',
    'ALTER TABLE `app`.`users` REORGANIZE PARTITION `p_max` INTO (\n  PARTITION `p3` VALUES LESS THAN (400),\n  PARTITION `p_max` VALUES LESS THAN MAXVALUE\n)',
  ])
  const summary = summarizeTableChanges(
    'mysql',
    current,
    partitionDraft([{ id: 't', action: 'truncate', partitions: ['p0'], items: [] }])
  )
  assert.ok(summary.length)

  // 末尾不是 MAXVALUE 时可以追加；RANGE COLUMNS 的 MAXVALUE 写在括号里
  assert.deepEqual(
    buildAlterTableStatements({
      kind: 'mysql',
      current: partitionedDetail('RANGE COLUMNS', [['p0', "'2025-01-01'"]]),
      draft: partitionDraft([
        {
          id: 'a',
          action: 'add',
          partitions: [],
          items: [{ id: 'x', name: 'p1', value: 'MAXVALUE' }],
        },
      ]),
    }),
    [
      'ALTER TABLE `app`.`users` ADD PARTITION (\n  PARTITION `p1` VALUES LESS THAN (MAXVALUE)\n)',
    ]
  )
  // LIST 的取值原样放进 IN (...)
  assert.deepEqual(
    buildAlterTableStatements({
      kind: 'mysql',
      current: partitionedDetail('LIST', [['p_a', '1,2']]),
      draft: partitionDraft([
        {
          id: 'a',
          action: 'add',
          partitions: [],
          items: [{ id: 'x', name: 'p_b', value: '3, 4' }],
        },
      ]),
    }),
    ['ALTER TABLE `app`.`users` ADD PARTITION (\n  PARTITION `p_b` VALUES IN (3, 4)\n)']
  )
})

test('MySQL 分区维护拦截不支持或有风险的操作', () => {
  const range = partitionedDetail('RANGE', [
    ['p0', '100'],
    ['p1', '200'],
    ['p_max', 'MAXVALUE'],
  ])
  const run = (current, changes) => () =>
    buildAlterTableStatements({
      kind: 'mysql',
      current,
      draft: partitionDraft(changes),
    })
  const item = (name, value) => [{ id: `i-${name}`, name, value }]
  // 末尾是 MAXVALUE 时不能追加
  assert.throws(
    run(range, [{ id: 'a', action: 'add', partitions: [], items: item('p9', '900') }]),
    /MAXVALUE/u
  )
  // RANGE 只能重组相邻分区
  assert.throws(
    run(range, [
      {
        id: 'r',
        action: 'reorganize',
        partitions: ['p0', 'p_max'],
        items: item('p_all', 'MAXVALUE'),
      },
    ]),
    /adjacent/u
  )
  // 不能删除全部分区
  assert.throws(
    run(range, [
      { id: 'd', action: 'drop', partitions: ['p0', 'p1', 'p_max'], items: [] },
    ]),
    /REMOVE PARTITIONING/u
  )
  // 同一分区被两个操作引用、不存在的分区、空选择、新分区重名、取值注入
  assert.throws(
    run(range, [
      { id: 't', action: 'truncate', partitions: ['p0'], items: [] },
      { id: 'd', action: 'drop', partitions: ['p0'], items: [] },
    ]),
    /more than one/u
  )
  assert.throws(
    run(range, [{ id: 't', action: 'truncate', partitions: ['nope'], items: [] }]),
    /does not exist/u
  )
  assert.throws(
    run(range, [{ id: 't', action: 'truncate', partitions: [], items: [] }]),
    /at least one partition/u
  )
  assert.throws(
    run(range, [
      { id: 'r', action: 'reorganize', partitions: ['p_max'], items: item('p0', 'MAXVALUE') },
    ]),
    /duplicated/u
  )
  assert.throws(
    run(range, [
      {
        id: 'r',
        action: 'reorganize',
        partitions: ['p_max'],
        items: item('p2', '1; DROP TABLE x'),
      },
    ]),
    /invalid value/u
  )
  // HASH / KEY 只能清空分区
  const hash = partitionedDetail('HASH', [['p0', ''], ['p1', '']])
  assert.deepEqual(
    run(hash, [{ id: 't', action: 'truncate', partitions: ['p1'], items: [] }])(),
    ['ALTER TABLE `app`.`users` TRUNCATE PARTITION `p1`']
  )
  assert.throws(
    run(hash, [{ id: 'd', action: 'drop', partitions: ['p1'], items: [] }]),
    /HASH/u
  )
})

const SQLITE_DDL = [
  'CREATE TABLE "orders" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n  "price" REAL CHECK (price < 1000000),\n  "status" INTEGER,\n  CONSTRAINT "chk_price" CHECK (price >= 0),\n  CHECK (status IN (0, 1))\n);',
  'CREATE INDEX "idx_orders_status" ON "orders" ("status");',
  'CREATE TRIGGER "trg_orders" AFTER INSERT ON "orders" BEGIN UPDATE "orders" SET status = 0 WHERE id = NEW.id; END;',
].join('\n\n')

function sqliteCurrent(overrides = {}) {
  return currentDetail({
    schema: 'main',
    name: 'orders',
    columns: [
      currentColumn({ dataType: 'INTEGER' }),
      currentColumn({
        name: 'price',
        dataType: 'REAL',
        nullable: true,
        ordinal: 2,
        primaryKey: false,
        autoIncrement: false,
      }),
      currentColumn({
        name: 'status',
        dataType: 'INTEGER',
        nullable: true,
        ordinal: 3,
        primaryKey: false,
        autoIncrement: false,
      }),
    ],
    primaryKey: ['id'],
    ddl: SQLITE_DDL,
    checks: sqliteTableChecks(SQLITE_DDL),
    ...overrides,
  })
}

function sqliteDraft(checks, overrides = {}) {
  const plain = { nullable: true, primaryKey: false, autoIncrement: false }
  return optionsDraft({
    schema: 'main',
    name: 'orders',
    engine: '',
    charset: '',
    collation: '',
    rowFormat: '',
    autoIncrement: null,
    columns: [
      draftColumn({ dataType: 'INTEGER', originalName: 'id' }),
      draftColumn({ id: 'p', name: 'price', originalName: 'price', dataType: 'REAL', ...plain }),
      draftColumn({ id: 's', name: 'status', originalName: 'status', dataType: 'INTEGER', ...plain }),
    ],
    checks,
    ...overrides,
  })
}

test('SQLite 从建表语句读出表级检查约束，未命名的补 check_N，字段内联 CHECK 不算', () => {
  assert.deepEqual(sqliteTableChecks(SQLITE_DDL), [
    { name: 'chk_price', expression: 'price >= 0' },
    { name: 'check_1', expression: 'status IN (0, 1)' },
  ])
  assert.equal(sqliteTableChecks('CREATE TABLE t AS SELECT 1'), undefined)
})

test('SQLite 修改检查约束在事务内重建表：临时表→复制数据→删旧表→改名→重建索引与触发器', () => {
  const current = sqliteCurrent()
  const unchanged = current.checks.map((check, index) => ({ id: `k${index}`, ...check }))
  assert.deepEqual(
    buildAlterTableStatements({ kind: 'sqlite', current, draft: sqliteDraft(unchanged) }),
    []
  )
  const statements = buildAlterTableStatements({
    kind: 'sqlite',
    current,
    draft: sqliteDraft([
      { id: 'k1', name: 'chk_price', expression: 'price > 0' },
      { id: 'k2', name: 'check_1', expression: 'status IN (0, 1)' },
      { id: 'k3', name: 'chk_status', expression: 'status IS NOT NULL' },
    ]),
  })
  const sql = statements.join(';\n')
  // 守卫：有其它表的外键引用此表时让 CHECK 失败，整个事务回滚
  assert.match(statements[0], /^-- .*\n-- .*\nCREATE TEMP TABLE temp\."_mh_rebuild_guard"/u)
  assert.match(
    statements[1],
    /pragma_foreign_key_list\(m\.name, 'main'\).*f\."table" = 'orders' COLLATE NOCASE/u
  )
  const create = statements.find(statement =>
    statement.includes('CREATE TABLE "main"."_mh_rebuild_orders"')
  )
  assert.ok(create)
  // 未变化的未命名约束与字段内联 CHECK 保留原文，修改与新增的约束追加在末尾
  assert.match(create, /"price" REAL CHECK \(price < 1000000\)/u)
  assert.match(create, /\n {2}CHECK \(status IN \(0, 1\)\)/u)
  assert.doesNotMatch(create, /price >= 0/u)
  assert.match(
    create,
    /CONSTRAINT "chk_price" CHECK \(price > 0\),\n {2}CONSTRAINT "chk_status" CHECK \(status IS NOT NULL\)\n\)$/u
  )
  const order = [
    'INSERT INTO "main"."_mh_rebuild_orders" ("id", "price", "status") SELECT "id", "price", "status" FROM "main"."orders"',
    `INSERT INTO "main".sqlite_sequence (name, seq) SELECT '_mh_rebuild_orders', seq FROM "main".sqlite_sequence WHERE name = 'orders'`,
    'DROP TABLE "main"."orders"',
    // 引用旧表的视图 / 触发器不能让改名失败，只在改名这一步开启 legacy_alter_table
    'PRAGMA legacy_alter_table = ON',
    'ALTER TABLE "main"."_mh_rebuild_orders" RENAME TO "orders"',
    'PRAGMA legacy_alter_table = OFF',
    'CREATE INDEX "idx_orders_status" ON "orders" ("status")',
    'CREATE TRIGGER "trg_orders" AFTER INSERT ON "orders" BEGIN UPDATE "orders" SET status = 0 WHERE id = NEW.id; END',
  ].map(part => sql.indexOf(part))
  assert.ok(order.every(position => position >= 0), String(order))
  assert.deepEqual([...order].sort((left, right) => left - right), order)
  assert.ok(summarizeTableChanges('sqlite', current, sqliteDraft([])).length)

  // 删除约束同样走重建
  const dropped = buildAlterTableStatements({ kind: 'sqlite', current, draft: sqliteDraft([]) })
  const droppedCreate = dropped.find(statement =>
    statement.includes('CREATE TABLE "main"."_mh_rebuild_orders"')
  )
  assert.doesNotMatch(droppedCreate, /CHECK \(status|chk_price/u)
  // 与其它结构修改混在同一次保存里时拒绝
  const mixed = sqliteDraft([])
  mixed.columns.push(
    draftColumn({ id: 'n', name: 'note', dataType: 'TEXT', nullable: true, primaryKey: false, autoIncrement: false })
  )
  assert.throws(
    () => buildAlterTableStatements({ kind: 'sqlite', current, draft: mixed }),
    /separately/u
  )
  // 自引用外键在删旧表时会触发外键动作，直接拒绝
  const foreignKey = {
    name: 'fk_parent',
    columns: ['status'],
    referencedSchema: 'main',
    referencedTable: 'orders',
    referencedColumns: ['id'],
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  }
  assert.throws(
    () =>
      buildAlterTableStatements({
        kind: 'sqlite',
        current: sqliteCurrent({ foreignKeys: [foreignKey] }),
        draft: sqliteDraft([], { foreignKeys: [{ id: 'f', ...foreignKey }] }),
      }),
    /self-referencing/u
  )
})
