import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
await load('src/i18n/index.ts')
const {
  buildAlterTableSql,
  parseStoredType,
  normalizeDataTypeLabel,
} = await load('src/utils/database-ddl.ts')

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
  assert.deepEqual(
    parseStoredType('int(10) unsigned zerofill', 'mysql'),
    { base: 'int', length: '10', unsigned: true }
  )
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
      { name: 'PRIMARY', columns: ['id'], unique: true, primary: true, subPart: null },
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
      draftColumn({ primaryKey: false, nullable: true }),
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
  assert.match(
    sql,
    /COMMENT ON COLUMN "app"\."users"\."name" IS ''/u
  )
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
  const addSql = buildAlterTableSql({ kind: 'postgresql', current: restored, draft: addIdentity })
  assert.match(addSql, /ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY/u)
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
  assert.ok(sql.trim().endsWith('RENAME TABLE `app`.`users` TO `app`.`members`'))

  const pgSql = buildAlterTableSql({ kind: 'postgresql', current, draft })
  assert.ok(pgSql.trim().endsWith('ALTER TABLE "app"."users" RENAME TO "members"'))

  const schemaMove = { ...draft, name: 'users', schema: 'archive' }
  const mysqlMove = buildAlterTableSql({ kind: 'mysql', current, draft: schemaMove })
  assert.ok(
    mysqlMove.trim().endsWith('RENAME TABLE `app`.`users` TO `archive`.`users`')
  )
  const pgMove = buildAlterTableSql({ kind: 'postgresql', current, draft: schemaMove })
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
        column: 'order_id',
        referencedSchema: 'app',
        referencedTable: 'orders',
        referencedColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
    ],
  }
  const unchangedSql = buildAlterTableSql({ kind: 'mysql', current, draft: unchanged })
  assert.doesNotMatch(unchangedSql, /fk_order/u)
  assert.doesNotMatch(unchangedSql, /fk_multi/u)

  const changed = {
    ...unchanged,
    foreignKeys: [
      {
        id: 'f1',
        name: 'fk_order',
        column: 'order_id',
        referencedSchema: 'app',
        referencedTable: 'orders',
        referencedColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
    ],
  }
  const changedSql = buildAlterTableSql({ kind: 'mysql', current, draft: changed })
  assert.match(changedSql, /DROP FOREIGN KEY `fk_order`/u)
  assert.match(
    changedSql,
    /ADD CONSTRAINT `fk_order` FOREIGN KEY \(`order_id`\) REFERENCES `app`\.`orders` \(`id`\) ON DELETE CASCADE ON UPDATE CASCADE/u
  )
})
