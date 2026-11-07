/** 数据库连接安全与 SSH 隧道文案。中文原文即消息 ID。 */
export const en: Record<string, string> = {
  '隧道使用的 SSH 连接不存在，请重新选择':
    'The SSH connection used by this tunnel no longer exists. Please choose another.',
  '请选择 SSH 连接': 'Select an SSH connection',
  '请填写 SSH 主机和用户名': 'Enter the SSH host and username',
  '请选择 SSH 私钥文件': 'Select an SSH private key file',
  开发环境: 'Development',
  测试环境: 'Testing',
  生产环境: 'Production',
  环境: 'Environment',
  只读: 'Read-only',
  只读连接: 'Read-only connection',
  '拒绝所有写入语句，并在数据库会话层启用只读':
    'Rejects all write statements and enables read-only mode on the database session',
  'SSH 隧道': 'SSH Tunnel',
  '通过 SSH 隧道连接': 'Connect through an SSH tunnel',
  '连接断开后自动重连，关闭数据库会话时释放隧道':
    'Reconnects automatically after a drop and is released when the database session closes',
  'SSH 服务器': 'SSH server',
  '使用已保存的 SSH 连接': 'Use a saved SSH connection',
  手动填写: 'Enter manually',
  'SSH 连接': 'SSH connection',
  'SSH 主机': 'SSH host',
  'SSH 用户名': 'SSH username',
  认证方式: 'Authentication',
  密码: 'Password',
  私钥: 'Private key',
  'SSH 密码': 'SSH password',
  'SSH 私钥文件': 'SSH private key file',
  选择或输入私钥文件路径: 'Select or enter the private key file path',
  '选择 SSH 私钥文件': 'Select SSH private key file',
  '私钥口令（可选）': 'Key passphrase (optional)',
  确认生产环境操作: 'Confirm production operation',
  '此操作风险较高。请输入 {name} 以继续。':
    'This operation is high risk. Type {name} to continue.',
  确认文本: 'Confirmation text',
  确认执行: 'Confirm and run',
}
