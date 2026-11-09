// README 专用隔离演示：复用当前产品组件，所有 IPC 均使用公开示例数据。
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { createApp, h } from 'vue'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'

mockWindows('main')
const params = new URLSearchParams(location.search)
const view = params.get('view') || 'database'
const theme = params.get('theme') === 'light' ? 'light' : 'dark'
const sql = `-- 每一笔订单，都清晰可见。\nSELECT\n  o.id, c.name AS customer,\n  o.status, o.total, o.created_at\nFROM orders AS o\nJOIN customers AS c ON c.id = o.customer_id\nORDER BY o.created_at DESC\nLIMIT 100;`
const sessions = new Map()
let sequence = 0
let agentRun
const calls = []
const terminalOutputs = []

// 为表结构、ER 图与结果表提供一致的示例字段。
function column(name, dataType, comment, primaryKey = false) {
  return {
    name,
    dataType,
    comment,
    primaryKey,
    nullable: !primaryKey,
    autoIncrement: primaryKey,
    defaultValue: null,
    ordinal: 1,
  }
}
const tables = {
  customers: [
    column('id', 'bigint', '客户编号', true),
    column('name', 'varchar(80)', '客户名称'),
    column('email', 'varchar(160)', '联系邮箱'),
    column('created_at', 'datetime', '创建时间'),
  ],
  orders: [
    column('id', 'bigint', '订单编号', true),
    column('customer_id', 'bigint', '客户编号'),
    column('status', 'varchar(24)', '订单状态'),
    column('total', 'decimal(10,2)', '订单金额'),
    column('created_at', 'datetime', '下单时间'),
  ],
  order_items: [
    column('id', 'bigint', '明细编号', true),
    column('order_id', 'bigint', '订单编号'),
    column('product_id', 'bigint', '产品编号'),
    column('quantity', 'int', '数量'),
    column('price', 'decimal(10,2)', '单价'),
  ],
  products: [
    column('id', 'bigint', '产品编号', true),
    column('name', 'varchar(120)', '产品名称'),
    column('price', 'decimal(10,2)', '产品价格'),
    column('stock', 'int', '库存数量'),
  ],
}
const comments = {
  customers: '客户',
  orders: '订单',
  order_items: '订单明细',
  products: '产品',
}
const names = [
  '林晨',
  '陈一',
  '许知远',
  '周宁',
  '苏夏',
  '叶青',
  '江舟',
  '沈星',
  '陈一',
  '林晨',
  '叶青',
  '苏夏',
]
const rows = names.map((name, i) => [
  String(1024 - i),
  name,
  ['completed', 'paid', 'processing'][i % 3],
  ['329.00', '1299.00', '580.00', '199.00'][i % 4],
  `2026-11-09 ${String(14 - Math.floor(i / 3)).padStart(2, '0')}:${String(58 - i * 3).padStart(2, '0')}:00`,
])
const resultColumns = ['id', 'customer', 'status', 'total', 'created_at'].map(
  (name, i) => ({
    name,
    dataType: ['BIGINT', 'VARCHAR', 'VARCHAR', 'DECIMAL', 'DATETIME'][i],
  })
)

// 生成带外键的结构信息，供真实 ER 图和设计器加载。
function detail(name, schema = 'studio') {
  const foreignKeys = []
  const references =
    name === 'orders'
      ? [['customer_id', 'customers']]
      : name === 'order_items'
        ? [
            ['order_id', 'orders'],
            ['product_id', 'products'],
          ]
        : []
  for (const [field, target] of references)
    foreignKeys.push({
      name: `fk_${name}_${field}`,
      columns: [field],
      referencedSchema: schema,
      referencedTable: target,
      referencedColumns: ['id'],
      updateRule: 'CASCADE',
      deleteRule: 'RESTRICT',
    })
  return {
    schema,
    name,
    kind: 'table',
    columns: tables[name] || tables.orders,
    indexes: [
      {
        name: 'PRIMARY',
        columns: ['id'],
        unique: true,
        primary: true,
        subPart: null,
        indexType: 'BTREE',
      },
    ],
    foreignKeys,
    primaryKey: ['id'],
    rowEstimate: 128,
    checks: [],
    triggers: [],
    ddl: `CREATE TABLE ${name} (id BIGINT PRIMARY KEY);`,
    options: {
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci',
      comment: comments[name],
      rowFormat: 'Dynamic',
      autoIncrement: '1025',
    },
  }
}

