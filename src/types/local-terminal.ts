import type { LocalShellKind } from './connection'
import type { SshSessionStatus } from './ssh'

export interface LocalTerminalConfig {
  shell: LocalShellKind
  workingDirectory: string
  cols: number
  rows: number
}

export interface LocalTerminalOutputEvent {
  sessionId: string
  data: string
  isStderr: boolean
}

export interface LocalTerminalStatusEvent {
  sessionId: string
  status: SshSessionStatus
  exitCode: number | null
  reason: string | null
}
