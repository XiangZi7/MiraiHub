/**
 * 数据库 / Redis 连接失败的错误归类与排查文案。
 *
 * 纯函数，不依赖 Vue 与 i18n：返回的 title / explain / tips 都是中文 i18n key，
 * 由组件负责翻译与插值。正则按“先具体后宽泛”的顺序排列，命中即返回。
 */
import type { AppErrorKind } from '@/types/ssh'
import type { DatabaseConnectionKind } from '@/types/database'

export type ConnectionErrorCategory =
  | 'auth'
  | 'permission'
  | 'database-missing'
  | 'ssh-tunnel'
  | 'tls'
  | 'dns'
  | 'refused'
  | 'timeout'
  | 'unreachable'
  | 'disconnected'
  | 'config'
  | 'unknown'

export type ConnectionErrorField =
  'host' | 'port' | 'user' | 'database' | 'tunnel' | 'ssl'

export interface ConnectionErrorContext {
  engine?: DatabaseConnectionKind
  viaTunnel?: boolean
}

export interface ConnectionErrorInfo {
  category: ConnectionErrorCategory
  /** 1045 (28000) / 28P01 / WRONGPASS / os error 10061，取不到为空串 */
  code: string
  /** 信息条中需要高亮的字段 */
  field: ConnectionErrorField | null
  /** 从“超时（10s）”解析出的秒数 */
  timeoutSecs: number | null
}

export interface ConnectionErrorTip {
  key: string
  when?: { engine?: DatabaseConnectionKind[]; tunnel?: boolean }
}

export interface ConnectionErrorCopy {
  /** 完整字面量 'lucide:…'，离线图标打包按字面量扫描 */
  icon: string
  /** i18n key（中文） */
  title: string
  /** i18n key，可含 {user}/{host}/{port}/{database}/{secs}/{via} */
  explain: string
  /** explain 所需插值缺失时使用的 i18n key */
  explainFallback: string
  tips: ConnectionErrorTip[]
}

const SQL_SERVERS: DatabaseConnectionKind[] = ['mysql', 'postgresql']
const NETWORK_ENGINES: DatabaseConnectionKind[] = [
  'mysql',
  'postgresql',
  'redis',
]

/** 各分类的图标、标题、解释与建议（sqlite / redis 的 database-missing 变体由 connectionErrorCopy 选择） */
export const CONNECTION_ERROR_COPY: Record<
  ConnectionErrorCategory,
  ConnectionErrorCopy