// 只创建本地 mock 会话，不建立任何网络连接。
function session(database = 'studio') {
  const sessionId = `readme-${++sequence}`
  sessions.set(sessionId, database)
  return {
    sessionId,
    database,
    kind: 'mysql',
    endpoint: 'db.example.com:3306',
    serverVersion: '8.4.0',
    environment: 'development',
    readOnly: false,
  }
}
const files = [
  ['config', true, 0],
  ['public', true, 0],
  ['src', true, 0],
  ['docker-compose.yml', false, 1842],
  ['nginx.conf', false, 2430],
  ['package.json', false, 1320],
  ['README.md', false, 4200],
  ['server.log', false, 245760],
]
// 本地与远端浏览器共享文件名，便于展示双栏同步。
function listing(root, local = false) {
  return {
    path: root,
    parent: local ? 'D:/Demo' : '/srv',
    entries: files.map(([name, directory, size], i) => ({
      name,
      path: `${root}/${name}`,
      directory,
      kind: directory ? 'directory' : 'file',
      size,
      modifiedAt: 1794182400000 - i * 3600000,
      permissions: directory ? 'drwxr-xr-x' : '-rw-r--r--',
      owner: 'demo',
      group: 'demo',
      linkTarget: null,
    })),
  }
}
const keys = [
  'cache:homepage',
  'cache:products',
  'queue:emails',
  'session:demo',
  'stats:daily',
  'user:1001',
  'user:1002',
].map(name => ({ id: btoa(name), name }))
const profile = {
  id: 'demo',
  name: '演示模型',
  model: 'demo-model',
  enabled: true,
  hasApiKey: false,
  apiFormat: 'openai',
  baseUrl: 'https://example.invalid/v1',
  limits: {
    maxSteps: 32,
    maxContextKb: 4096,
    maxMessages: 256,
    maxRetries: 2,
    contextWindowTokens: 128000,
    maxOutputTokens: 8192,
  },
}

