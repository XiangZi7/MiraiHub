import { useWorkspaceStore } from '@/stores/workspace'
import { useSettingsStore } from '@/stores/settings'
import { toast } from '@/composables/useToast'
import type { SshSessionStatus } from '@/types/ssh'

export function useWorkspaceStatus() {
  const workspace = useWorkspaceStore()
  const settings = useSettingsStore().values
  return (id: string, status: SshSessionStatus, sessionId: string): void => {
    const tab = workspace.tabs.find(tab => tab.id === id)
    const previous = tab?.status
    workspace.setStatus(id, status, sessionId)
    if (!settings.notifyConnectionChanges || previous === status) return
    const name = tab?.connection.name ?? '连接'
    if (status === 'connected') toast.success(`${name} 已连接`)
    else if (previous === 'connected' && status === 'disconnected')
      toast.warning(`${name} 已断开`)
  }
}