> = {
  auth: {
    icon: 'lucide:key-round',
    title: '认证失败',
    explain: '服务器拒绝了 {user} 的登录凭据。',
    explainFallback: '服务器拒绝了登录凭据。',
    tips: [
      { key: '重新输入密码，注意大小写和首尾空格' },
      {
        // vue-i18n 中裸 @ 是链接语法，key 与译文都写成 {'@'}，渲染为 @
        key: "确认该用户允许从当前来源地址登录（MySQL 的 'user'{'@'}'host'、PostgreSQL 的 pg_hba.conf）",
        when: { engine: SQL_SERVERS },
      },
      {
        key: 'Redis 6 及以上启用 ACL 时，需要同时填写用户名',
        when: { engine: ['redis'] },
      },
      {
        key: '经 SSH 隧道时，数据库看到的来源地址是跳板机',
        when: { tunnel: true },
      },
    ],
  },
  permission: {
    icon: 'lucide:shield-ban',
    title: '权限不足',
    explain: '这个账号或来源地址没有被授予访问权限。',
    explainFallback: '这个账号或来源地址没有被授予访问权限。',
    tips: [
      {
        key: '请管理员为该账号授予此库的访问权限（CONNECT / USAGE / GRANT）',
        when: { engine: NETWORK_ENGINES },
      },
      {
        key: 'PostgreSQL：检查 pg_hba.conf 是否放行当前来源地址',
        when: { engine: ['postgresql'] },
      },
      {
        key: "MySQL：检查是否存在 'user'{'@'}'当前主机' 的授权",
        when: { engine: ['mysql'] },
      },
      {
        key: 'Redis：确认 ACL 规则允许 SELECT、PING 等基础命令',
        when: { engine: ['redis'] },
      },
      {
        key: '确认当前系统用户对数据库文件及其所在目录有读写权限',
        when: { engine: ['sqlite'] },
      },
    ],
  },
  'database-missing': {
    icon: 'lucide:database-search',
    title: '数据库不存在',
    explain: '服务器上找不到 {database}。',
    explainFallback: '服务器上找不到指定的数据库。',
    tips: [
      {
        key: '核对库名拼写和大小写（PostgreSQL 区分大小写）',
        when: { engine: SQL_SERVERS },
      },
      {
        key: '把默认库留空或改成已存在的库，连上后再切换',
        when: { engine: SQL_SERVERS },
      },
      {
        key: '确认文件路径正确，且文件没有被移动或删除',
        when: { engine: ['sqlite'] },
      },
      {
        key: '把数据库编号改为 0 到 databases - 1 之间',
        when: { engine: ['redis'] },
      },
    ],
  },
  'ssh-tunnel': {
    icon: 'lucide:waypoints',
    title: 'SSH 隧道建立失败',
    explain: '连接在到达数据库之前，停在了 SSH 跳板 {via}。',
    explainFallback: '连接在到达数据库之前，停在了 SSH 跳板。',
    tips: [
      { key: '单独打开这条 SSH 连接，确认可以正常登录' },
      { key: '确认跳板机允许端口转发（sshd 的 AllowTcpForwarding）' },
      { key: '数据库主机要填写从跳板机能访问到的地址，例如 127.0.0.1' },
    ],
  },
  tls: {
    icon: 'lucide:shield-alert',
    title: 'SSL/TLS 握手失败',
    explain: '加密连接没能建立，通常是证书或 SSL 模式不匹配。',
    explainFallback: '加密连接没能建立，通常是证书或 SSL 模式不匹配。',
    tips: [
      {
        key: '服务器没有开启 SSL 时，把 SSL 模式改为 Disable 或 Prefer',
        when: { engine: SQL_SERVERS },
      },
      {
        key: '使用自签名证书时，选择 CA 证书，或改用 Require（不校验证书）',
        when: { engine: SQL_SERVERS },
      },
      { key: 'Verify Full 要求主机名与证书一致，请用证书上的域名连接' },
      {
        key: 'Redis 的 TLS 只支持 Disable 和 Verify Full，客户端证书与私钥需要成对选择',
        when: { engine: ['redis'] },
      },
    ],
  },
  dns: {
    icon: 'lucide:search-x',
    title: '无法解析主机名',
    explain: '找不到 {host} 对应的 IP 地址。',
    explainFallback: '找不到主机名对应的 IP 地址。',
    tips: [
      { key: '检查主机名是否拼写正确' },
      { key: '内网域名需要先接入 VPN，或配置对应的 DNS' },
      { key: '也可以直接填写 IP 地址' },
    ],
  },
  refused: {
    icon: 'lucide:unplug',
    title: '连接被拒绝',
    explain: '{host} 可以到达，但端口 {port} 上没有服务在监听。',
    explainFallback: '主机可以到达，但目标端口上没有服务在监听。',
    tips: [
      { key: '确认数据库服务已经启动' },
      { key: '核对端口号（MySQL 默认 3306、PostgreSQL 5432、Redis 6379）' },
      {
        key: '服务只监听 127.0.0.1 时，请改用 SSH 隧道连接',
        when: { tunnel: false },
      },
      {
        key: '隧道模式下，主机应填写跳板机视角的地址，例如 127.0.0.1',
        when: { tunnel: true },
      },
    ],
  },
  timeout: {
    icon: 'lucide:timer-off',
    title: '连接超时',
    explain: '{secs} 秒内没有收到服务器响应，数据包可能被防火墙静默丢弃。',
    explainFallback: '长时间没有收到服务器响应，数据包可能被防火墙静默丢弃。',
    tips: [
      { key: '检查安全组或防火墙是否放行端口 {port}' },
      { key: '确认服务监听在外部地址上，而不是只监听 127.0.0.1' },
      { key: '网络较慢时，可以在设置中调大数据库连接超时' },
    ],
  },
  unreachable: {
    icon: 'lucide:route-off',
    title: '主机不可达',
    explain: '网络无法到达 {host}，请求没有送到数据库服务。',
    explainFallback: '网络无法到达目标主机，请求没有送到数据库服务。',
    tips: [
      { key: '确认主机地址正确、机器在线' },
      { key: '检查 VPN、代理或内网是否已经接入' },
      {
        key: '目标在内网时，可以为连接启用 SSH 隧道',
        when: { tunnel: false },
      },
    ],
  },
  disconnected: {
    icon: 'lucide:unplug',
    title: '连接已中断',
    explain: '连接被服务器或网络中途关闭。',
    explainFallback: '连接被服务器或网络中途关闭。',
    tips: [
      { key: '直接重新连接通常就能恢复' },
      { key: '检查服务器是否重启过，或已经达到最大连接数' },
      { key: '空闲连接可能被防火墙或 NAT 回收，可以缩短保活间隔' },
    ],
  },
  config: {
    icon: 'lucide:circle-help',
    title: '连接配置无效',
    explain: '有字段缺失或填写不合法，连接还没有发出。',
    explainFallback: '有字段缺失或填写不合法，连接还没有发出。',
    tips: [
      { key: '打开“编辑连接”，检查主机、端口和证书文件' },
      { key: '客户端证书和私钥需要成对选择' },
    ],
  },
  unknown: {
    icon: 'lucide:circle-help',
    title: '连接失败',
    explain: '没能识别具体原因，原始错误在下方。',
    explainFallback: '没能识别具体原因，原始错误在下方。',
    tips: [
      { key: '先重试一次，排除偶发的网络抖动' },
      { key: '用命令行客户端连接同一地址，对比结果' },
      { key: '复制原始错误交给 AI 诊断，或搜索错误码' },
    ],
  },
}

