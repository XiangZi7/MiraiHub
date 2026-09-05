import { computed, reactive, toRefs, watch } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { acceptHMRUpdate, defineStore } from 'pinia'
import type { MachineViewId } from '@/types'

export const SIDEBAR_MIN_WIDTH = 184
export const SIDEBAR_MAX_WIDTH = 380
export const MACHINE_MIN_WIDTH = 384
const DEFAULT_SIDEBAR_WIDTH = 224
const DEFAULT_MACHINE_WIDTH = 500

export const useWorkspaceLayoutStore = defineStore('workspace-layout', () => {
  const { width } = useWindowSize()
  const state = reactive({
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    sidebarCollapsed: false,
    machineWidth: DEFAULT_MACHINE_WIDTH,
    machineOpen: true,
    machineView: 'overview' as MachineViewId,
  })
  const machineMaxWidth = computed(() => Math.max(MACHINE_MIN_WIDTH, Math.min(720, width.value - (state.sidebarCollapsed ? 52 : state.sidebarWidth) - 390)))
  watch(machineMaxWidth, max => { state.machineWidth = Math.min(state.machineWidth, max) }, { immediate: true })
  function reset(): void {
    Object.assign(state, { sidebarWidth: DEFAULT_SIDEBAR_WIDTH, sidebarCollapsed: false, machineWidth: Math.min(DEFAULT_MACHINE_WIDTH, machineMaxWidth.value), machineOpen: true })
  }
  return { ...toRefs(state), machineMaxWidth, reset }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useWorkspaceLayoutStore, import.meta.hot))
