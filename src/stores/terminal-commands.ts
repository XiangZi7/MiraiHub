import { acceptHMRUpdate, defineStore } from 'pinia'
import { onScopeDispose, reactive, toRefs } from 'vue'
import * as api from '@/api/terminal-commands'
import type { TerminalCommand } from '@/types/terminal-command'

export const useTerminalCommandsStore = defineStore('terminal-commands', () => {
  // 响应式状态
  const state = reactive({
    // 按用户保存顺序排列的常用指令
    commands: [] as TerminalCommand[],
    // 读取本地指令时的错误
    error: '',
  })
  function refresh(): void {
    try {
      state.commands = api.list()
      state.error = ''
    } catch (error) {
      state.error = String(error)
    }
  }
  onScopeDispose(api.subscribe(refresh))
  refresh()
  return {
    ...toRefs(state),
    refresh,
    save: api.save,
    remove: api.remove,
    move: api.move,
  }
})
if (import.meta.hot)
  import.meta.hot.accept(
    acceptHMRUpdate(useTerminalCommandsStore, import.meta.hot)
  )