/** database-missing 在 SQLite（文件）与 Redis（库编号）下的专用文案 */
const DATABASE_MISSING_VARIANTS: Partial<
  Record<DatabaseConnectionKind, Pick<ConnectionErrorCopy, 'icon' | 'title' | 'explain' | 'explainFallback'>>
> = {
  sqlite: {
    icon: 'lucide:file-x',
    title: '无法打开数据库文件',
    explain: '文件不存在，或当前用户没有读写权限。',
    explainFallback: '文件不存在，或当前用户没有读写权限。',
  },
  redis: {
    icon: 'lucide:database-search',
    title: '数据库编号无效',
    explain: '编号 {database} 超出了服务器的 databases 配置。',
    explainFallback: '数据库编号超出了服务器的 databases 配置。',
  },
}

/** 归类规则：顺序即优先级，隧道放首位（其原文常含 timeout/refused），权限先于认证（28000 两者共用） */
const RULES: {
  category: ConnectionErrorCategory
  pattern: RegExp
  kind?: AppErrorKind
  field: (message: string) => ConnectionErrorField | null
}[] = [
  {
    category: 'ssh-tunnel',
    pattern: /^SSH 隧道失败|经 SSH 连接数据库超时|隧道使用的 SSH 连接不存在|ssh tunnel/i,
    field: () => 'tunnel',
  },
  {
    category: 'permission',
    pattern:
      /\b(1044|1142|1130|42501)\b|pg_hba\.conf|permission denied|\bNOPERM\b|not allowed to connect|insufficient privilege/i,
    field: message =>
      /pg_hba|\b1130\b|not allowed to connect/i.test(message) ? 'host' : 'user',
  },
  {
    category: 'auth',
    kind: 'auth',
    pattern:
      /\b(1045|28P01|28000)\b|\bWRONGPASS\b|\bNOAUTH\b|password authentication failed|access denied for user|authentication failed|invalid username-password|role ".+" does not exist|认证失败|密码错误/i,
    field: () => 'user',
  },
  {
    category: 'database-missing',
    pattern:
      /\b(1049|3D000)\b|unknown database|database ".+" does not exist|unable to open database file|\(code: 14\)|db index is out of range|invalid db index|no such file/i,
    field: () => 'database',
  },
  {
    category: 'tls',
    pattern: /\b(tls|ssl|x509)\b|certificate|handshake|unknownissuer|证书/i,
    field: () => 'ssl',
  },
  {
    category: 'dns',
    pattern:
      /failed to lookup address|name or service not known|nodename nor servname|no such host is known|不知道这样的主机|name resolution|dns error|getaddrinfo|os error 1100[14]\b/i,
    field: () => 'host',
  },
  {
    category: 'refused',
    pattern:
      /connection refused|actively refused|积极拒绝|ECONNREFUSED|os error (10061|111)\b/i,
    field: () => 'port',
  },
  {
    category: 'timeout',
    pattern: /超时|timed? ?out|timeout|ETIMEDOUT|没有正确答复|os error (10060|110)\b/i,
    field: () => 'host',
  },
  {
    category: 'unreachable',
    pattern:
      /no route to host|(network|host) is unreachable|EHOSTUNREACH|ENETUNREACH|无法访问的(主机|网络)|os error (10065|10051|113|101)\b/i,
    field: () => 'host',
  },
  {
    category: 'disconnected',
    pattern:
      /connection reset|broken pipe|unexpected eof|end of file|会话.*(不存在|已断开)|连接已断开|too many connections|max number of clients|os error (10054|10053|104|32)\b/i,
    field: () => null,
  },
  {
    category: 'config',
    kind: 'invalidInput',
    pattern: /参数不合法|invalid .*(host|port)|请填写/i,
    field: () => 'host',
  },
]

