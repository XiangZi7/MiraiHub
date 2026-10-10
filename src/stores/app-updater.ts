import { onScopeDispose, reactive } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { emit, emitTo, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { check } from '@tauri-apps/plugin-updater'
import { IS_TAURI } from '@/utils/window'
import {
  createUpdateController,
  initialUpdateState,
  type UpdateState,
} from '@/utils/app-updater'
import { useWorkspaceStore } from './workspace'
import { useSettingsStore } from './settings'
import { useTransfersStore } from './transfers'

const STATE_EVENT = 'miraihub://update-state'
const COMMAND_EVENT = 'miraihub://update-command'
type Command = 'status' | 'check' | 'defer' | 'resume'

export const useAppUpdaterStore = defineStore('app-updater', () => {
  const state = reactive(initialUpdateState())
  // No native update operations until the installation type has been checked.
  state.phase = 'unsupported'
  const settings = useSettingsStore()
  let startup: Promise<void> | undefined
  let disposed = false
  const cleanup: (() => void)[] = []
  const owner = IS_TAURI && getCurrentWindow().label === 'main'
  const broadcast = () => {
    void emit(STATE_EVENT, { ...state }).catch(console.warn)
  }
  const controller = owner
    ? createUpdateController({
        state,
        check: () => check({ timeout: 30_000 }),
        enabled: () => settings.values.autoUpdate,
        canInstall: async () => {
          const idle = () =>
            !useWorkspaceStore().tabs.length &&
            !useTransfersStore().activeTasks.length
          return (
            idle() && (await invoke<boolean>('updater_can_install')) && idle()
          )
        },
        changed: broadcast,
      })
    : undefined

  async function subscribe() {
    if (!IS_TAURI) {
      Object.assign(state, { phase: 'unsupported', reason: 'development' })
      return
    }
    const unlisten = owner
      ? await listen<Command>(COMMAND_EVENT, event => {
          if (event.payload === 'check') void controller?.check()
          else if (event.payload === 'defer') controller?.defer()
          else if (event.payload === 'resume') controller?.resume()
          else if (event.payload === 'status') broadcast()
        })
      : await listen<UpdateState>(STATE_EVENT, event =>
          Object.assign(state, event.payload)
        )
    if (disposed) {
      unlisten()
      return
    }
    cleanup.push(unlisten)
    if (!owner) {
      await emitTo('main', COMMAND_EVENT, 'status')
      return
    }
    const environment = await invoke<{ supported: boolean; reason: string }>(
      'updater_environment'
    )
    if (disposed) return
    if (!environment.supported) {
      Object.assign(state, { phase: 'unsupported', reason: environment.reason })
      broadcast()
      return
    }
    state.phase = 'idle'
    broadcast()
    // Leave startup/restore alone, then check every six hours. Failed checks
    // also use this interval; there is no request storm when GitHub is offline.
    const autoCheck = () => {
      if (settings.values.autoUpdate) void controller?.check()
    }
    const first = setTimeout(autoCheck, 15_000)
    const recurring = setInterval(autoCheck, 6 * 60 * 60 * 1000)
    const install = setInterval(
      () => void controller?.installWhenIdle(),
      10_000
    )
    cleanup.push(() => {
      clearTimeout(first)
      clearInterval(recurring)
      clearInterval(install)
    })
  }
  function start() {
    return (startup ??= subscribe().catch(error => {
      Object.assign(state, { phase: 'error', error: String(error) })
    }))
  }
  async function command(command: Command) {
    await start()
    if (!IS_TAURI) return
    try {
      await emitTo('main', COMMAND_EVENT, command)
    } catch (error) {
      Object.assign(state, { phase: 'error', error: String(error) })
    }
  }
  onScopeDispose(() => {
    disposed = true
    cleanup.forEach(dispose => dispose())
    void controller?.dispose()
  })
  return { state, start, command }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useAppUpdaterStore, import.meta.hot))
