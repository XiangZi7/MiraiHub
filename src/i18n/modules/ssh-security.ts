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
}
