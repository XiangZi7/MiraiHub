import type { SshKeyKind } from '@/types/ssh'

/** 算法 → 徽章文案与配色。ed25519 是当下推荐，给主强调色；ecdsa 偏历史遗留，给弱色 */
export const SSH_KEY_KIND_META: Record<SshKeyKind, { label: string, tone: string }> = {
  ed25519: { label: 'ED25519', tone: 'text-accent' },
  rsa: { label: 'RSA', tone: 'text-blue' },
  ecdsa: { label: 'ECDSA', tone: 'text-txt-3' },
}

/** 生成密钥时可选的算法。ed25519 排首位并作为默认 —— 更短、更快、更安全 */
export const SSH_KEY_KIND_OPTIONS: { value: SshKeyKind, label: string, hint: string }[] = [
  { value: 'ed25519', label: 'ED25519', hint: '推荐，短且快' },
  { value: 'rsa', label: 'RSA', hint: '兼容性最好' },
  { value: 'ecdsa', label: 'ECDSA', hint: '较少使用' },
]

/** RSA 可选位数。2048 是当前的安全下限，4096 为默认 */
export const RSA_BITS_OPTIONS = [2048, 3072, 4096] as const
