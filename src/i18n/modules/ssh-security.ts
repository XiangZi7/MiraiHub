/** ssh-security 相关文案。中文原文即消息 ID，zh-CN 目录自动按 en 的键生成同名条目。 */
export const en: Record<string, string> = {
  身份验证: 'Authentication',
  主机密钥确认失败: 'Failed to confirm the host key',
  提交验证信息失败: 'Failed to submit verification',
  主机密钥已变化: 'Host key has changed',
  验证主机密钥: 'Verify host key',
  '正在连接 {value0}': 'Connecting to {value0}',
  '警告：服务器的主机密钥与之前记录的不一致！':
    'Warning: the server host key does not match the one recorded earlier!',
  '可能有人正在进行中间人攻击，也可能是服务器重装或更换了密钥。除非确认变更来源，否则请取消连接。':
    'Someone may be performing a man-in-the-middle attack, or the server was reinstalled or its key was replaced. Cancel unless you can confirm why it changed.',
  '首次连接该主机，无法确认其身份。请与服务器管理员核对下面的指纹后再继续。':
    'This is the first connection to this host, so its identity cannot be confirmed. Check the fingerprint below with the server administrator before continuing.',
  算法: 'Algorithm',
  新指纹: 'New fingerprint',
  指纹: 'Fingerprint',
  旧指纹: 'Old fingerprint',
  取消: 'Cancel',
  仅本次: 'This time only',
  信任并连接: 'Trust and connect',
  '{value0} 需要进一步验证': '{value0} requires additional verification',
  输入: 'Input',
  '验证中…': 'Verifying…',
  继续: 'Continue',
  '（{value0}）': ' ({value0})',
  连接已断开: 'Disconnected',
  远端关闭连接: 'The remote host closed the connection',
  网络超时: 'Network timeout',
  '网络超时：心跳无响应': 'Network timeout: no keepalive response',
  确认请求已超时或已取消: 'The confirmation request timed out or was canceled',
  验证请求已超时或已取消: 'The verification request timed out or was canceled',
  确认请求已失效: 'The confirmation request is no longer valid',
  没有可显示确认框的窗口: 'No window is available to show the confirmation',
  已取消键盘交互认证: 'Keyboard-interactive authentication was canceled',
  传输已取消: 'Transfer canceled',
  '认证失败：服务器拒绝了 {value0} 方式':
    'Authentication failed: the server rejected the {value0} method',
  '认证失败：{value0}': 'Authentication failed: {value0}',
  '远端关闭连接：{value0}': 'The remote host closed the connection: {value0}',
  '网络错误：{value0}': 'Network error: {value0}',
  '连接异常：{value0}': 'Connection error: {value0}',
  '经代理 {value0} 连接失败：{value1}':
    'Failed to connect through proxy {value0}: {value1}',
  '连接 {value0} 失败：{value1}': 'Failed to connect to {value0}: {value1}',
  '连接 {value0} 超时（{value1}s）': 'Connection to {value0} timed out ({value1}s)',
  '会话 {value0} 不存在或已断开':
    'Session {value0} does not exist or has been disconnected',
  '已拒绝 {value0} 的主机密钥，连接已取消':
    'Rejected the host key of {value0}; the connection was canceled',
  '{value0} 的主机密钥与 known_hosts 记录不一致，已拒绝连接':
    'The host key of {value0} does not match known_hosts; the connection was refused',
  '{value0} 秒内未确认': 'Not confirmed within {value0} seconds',
}
