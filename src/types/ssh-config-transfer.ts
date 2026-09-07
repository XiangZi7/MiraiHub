export interface SshConfigTransferItem {
  id: string
  name: string
  host: string
  port: number
  username: string
  group: string
  authType: 'password' | 'privateKey' | 'agent'
  hasCredentials: boolean
}

export interface SshConfigTransferPreview {
  sourceFormat: string
  includesCredentials: boolean
  includesStartupCommands: boolean
  connections: SshConfigTransferItem[]
  warnings: string[]
}
