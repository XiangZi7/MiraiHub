/**
 * 数据库 / Redis 连接状态页：错误分类标题、解释、排查建议与页面文案。
 * 中文 key 即中文显示文字；含 @ 的文案写成 {'@'}，避免被 vue-i18n 当作链接语法。
 */
export const en: Record<string, string> = {
  // 页面文案
  '{engine} 连接失败': '{engine} connection failed',
  '第 {n} 次尝试': 'Attempt {n}',
  '正在重新连接…': 'Reconnecting…',
  '正在连接 {name}…': 'Connecting to {name}…',
  '正在连接…': 'Connecting…',
  '{n} 秒': '{n}s',
  '仍在等待服务器响应…': 'Still waiting for the server…',
  '已取消连接。': 'Connection cancelled.',
  已取消连接: 'Connection cancelled',
  可以尝试: 'Things to try',
  原始错误: 'Raw error',
  复制错误信息: 'Copy error details',
  密码未通过验证: "The password wasn't accepted",
  建立连接: 'Connect',
  'AI 诊断': 'AI diagnosis',
  'AI 诊断失败': 'AI diagnosis failed',
  '发送错误信息与脱敏后的连接摘要（不含主机、用户名和密码）':
    'Sends the error and a redacted connection summary (no host, user name or password)',

  // 分类标题（“连接失败”已存在，直接复用）
  认证失败: 'Authentication failed',
  权限不足: 'Access denied',
  数据库不存在: 'Database not found',
  无法打开数据库文件: "Can't open database file",
  数据库编号无效: 'Invalid database index',
  'SSH 隧道建立失败': 'SSH tunnel failed',
  'SSL/TLS 握手失败': 'SSL/TLS handshake failed',
  无法解析主机名: "Can't resolve host name",
  连接被拒绝: 'Connection refused',
  连接超时: 'Connection timed out',
  主机不可达: 'Host unreachable',
  连接已中断: 'Connection lost',
  连接配置无效: 'Invalid connection settings',

  // 分类解释与插值缺失时的回退
  '服务器拒绝了 {user} 的登录凭据。':
    'The server rejected the credentials for {user}.',
  '服务器拒绝了登录凭据。': 'The server rejected the credentials.',
  '这个账号或来源地址没有被授予访问权限。':
    "This account or client address hasn't been granted access.",
  '服务器上找不到 {database}。': "{database} doesn't exist on this server.",
  '服务器上找不到指定的数据库。':
    "The specified database doesn't exist on this server.",
  '文件不存在，或当前用户没有读写权限。':
    "The file is missing, or you don't have read/write access.",
  '编号 {database} 超出了服务器的 databases 配置。':
    "Index {database} exceeds the server's databases setting.",
  '数据库编号超出了服务器的 databases 配置。':
    "The database index exceeds the server's databases setting.",
  '连接在到达数据库之前，停在了 SSH 跳板 {via}。':
    'The connection stopped at the SSH jump host {via} before reaching the database.',
  '连接在到达数据库之前，停在了 SSH 跳板。':
    'The connection stopped at the SSH jump host before reaching the database.',
  '加密连接没能建立，通常是证书或 SSL 模式不匹配。':
    "The encrypted connection couldn't be set up, usually because of a certificate or SSL mode mismatch.",
  '找不到 {host} 对应的 IP 地址。': "Couldn't find an IP address for {host}.",
  '找不到主机名对应的 IP 地址。': "Couldn't find an IP address for the host name.",
  '{host} 可以到达，但端口 {port} 上没有服务在监听。':
    '{host} is reachable, but nothing is listening on port {port}.',
  '主机可以到达，但目标端口上没有服务在监听。':
    'The host is reachable, but nothing is listening on the target port.',
  '{secs} 秒内没有收到服务器响应，数据包可能被防火墙静默丢弃。':
    'No response within {secs}s; packets may be silently dropped by a firewall.',
  '长时间没有收到服务器响应，数据包可能被防火墙静默丢弃。':
    'No response from the server; packets may be silently dropped by a firewall.',
  '网络无法到达 {host}，请求没有送到数据库服务。':
    "The network can't reach {host}; the request never got to the database.",
  '网络无法到达目标主机，请求没有送到数据库服务。':
    "The network can't reach the host; the request never got to the database.",
  '连接被服务器或网络中途关闭。': 'The server or network closed the connection.',
  '有字段缺失或填写不合法，连接还没有发出。':
    'Some settings are missing or invalid, so no connection was attempted.',
  '没能识别具体原因，原始错误在下方。':
    "The cause couldn't be identified. See the raw error below.",

  // 排查建议：auth
  '重新输入密码，注意大小写和首尾空格':
    'Re-enter the password; check letter case and stray spaces',
  "确认该用户允许从当前来源地址登录（MySQL 的 'user'{'@'}'host'、PostgreSQL 的 pg_hba.conf）":
    "Make sure this user may sign in from your address (MySQL 'user'{'@'}'host', PostgreSQL pg_hba.conf)",
  'Redis 6 及以上启用 ACL 时，需要同时填写用户名':
    'With Redis 6+ ACLs, the username is required as well',
  '经 SSH 隧道时，数据库看到的来源地址是跳板机':
    'Through an SSH tunnel, the server sees the jump host as the client',
  // permission
  '请管理员为该账号授予此库的访问权限（CONNECT / USAGE / GRANT）':
    'Ask an admin to grant this account access to the database (CONNECT / USAGE / GRANT)',
  'PostgreSQL：检查 pg_hba.conf 是否放行当前来源地址':
    'PostgreSQL: check that pg_hba.conf allows your client address',
  "MySQL：检查是否存在 'user'{'@'}'当前主机' 的授权":
    "MySQL: check there's a grant for 'user'{'@'}'your host'",
  'Redis：确认 ACL 规则允许 SELECT、PING 等基础命令':
    'Redis: make sure the ACL rules allow basic commands such as SELECT and PING',
  确认当前系统用户对数据库文件及其所在目录有读写权限:
    'Make sure your OS user can read and write the database file and its folder',
  // database-missing
  '核对库名拼写和大小写（PostgreSQL 区分大小写）':
    'Check the database name and its letter case (PostgreSQL is case-sensitive)',
  '把默认库留空或改成已存在的库，连上后再切换':
    'Leave the default database empty or pick an existing one, then switch after connecting',
  '确认文件路径正确，且文件没有被移动或删除':
    "Make sure the file path is correct and the file hasn't been moved or deleted",
  '把数据库编号改为 0 到 databases - 1 之间':
    'Use a database index between 0 and databases - 1',
  // ssh-tunnel
  '单独打开这条 SSH 连接，确认可以正常登录':
    'Open the SSH connection on its own and make sure you can sign in',
  '确认跳板机允许端口转发（sshd 的 AllowTcpForwarding）':
    'Make sure the jump host allows port forwarding (sshd AllowTcpForwarding)',
  '数据库主机要填写从跳板机能访问到的地址，例如 127.0.0.1':
    'Use a database host the jump host can reach, e.g. 127.0.0.1',
  // tls
  '服务器没有开启 SSL 时，把 SSL 模式改为 Disable 或 Prefer':
    "If the server doesn't use SSL, set SSL mode to Disable or Prefer",
  '使用自签名证书时，选择 CA 证书，或改用 Require（不校验证书）':
    'For self-signed certificates, choose the CA certificate or use Require (no verification)',
  'Verify Full 要求主机名与证书一致，请用证书上的域名连接':
    "Verify Full needs the host name to match the certificate; connect using the certificate's domain",
  'Redis 的 TLS 只支持 Disable 和 Verify Full，客户端证书与私钥需要成对选择':
    'Redis TLS supports only Disable and Verify Full; choose the client certificate and key together',
  // dns
  检查主机名是否拼写正确: 'Check the host name for typos',
  '内网域名需要先接入 VPN，或配置对应的 DNS':
    'Internal domains need a VPN or matching DNS first',
  '也可以直接填写 IP 地址': 'You can also use the IP address directly',
  // refused
  确认数据库服务已经启动: 'Make sure the database service is running',
  '核对端口号（MySQL 默认 3306、PostgreSQL 5432、Redis 6379）':
    'Check the port (defaults: MySQL 3306, PostgreSQL 5432, Redis 6379)',
  '服务只监听 127.0.0.1 时，请改用 SSH 隧道连接':
    'If the service only listens on 127.0.0.1, connect through an SSH tunnel',
  '隧道模式下，主机应填写跳板机视角的地址，例如 127.0.0.1':
    'In tunnel mode, use the address as seen from the jump host, e.g. 127.0.0.1',
  // timeout
  '检查安全组或防火墙是否放行端口 {port}':
    'Check that the security group or firewall allows port {port}',
  '确认服务监听在外部地址上，而不是只监听 127.0.0.1':
    'Make sure the service listens on an external address, not only 127.0.0.1',
  '网络较慢时，可以在设置中调大数据库连接超时':
    'On a slow network, increase the database timeout in Settings',
  // unreachable
  '确认主机地址正确、机器在线':
    'Make sure the host address is right and the machine is online',
  '检查 VPN、代理或内网是否已经接入':
    'Check that your VPN, proxy or internal network is connected',
  '目标在内网时，可以为连接启用 SSH 隧道':
    'If the target is on a private network, enable an SSH tunnel for this connection',
  // disconnected
  直接重新连接通常就能恢复: 'Reconnecting usually fixes this',
  '检查服务器是否重启过，或已经达到最大连接数':
    'Check whether the server restarted or hit its connection limit',
  '空闲连接可能被防火墙或 NAT 回收，可以缩短保活间隔':
    'Idle connections may be dropped by a firewall or NAT; try a shorter keepalive',
  // config
  '打开“编辑连接”，检查主机、端口和证书文件':
    'Open Edit connection and check the host, port and certificate files',
  客户端证书和私钥需要成对选择: 'Choose the client certificate and private key together',
  // unknown
  '先重试一次，排除偶发的网络抖动':
    'Try again once to rule out a transient network issue',
  '用命令行客户端连接同一地址，对比结果':
    'Connect to the same address with a command-line client and compare',
  '复制原始错误交给 AI 诊断，或搜索错误码':
    'Copy the raw error for AI diagnosis, or search for the error code',
}
