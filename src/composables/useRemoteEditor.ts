import { readonly } from 'vue'
import { useRemoteEditorStore } from '@/stores/remote-editor'
export type { RemoteEditRequest } from '@/stores/remote-editor'
export function useRemoteEditor() {
  const store = useRemoteEditorStore()
  return { state: readonly(store.state), open: store.open, close: store.close }
}
