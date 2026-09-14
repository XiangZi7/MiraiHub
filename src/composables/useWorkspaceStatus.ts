import { i18n } from '@/i18n'
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
    const name = tab?.connection.name ?? i18n.global.t('连接')
    if (status === 'connected')
      toast.success(i18n.global.t('{value0} 已连接', { value0: name }))
    else if (previous === 'connected' && status === 'disconnected')
      toast.warning(i18n.global.t('{value0} 已断开', { value0: name }))
  }
}