// 所有原生调用在此返回确定的演示数据；未知业务命令立即报错，避免静默生成假状态。
mockIPC(
  async (command, args = {}) => {
    calls.push(command)
    if (command === 'ai_get_config')
      return { activeId: 'demo', profiles: [profile] }
    if (
      command === 'ai_list_conversations' ||
      command === 'ai_list_mcp_servers'
    )
      return []
    if (command === 'ai_start') {
      agentRun = {
        id: 'demo-run',
        conversationId: 'demo-chat',
        target: '演示服务器',
        model: 'demo-model',
        provider: 'https://example.invalid',
        status: 'running',
        approval: null,
        entries: [{ role: 'user', text: args.prompt }],
      }
      return structuredClone(agentRun)
    }
    if (command === 'ai_step') {
      agentRun.status = 'completed'
      agentRun.entries.push(
        {
          role: 'tool',
          text: '读取服务器状态',
          operation: {
            id: 'demo-tool',
            label: '执行 Shell 命令',
            command: 'systemctl status nginx --no-pager',
            reason: '检查 Web 服务运行状态',
            status: 'completed',
            startedAt: 1794204000000,
            durationMs: 180,
            exitCode: 0,
          },
          detail: JSON.stringify({
            stdout:
              'nginx.service — A high performance web server\nActive: active (running)\nMain PID: 1024 (nginx)',
            exitCode: 0,
          }),
        },
        {
          role: 'assistant',
          text: '服务运行正常。\n\n- **Nginx** 正在运行，配置检查通过。\n- **CPU 与内存** 使用平稳，磁盘空间充足。\n- 建议在下次发布前运行 `nginx -t`，确认配置后再平滑重载。\n\n如需继续，我可以帮你查看访问日志。',
        }
      )
      return structuredClone(agentRun)
    }
    if (
      command === 'ai_cancel' ||
      command === 'ai_forget' ||
      command === 'ai_set_approval_mode'
    )
      return
    if (command === 'ssh_connect') return 'demo-ssh'
    if (command === 'ssh_open_shell') {
      const text =
        '\u001b[38;5;141mMiraiHub\u001b[0m  ·  Demo workspace\r\n\r\n\u001b[32mdemo@web-server\u001b[0m:\u001b[34m/srv/app\u001b[0m $ docker compose ps\r\n\r\nNAME             IMAGE              STATUS          PORTS\r\napp-web          nginx:alpine       Up 12 days      80:80\r\napp-api          node:22-alpine     Up 12 days      3000:3000\r\napp-db           mysql:8.4          Up 12 days      3306:3306\r\napp-cache        redis:7-alpine     Up 12 days      6379:6379\r\n\r\n\u001b[32mdemo@web-server\u001b[0m:\u001b[34m/srv/app\u001b[0m $ nginx -t\r\nnginx: configuration file /etc/nginx/nginx.conf test is successful\r\n\r\n\u001b[32mdemo@web-server\u001b[0m:\u001b[34m/srv/app\u001b[0m $ '
      terminalOutputs.push(() =>
        args.onOutput.onmessage(
          new TextEncoder().encode('\u001b[2J\u001b[H' + text).buffer
        )
      )
      setTimeout(
        () => args.onOutput.onmessage(new TextEncoder().encode(text).buffer),
        1200
      )
      return
    }
    if (command === 'ssh_system_stats')
      return {
        hostname: 'web-server',
        os: 'Ubuntu 24.04 LTS',
        kernel: '6.8.0',
        arch: 'x86_64',
        uptimeSecs: 1036800,
        onlineUsers: 1,
        cpu: {
          usage: 12,
          cores: 8,
          model: 'AMD EPYC',
          load: [0.42, 0.36, 0.28],
        },
        memory: {
          usedKb: 2621440,
          totalKb: 8388608,
          swapTotalKb: 0,
          swapUsedKb: 0,
        },
        disk: { usedKb: 18874368, totalKb: 104857600 },
        network: { rxBytesPerSec: 128000, txBytesPerSec: 64000 },
      }
    if (command === 'ssh_list_directory')
      return listing(args.path || '/srv/app')
    if (command === 'local_list_directory')
      return listing(args.path || 'D:/Demo/app', true)
    if (command === 'db_connect' || command === 'db_fork_session')
      return session(args.database || args.config?.database)
    if (command === 'db_describe_session')
      return {
        ...session(sessions.get(args.sessionId)),
        sessionId: args.sessionId,
      }
    if (command === 'db_list_databases') return ['studio', 'studio_staging']
    if (command === 'db_list_objects')
      return Object.keys(tables).map(name => ({
        schema: 'studio',
        name,
        kind: 'table',
        identity: '',
        rowEstimate: 128,
        comment: comments[name],
        createdAt: null,
        updatedAt: null,
      }))
    if (command === 'db_table_detail') return detail(args.name, args.schema)
    if (command === 'db_describe_object')
      return tables[args.name] || tables.orders
    if (command === 'db_completion_columns')
      return Object.keys(tables).flatMap(name => tables[name].map(c => c.name))
    if (command === 'db_fetch_rows')
      return {
        columns: resultColumns,
        rows,
        offset: 0,
        limit: 100,
        hasMore: false,
        elapsedMs: 3,
        sql: 'SELECT * FROM orders LIMIT 100',
      }
    if (command === 'db_execute')
      return {
        statements: [
          {
            statement: args.sql,
            offset: 0,
            columns: resultColumns,
            rows,
            rowsAffected: 0,
            elapsedMs: 3,
            truncated: false,
            error: null,
            message: '',
          },
        ],
        elapsedMs: 3,
        cancelled: false,
      }
    if (command === 'db_table_option_choices')
      return {
        engines: ['InnoDB'],
        collations: [['utf8mb4_unicode_ci', 'utf8mb4']],
      }
    if (command === 'redis_connect')
      return {
        sessionId: 'demo-redis',
        database: '0',
        endpoint: 'cache.example.com:6379',
      }
    if (command === 'redis_scan') return { cursor: '0', keys }
    if (command === 'redis_inspect')
      return {
        key: keys.find(k => k.id === args.key),
        keyType: 'string',
        ttlMs: 3600000,
        length: 128,
        value: JSON.stringify(
          {
            name: 'MiraiHub',
            theme: 'light',
            language: 'zh-CN',
            features: ['SSH', 'Database', 'AI Agent'],
            enabled: true,
          },
          null,
          2
        ),
        editable: true,
        truncated: false,
      }
    if (command === 'redis_execute')
      return { value: 'PONG', elapsedMs: 1, truncated: false }
    if (command === 'launch_at_startup_enabled') return false
    if (command === 'updater_environment')
      return { enabled: false, channel: 'stable', version: '4.0.3' }
    if (
      command.startsWith('plugin:') ||
      command.startsWith('window_') ||
      [
        'settings_load',
        'load_settings',
        'app_ready',
        'ssh_disconnect',
        'ssh_resize',
        'ssh_write',
        'db_disconnect',
        'redis_disconnect',
        'set_window_material',
        'set_tray_visible',
        'set_minimize_to_tray',
      ].includes(command)
    )
      return null
    throw new Error(`Unhandled README demo command: ${command}`)
  },
  { shouldMockEvents: true }
)

