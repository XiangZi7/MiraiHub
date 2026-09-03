import { onScopeDispose, shallowRef } from 'vue'
import * as privateKeysStore from '@/api/private-keys'
import * as ssh from '@/api/ssh'
import type { StoredPrivateKey } from '@/types/private-key'
import { IS_TAURI } from '@/utils/window'

/** 多窗口共享的私钥路径注册表。 */
export function usePrivateKeys() {
  const initial = privateKeysStore.getSnapshot()
  const keys = shallowRef<StoredPrivateKey[]>(initial.keys)
  const defaultPath = shallowRef(initial.defaultPath)
  const loading = shallowRef(false)
  const error = shallowRef('')

  function reload(): void {
    const snapshot = privateKeysStore.getSnapshot()
    keys.value = snapshot.keys
    defaultPath.value = snapshot.defaultPath
  }

  const unsubscribe = privateKeysStore.subscribe(reload)
  onScopeDispose(unsubscribe)

  function rememberImported(paths: readonly string[]): StoredPrivateKey[] {
    privateKeysStore.rememberImported(paths)
    reload()
    return keys.value.filter(key => paths.includes(key.path))
  }

  function setDefault(path: string): void {
    privateKeysStore.setDefaultPath(path)
    reload()
  }

  function forget(path: string): void {
    privateKeysStore.forget(path)
    reload()
  }

  async function refreshLocalKeys(): Promise<void> {
    if (!IS_TAURI)
      return

    loading.value = true
    error.value = ''

    try {
      privateKeysStore.syncLocalKeys(await ssh.listKeys())
      reload()
    }
    catch (caught) {
      error.value = ssh.errorMessage(caught)
    }
    finally {
      loading.value = false
    }
  }

  return {
    keys,
    defaultPath,
    loading,
    error,
    reload,
    rememberImported,
    setDefault,
    forget,
    refreshLocalKeys,
  }
}
