/** ssh-keys-config 相关文案。中文原文即消息 ID，zh-CN 目录自动按 en 的键生成同名条目。 */
export const en: Record<string, string> = {
  // ~/.ssh/config 导入
  '从 ~/.ssh/config 导入': 'Import from ~/.ssh/config',
  '解析 Host、HostName、User、Port、IdentityFile 与 ProxyJump，通配 Host 与 Match 块不会导入。':
    'Reads Host, HostName, User, Port, IdentityFile and ProxyJump. Wildcard Host entries and Match blocks are not imported.',
  '没有找到 ~/.ssh/config 文件': 'No ~/.ssh/config file found',
  '配置文件里没有可导入的 Host': 'The config file has no importable Host entries',
  '已存在：{value0}': 'Already saved: {value0}',
  重新读取: 'Reload',
  '语法错误，已跳过该行': 'Syntax error; line skipped',
  '不支持 Match 块，已跳过': 'Match blocks are not supported and were skipped',
  'Include 嵌套过深': 'Include nesting is too deep',
  'Include 存在循环引用': 'Include contains a circular reference',
  'Include 文件读取失败': 'Could not read Include file',
  '不支持目录通配的 Include': 'Directory wildcards in Include are not supported',
  '主机过多，仅列出前一部分': 'Too many hosts; only the first ones are listed',
  '未配置 User，使用本机用户名': 'No User configured; using the local user name',
  '配置了多个 IdentityFile，仅使用第一个':
    'Multiple IdentityFile entries; only the first is used',
  端口转发设置不会导入: 'Port forwarding settings are not imported',
  '不支持 ProxyCommand，导入后将直连':
    'ProxyCommand is not supported; the connection will be direct',
  'ProxyJump 格式无效': 'Invalid ProxyJump format',
  'ProxyJump 存在循环引用': 'ProxyJump contains a circular reference',
  'ProxyJump 跳板链过长': 'ProxyJump chain is too long',
  'IdentityFile 含不支持的占位符': 'IdentityFile contains unsupported tokens',
  'IdentityFile 不是绝对路径': 'IdentityFile is not an absolute path',
  '端口无效，使用 22': 'Invalid port; using 22',
  私钥文件不存在: 'Private key file not found',
  '已从 ~/.ssh/config 导入 {value0} 条连接':
    'Imported {value0} connections from ~/.ssh/config',
  '未导入 {value0} 条；{value1} 条跳板未能匹配已保存连接，已写入备注。':
    '{value0} not imported. {value1} jump chains did not match saved connections and were written to the description.',
  '未导入 {value0} 条。不会自动连接服务器。':
    '{value0} not imported. Servers are not connected automatically.',
  导入失败: 'Import failed',
  '导入中断，已导入 {value0} 条连接':
    'Import interrupted; {value0} connections were imported',

  // 公钥部署（ssh-copy-id）
  '目标 SSH 连接不存在': 'The target SSH connection does not exist',
  '公钥已存在于“{value0}”': 'Public key already present on "{value0}"',
  '远端 authorized_keys 已包含该公钥，未重复添加。':
    'The remote authorized_keys already contains this key; nothing was added.',
  '公钥已部署到“{value0}”': 'Public key deployed to "{value0}"',
  部署到服务器: 'Deploy to server',
  '将“{value0}”的公钥追加到远端 ~/.ssh/authorized_keys，已存在时不会重复添加。':
    'Append the public key of "{value0}" to the remote ~/.ssh/authorized_keys. Existing entries are not duplicated.',
  '还没有已保存的 SSH 连接': 'No saved SSH connections yet',
  目标服务器: 'Target server',
  '加载中…': 'Loading…',
  '选择 SSH 连接': 'Select an SSH connection',
  '部署中…': 'Deploying…',
  部署: 'Deploy',
}