const [
  { i18n },
  { addCollection },
  { default: icons },
  { MIRAI_ICONS },
  { default: databaseIcons },
  { default: WorkspaceLayout },
  { useWorkspaceStore },
  { useConnectionsStore },
  { useSettingsStore },
  { useWorkspaceLayoutStore },
  { DEFAULT_SETTINGS },
  { applySkin },
] = await Promise.all([
  import('@/i18n'),
  import('@iconify/vue'),
  import('virtual:mirai-icons'),
  import('@/constants/icons'),
  import('@/constants/database-icons.json'),
  import('@/layouts/WorkspaceLayout.vue'),
  import('@/stores/workspace'),
  import('@/stores/connections'),
  import('@/stores/settings'),
  import('@/stores/workspace-layout'),
  import('@/types/settings'),
  import('@/utils/skin-runtime'),
])
await import('@/assets/styles/main.css')
addCollection(icons)
addCollection(MIRAI_ICONS)
addCollection(databaseIcons)
i18n.global.locale.value = 'zh-CN'
const { pinia } = await import('@/stores')
const settings = useSettingsStore(pinia)
Object.assign(settings.values, {
  ...DEFAULT_SETTINGS,
  colorMode: theme,
  restoreLastSession: false,
})
applySkin(settings.values, { animate: false })
const workspace = useWorkspaceStore(pinia)
const connections = useConnectionsStore(pinia)
const layout = useWorkspaceLayoutStore(pinia)
layout.machineOpen = view === 'ssh' || view === 'ai'
layout.machineView = view === 'ai' ? 'agent' : 'files'
layout.machineWidth = 520
const ssh = {
  id: 'demo-ssh',
  name: 'Web 服务器',
  kind: 'ssh',
  host: 'web.example.com',
  port: 22,
  username: 'demo',
  group: '演示环境',
  tags: ['DEV'],
  tagColor: 'green',
  createdAt: 1,
  lastUsedAt: 1,
  settings: {
    auth: { type: 'password', password: '' },
    timeoutSecs: 10,
    keepaliveSecs: 30,
    terminalType: 'xterm-256color',
    startupCommand: '',
  },
}
const db = {
  ...ssh,
  id: 'demo-db',
  name: 'Studio · MySQL',
  kind: 'mysql',
  host: 'db.example.com',
  port: 3306,
  settings: {
    database: 'studio',
    password: '',
    ssl: false,
    sslMode: 'disable',
    timeoutSecs: 10,
    environment: 'development',
  },
}
const redis = {
  ...db,
  id: 'demo-redis',
  name: '缓存 · Redis',
  kind: 'redis',
  host: 'cache.example.com',
  port: 6379,
  settings: { database: '0', password: '', ssl: false, sslMode: 'disable' },
}
connections.items.push(
  ssh,
  db,
  {
    ...db,
    id: 'demo-pg',
    kind: 'postgresql',
    name: '分析 · PostgreSQL',
    port: 5432,
  },
  redis,
  {
    ...db,
    id: 'demo-sqlite',
    kind: 'sqlite',
    name: '本地 · SQLite',
    host: '',
    port: 0,
    settings: { ...db.settings, database: 'demo.sqlite' },
  }
)
connections.loaded = true
localStorage.setItem(
  'miraihub.database-query-workspace.v1:demo-db',
  JSON.stringify({
    activeId: 'demo-query',
    tabs: [
      {
        id: 'demo-query',
        label: '订单概览',
        database: 'studio',
        savedQueryId: null,
        sql,
      },
    ],
  })
)
const serverView = ['ssh', 'ai'].includes(view)
if (serverView) workspace.open(ssh)
else if (['database', 'er', 'redis'].includes(view))
  workspace.open(view === 'redis' ? redis : db)

