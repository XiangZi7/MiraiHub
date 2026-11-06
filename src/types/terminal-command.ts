export interface TerminalCommand {
  id: string
  name: string
  command: string
  folder?: string
  tags?: string[]
  description?: string
}
