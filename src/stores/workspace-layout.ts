import { computed, reactive, toRefs, watch } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { acceptHMRUpdate, defineStore } from 'pinia'
import type { MachineViewId } from '@/types'

export const SIDEBAR_MIN_WIDTH = 184
export const SIDEBAR_MAX_WIDTH = 380
export const MACHINE_MIN_WIDTH = 384
const DEFAULT_SIDEBAR_WIDTH = 224

export interface MachinePaneLayout {
  width: number
  open: boolean
  view: MachineViewId
}

export const useWorkspaceLayoutStore = defineStore('workspace-layout', () => {
  const { width } = useWindowSize()
  const defaultMachineWidth = Math.min(
    620,
    Math.max(
      MACHINE_MIN_WIDTH,
      (width.value - DEFAULT_SIDEBAR_WIDTH - 20) * 0.42
    )
  )
  const state = reactive({
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    sidebarCollapsed: false,
    machineWidth: defaultMachineWidth,
    machineOpen: true,
    machineView: 'files' as MachineViewId,
    // 当前窗口录屏模式，仅在内存保留
    recording: false,
  })
  // 每个连接独立持有文件/Agent 的宽度、视图和开关，移动分屏时仍绑定原连接。
  const machinePanes = reactive<Record<string, MachinePaneLayout>>(
    Object.create(null)
  )
  function machinePaneFor(id: string): MachinePaneLayout {
    if (!machinePanes[id])
      machinePanes[id] = {
        width: state.machineWidth,
        open: state.machineOpen,
        view: state.machineView,
      }
    return machinePanes[id]!
  }
  function openMachinePane(id: string, view: MachineViewId): void {
    const pane = machinePaneFor(id)
    pane.open = true
    pane.view = view
  }
  function removeMachinePane(id: string): void {
    delete machinePanes[id]
  }

  const machineMaxWidth = computed(() =>
    Math.max(
      MACHINE_MIN_WIDTH,
      Math.min(
        720,
        width.value - (state.sidebarCollapsed ? 52 : state.sidebarWidth) - 390
      )
    )
  )
  watch(
    machineMaxWidth,
    max => {
      state.machineWidth = Math.min(state.machineWidth, max)
    },
    { immediate: true }
  )
  function reset(): void {
    Object.assign(state, {
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      sidebarCollapsed: false,
      machineWidth: Math.min(defaultMachineWidth, machineMaxWidth.value),
      machineOpen: true,
      machineView: 'files',
    })
    for (const pane of Object.values(machinePanes))
      Object.assign(pane, {
        width: state.machineWidth,
        open: true,
        view: 'files',
      })
  }
  return {
    ...toRefs(state),
    machineMaxWidth,
    machinePanes,
    machinePaneFor,
    openMachinePane,
    removeMachinePane,
    reset,
  }
})

if (import.meta.hot)
  import.meta.hot.accept(
    acceptHMRUpdate(useWorkspaceLayoutStore, import.meta.hot)
  )