// 独立功能截图仍复用原工作区外壳和原功能组件，不绘制替代 UI。
async function standalone() {
  if (view === 'files') {
    const { default: Files } =
      await import('@/components/workspace/FilesView.vue')
    return {
      render: () =>
        h(
          'div',
          { class: 'pane m-2 flex min-h-0 flex-1 flex-col overflow-hidden' },
          [
            h(
              'div',
              { class: 'border-line border-b px-4 py-3 text-sm font-medium' },
              '文件 · 本地与远端'
            ),
            h(Files, {
              sessionId: 'demo-ssh',
              connectionName: ssh.name,
              dualPane: true,
            }),
          ]
        ),
    }
  }
  if (view === 'monitor') {
    const { default: Monitor } =
      await import('@/components/workspace/ServerOverview.vue')
    return {
      render: () =>
        h(
          'div',
          { class: 'min-h-0 flex-1 overflow-auto p-5' },
          h(Monitor, { sessionId: 'demo-ssh', connection: ssh })
        ),
    }
  }
  const { default: Designer } =
    await import('@/components/workspace/database/DatabaseTableDesigner.vue')
  return {
    render: () =>
      h(
        'div',
        { class: 'pane m-2 flex min-h-0 flex-1 flex-col overflow-hidden' },
        [
          h(
            'div',
            { class: 'border-line border-b px-4 py-3 text-sm font-medium' },
            '表结构 · orders'
          ),
          h(Designer, {
            sessionId: 'demo-db',
            databaseKind: 'mysql',
            schema: 'studio',
            objects: [],
            editTable: { schema: 'studio', name: 'orders' },
          }),
        ]
      ),
  }
}
const extra = ['files', 'monitor', 'designer'].includes(view)
  ? await standalone()
  : { render: () => null }
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    {
      path: '/',
      component: WorkspaceLayout,
      children: [
        {
          path: 'servers/:connectionId?',
          name: 'servers',
          component: { render: () => null },
          meta: { nav: 'servers' },
        },
        {
          path: 'databases/:connectionId?',
          name: 'databases',
          component: { render: () => null },
          meta: { nav: 'databases' },
        },
        { path: 'preview', component: extra, meta: { nav: 'preview' } },
      ],
    },
  ],
})
await router.push(
  serverView
    ? '/servers/demo-ssh'
    : ['database', 'er', 'redis'].includes(view)
      ? `/databases/${view === 'redis' ? 'demo-redis' : 'demo-db'}`
      : '/preview'
)
await router.isReady()
createApp({ render: () => h(RouterView) })
  .use(pinia)
  .use(router)
  .use(i18n)
  .mount('#app')
window.readmePreview = {
  calls,
  view,
  theme,
  replayTerminal: () => terminalOutputs.forEach(write => write()),
}
document.documentElement.dataset.readmeReady = 'true'
