import type { SshKey, SshKeyKind } from '@/types'

/** 算法 → 徽章文案与配色。ed25519 是当下推荐，给主强调色；ecdsa 偏历史遗留，给弱色 */
export const SSH_KEY_KIND_META: Record<SshKeyKind, { label: string, tone: string }> = {
  ed25519: { label: 'ED25519', tone: 'text-accent' },
  rsa: { label: 'RSA', tone: 'text-blue' },
  ecdsa: { label: 'ECDSA', tone: 'text-txt-3' },
}

/** 密钥列表。示例数据，接入 ~/.ssh 扫描后替换 */
export const SSH_KEYS: SshKey[] = [
  {
    id: 'k-default',
    label: 'id_ed25519',
    kind: 'ed25519',
    bits: 256,
    fingerprint: 'SHA256:Xr7pQ9vK2mNbT4wLz8sYcH1jD5gF3aRuE6oViP0nZqk',
    publicKey:
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIH8kL2pQ7vRz1mXbYcW9fD3sTn5oJgKqVhE0uPaBr6Zx xiangzi@miraihub',
    encrypted: true,
    createdAt: '2024-01-18',
    lastUsed: '2 minutes ago',
    hosts: ['Production Server', 'API Server', 'Worker Server'],
  },
  {
    id: 'k-deploy',
    label: 'deploy_rsa',
    kind: 'rsa',
    bits: 4096,
    fingerprint: 'SHA256:9dLmC4tXbW7yQ2fNsK8hVgJ1pR6uZaE3oT5iYcB0nQw',
    publicKey:
      'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC7vN2mK9qXbYcW9fD3sTn5oJgKqVhE0uPaBr6Zx'
      + 'H1jD5gF3aRuE6oViP0nZqkXr7pQ9vK2mNbT4wLz8sYcM6eB2tJ4hN8sQ1wZ5xR3uY7bV0aD deploy@ci',
    encrypted: false,
    createdAt: '2023-11-02',
    lastUsed: 'Yesterday 18:30',
    hosts: ['Database Server'],
  },
  {
    id: 'k-github',
    label: 'github_ed25519',
    kind: 'ed25519',
    bits: 256,
    fingerprint: 'SHA256:T4wLz8sYcH1jD5gF3aRuE6oViP0nZqkXr7pQ9vK2mNb',
    publicKey:
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM6eB2tJ4hN8sQ1wZ5xR3uY7bV0aDgK9pLcXfTnWqEsY xiangzi@github',
    encrypted: true,
    createdAt: '2023-08-27',
    lastUsed: 'Today 09:12',
    hosts: ['github.com'],
  },
  {
    id: 'k-legacy',
    label: 'legacy_ecdsa',
    kind: 'ecdsa',
    bits: 521,
    fingerprint: 'SHA256:0nZqkXr7pQ9vK2mNbT4wLz8sYcH1jD5gF3aRuE6oViP',
    publicKey:
      'ecdsa-sha2-nistp521 AAAAE2VjZHNhLXNoYTItbmlzdHA1MjEAAAAIbmlzdHA1MjEAAACFBAGpQ7vRz1mXb'
      + 'YcW9fD3sTn5oJgKqVhE0uPaBr6ZxH1jD5gF3aRuE6oViP0nZqk ops@legacy',
    encrypted: true,
    createdAt: '2022-06-14',
    lastUsed: '3 months ago',
    hosts: [],
  },
]
