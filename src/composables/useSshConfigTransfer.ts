import { computed, reactive, watch, type MaybeRefOrGetter, toValue } from 'vue'
import { open, save } from '@tauri-apps/plugin-dialog'
import * as connections from '@/api/connections'
import * as operations from '@/api/operations'
import { useSettings } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import { isSshConnection } from '@/types/connection'
import type {
  SshConfigTransferItem,
  SshConfigTransferPreview,
} from '@/types/ssh-config-transfer'
import {
  createConnectionBackup,
  parseConnectionBackup,
  restorePlan,
  type ConnectionSnapshot,
} from '@/utils/connection-backup'

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length
}

export function useSshConfigTransfer(opened: MaybeRefOrGetter<boolean>) {
  const { settings } = useSettings()
  const state = reactive({
    snapshot: null as ConnectionSnapshot | null,
    loading: false,
    error: '',
    exportBasicOnly: true,
    exportPassword: '',
    selectedExportIds: [] as string[],
    importPath: '',
    importPassword: '',
    importPreview: null as SshConfigTransferPreview | null,
    selectedImportIds: [] as string[],
    importCredentials: false,
    importStartupCommands: false,
  })

  const exportItems = computed<SshConfigTransferItem[]>(() =>
    (state.snapshot?.connections ?? []).flatMap(connection => {
      if (!isSshConnection(connection)) return []
      return [
        {
          id: connection.id,
          name: connection.name,
          host: connection.host,
          port: connection.port,
          username: connection.username,
          group: connection.group,
          authType: connection.settings.auth.type,
          hasCredentials:
            connection.settings.auth.type === 'password'
              ? Boolean(connection.settings.auth.password)
              : connection.settings.auth.type === 'privateKey'
                ? Boolean(
                    connection.settings.auth.path ||
                    connection.settings.auth.passphrase
                  )
                : false,
        },
      ]
    })
  )
  const canImportCredentials = computed(() => settings.rememberPasswords)

  async function loadSnapshot(): Promise<void> {
    state.loading = true
    state.error = ''
    try {
      state.snapshot = await connections.backupSnapshot()
      state.selectedExportIds = exportItems.value.map(item => item.id)
    } catch (error) {
      state.error = operations.errorMessage(error)
    } finally {
      state.loading = false
    }
  }

  watch(
    () => toValue(opened),
    value => {
      if (!value) {
        state.exportPassword = ''
        state.importPassword = ''
        return
      }
      state.error = ''
      state.importPreview = null
      state.selectedImportIds = []
      void loadSnapshot()
    },
    { immediate: true }
  )

  function selectedSnapshot(): ConnectionSnapshot {
    if (!state.snapshot) throw new Error('SSH 配置尚未加载完成')
    const ids = new Set(state.selectedExportIds)
    const selectedConnections = state.snapshot.connections.filter(
      connection => ids.has(connection.id) && isSshConnection(connection)
    )
    const groupNames = new Set(
      selectedConnections.map(connection =>
        connection.group.toLocaleLowerCase()
      )
    )
    const tagNames = new Set(
      selectedConnections.flatMap(connection =>
        connection.tags.map(tag => tag.toLocaleLowerCase())
      )
    )
    return {
      connections: selectedConnections,
      groups: state.snapshot.groups.filter(
        group =>
          group.kind === 'ssh' && groupNames.has(group.name.toLocaleLowerCase())
      ),
      tags: state.snapshot.tags.filter(tag =>
        tagNames.has(tag.name.toLocaleLowerCase())
      ),
    }
  }

  async function exportSelected(): Promise<boolean> {
    if (state.loading) return false
    state.error = ''
    if (!state.selectedExportIds.length) {
      state.error = '请至少选择一个 SSH 配置'
      return false
    }
    if (!state.exportBasicOnly && utf8Length(state.exportPassword) < 10) {
      state.error = '包含密码和私钥时，备份密码至少需要 10 字节'
      return false
    }

    state.loading = true
    try {
      const destination = await save({
        title: '导出 SSH 配置',
        defaultPath: `MiraiHub-ssh-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'MiraiHub SSH 配置', extensions: ['json'] }],
      })
      if (!destination) return false

      const includeCredentials = !state.exportBasicOnly
      const payload = createConnectionBackup(
        selectedSnapshot(),
        includeCredentials
      )
      await operations.writeSshConfigBackup(
        destination,
        payload,
        includeCredentials ? state.exportPassword : '',
        includeCredentials
      )
      state.exportPassword = ''
      toast.success({
        title: 'SSH 配置已导出',
        description: `已导出 ${state.selectedExportIds.length} 条配置到 ${destination}`,
      })
      return true
    } catch (error) {
      state.error = operations.errorMessage(error)
      return false
    } finally {
      state.loading = false
    }
  }

  async function chooseImportFile(): Promise<void> {
    if (state.loading) return
    const path = await open({
      title: '选择 SSH 配置文件',
      directory: false,
      multiple: false,
      filters: [{ name: 'SSH 配置备份', extensions: ['json'] }],
    })
    if (typeof path !== 'string') return
    state.importPath = path
    state.importPreview = null
    state.selectedImportIds = []
    state.error = ''
  }

  async function previewImport(): Promise<void> {
    if (!state.importPath || state.loading) return
    state.loading = true
    state.error = ''
    state.importPreview = null
    try {
      const preview = await operations.previewSshConfigBackup(
        state.importPath,
        state.importPassword
      )
      state.importPreview = preview
      state.selectedImportIds = preview.connections.map(item => item.id)
      state.importCredentials =
        preview.includesCredentials && settings.rememberPasswords
      // 启动命令会在用户下次连接时执行，必须由用户显式选择恢复。
      state.importStartupCommands = false
    } catch (error) {
      state.error = operations.errorMessage(error)
    } finally {
      state.loading = false
    }
  }

  async function importSelected(): Promise<boolean> {
    if (!state.importPreview || state.loading) return false
    state.error = ''
    if (!state.selectedImportIds.length) {
      state.error = '请至少选择一个 SSH 配置'
      return false
    }
    state.loading = true
    try {
      const current = await connections.backupSnapshot()
      const existingIds = new Set(
        current.connections.map(connection => connection.id)
      )
      const importableIds = state.selectedImportIds.filter(
        id => !existingIds.has(id)
      )
      const skipped = state.selectedImportIds.length - importableIds.length
      if (!importableIds.length) {
        state.importPassword = ''
        toast.info('所选 SSH 配置均已存在，未重复导入')
        return true
      }
      const imported = parseConnectionBackup(
        await operations.importSshConfigBackup(
          state.importPath,
          state.importPassword,
          importableIds,
          state.importCredentials && settings.rememberPasswords,
          state.importStartupCommands
        )
      )
      const plan = restorePlan(
        current,
        imported,
        {
          mode: 'skip',
          credentials: state.importCredentials && settings.rememberPasswords,
          startupCommands: state.importStartupCommands,
        },
        () => `conn-${crypto.randomUUID()}`
      )
      connections.applyBackupSnapshot(current, plan.next)
      const added = plan.changes.filter(
        change => change.action === 'add'
      ).length
      const planSkipped = plan.changes.filter(
        change => change.action === 'skip'
      ).length
      state.importPassword = ''
      state.snapshot = plan.next
      toast.success({
        title: 'SSH 配置导入完成',
        description: `新增 ${added} 条，跳过 ${skipped + planSkipped} 条同 ID 配置。不会自动连接服务器。`,
      })
      return true
    } catch (error) {
      state.error = operations.errorMessage(error)
      return false
    } finally {
      state.loading = false
    }
  }

  return {
    state,
    exportItems,
    canImportCredentials,
    exportSelected,
    chooseImportFile,
    previewImport,
    importSelected,
  }
}