/** 文本都没命中时按后端 AppErrorKind 兜底 */
const KIND_FALLBACK: Partial<Record<AppErrorKind, ConnectionErrorCategory>> = {
  auth: 'auth',
  notFound: 'database-missing',
  network: 'unreachable',
}

const CATEGORY_FIELD: Record<ConnectionErrorCategory, ConnectionErrorField | null> = {
  auth: 'user',
  permission: 'user',
  'database-missing': 'database',
  'ssh-tunnel': 'tunnel',
  tls: 'ssl',
  dns: 'host',
  refused: 'port',
  timeout: 'host',
  unreachable: 'host',
  disconnected: null,
  config: 'host',
  unknown: null,
}

const CODE_PATTERNS = [
  /\b(\d{4}) \(([0-9A-Z]{5})\)/,
  /\b(28P01|28000|3D000|42501)\b/,
  /\b(WRONGPASS|NOAUTH|NOPERM)\b/,
  /os error (\d+)/,
]

/** 提取用于徽标与复制的错误码，按固定优先级取第一个匹配 */
function extractCode(message: string): string {
  for (const pattern of CODE_PATTERNS) {
    const match = message.match(pattern)
    if (match) return match[0]
  }
  return ''
}

/** 按错误文本与可选的 AppErrorKind 归类连接错误；按规则顺序命中第一条 */
export function classifyConnectionError(
  message: string,
  kind: AppErrorKind | '' = '',
  _context: ConnectionErrorContext = {}
): ConnectionErrorInfo {
  const text = message.trim()
  const secs = text.match(/[（(](\d+)\s*s[)）]/)
  const base = {
    code: extractCode(text),
    timeoutSecs: secs ? Number(secs[1]) : null,
  }
  for (const rule of RULES) {
    if ((rule.kind && rule.kind === kind) || rule.pattern.test(text))
      return { ...base, category: rule.category, field: rule.field(text) }
  }
  const category = (kind && KIND_FALLBACK[kind]) || 'unknown'
  return { ...base, category, field: CATEGORY_FIELD[category] }
}

/** 取分类文案，处理 sqlite / redis 的 database-missing 变体 */
export function connectionErrorCopy(
  category: ConnectionErrorCategory,
  context: ConnectionErrorContext = {}
): ConnectionErrorCopy {
  const copy = CONNECTION_ERROR_COPY[category]
  const variant =
    category === 'database-missing' && context.engine
      ? DATABASE_MISSING_VARIANTS[context.engine]
      : undefined
  return variant ? { ...copy, ...variant } : copy
}

/** 按引擎与是否走隧道筛选建议，最多返回 limit 条 i18n key */
export function connectionErrorTips(
  category: ConnectionErrorCategory,
  context: ConnectionErrorContext = {},
  limit = 3
): string[] {
  return CONNECTION_ERROR_COPY[category].tips
    .filter(({ when }) => {
      if (!when) return true
      if (when.engine && context.engine && !when.engine.includes(context.engine))
        return false
      if (when.tunnel !== undefined && when.tunnel !== Boolean(context.viaTunnel))
        return false
      return true
    })
    .slice(0, limit)
    .map(tip => tip.key)
}

/** 发送给 AI 前把主机、用户名、库名、跳板主机替换为占位符；字面量替换，长的先换避免互相截断 */
export function redactConnectionError(
  message: string,
  secrets: { host?: string; user?: string; database?: string; sshHost?: string }
): string {
  const pairs: [string, string][] = []
  for (const [secret, placeholder] of [
    [secrets.sshHost, '<ssh-host>'],
    [secrets.host, '<host>'],
    [secrets.user, '<user>'],
    [secrets.database, '<database>'],
  ] as const)
    if (secret?.trim()) pairs.push([secret, placeholder])
  pairs.sort((a, b) => b[0].length - a[0].length)
  return pairs.reduce(
    (text, [secret, placeholder]) => text.split(secret).join(placeholder),
    message
  )
}

/** 主机类型：回环 / 私网 IP / 公网 IP / 域名 / 文件（SQLite），供 AI 诊断代替真实主机 */
export function hostKind(
  host: string,
  engine?: DatabaseConnectionKind
): 'loopback' | 'private-ip' | 'public-ip' | 'hostname' | 'file' {
  if (engine === 'sqlite') return 'file'
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (value === 'localhost' || value === '::1' || /^127\./.test(value))
    return 'loopback'
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    )
      return 'private-ip'
    return 'public-ip'
  }
  if (value.includes(':'))
    return /^f[cd]|^fe80/.test(value) ? 'private-ip' : 'public-ip'
  return 'hostname'
}
