/**
 * SSH 密钥管理。
 *
 * 密钥来自 Rust 侧对 ~/.ssh 的扫描，组件只管展示与触发操作。
 */

import { computed, reactive, toRefs } from 'vue'
import * as ssh from '@/api/ssh'
import type { GenerateKeyRequest, SshKeyInfo } from '@/types/ssh'

export function useSshKeys() {
  // 响应式状态
  const state = reactive({
    // 扫描到的密钥
    keys: [] as SshKeyInfo[],
    // 选中的密钥 id，即私钥绝对路径
    selected: '',
    // 列表搜索关键词
    keyword: '',
    // 是否正在扫描
    loading: false,
    // 扫描/操作失败的原因
    error: '',
  })

  const { keys, selected, keyword, loading, error } = toRefs(state)

  /** 按密钥名、指纹、注释过滤 */
  const visibleKeys = computed(() => {
    const kw = state.keyword.trim().toLowerCase()
    if (!kw)
      return state.keys

    return state.keys.filter(key =>
      key.label.toLowerCase().includes(kw)
      || key.fingerprint.toLowerCase().includes(kw)
      || key.comment.toLowerCase().includes(kw),
    )
  })

  /** 当前详情展示的密钥 */
  const current = computed(() => state.keys.find(key => key.id === state.selected))

  /** 重新扫描 ~/.ssh */
  async function refresh(): Promise<void> {
    state.loading = true
    state.error = ''

    try {
      state.keys = await ssh.listKeys()

      // 选中项可能已被删掉（或首次加载还没选），回落到第一把
      if (!state.keys.some(key => key.id === state.selected))
        state.selected = state.keys[0]?.id ?? ''
    }
    catch (err) {
      state.error = ssh.errorMessage(err)
      state.keys = []
    }
    finally {
      state.loading = false
    }
  }

  /** 生成新密钥，成功后选中它 */
  async function generate(request: GenerateKeyRequest): Promise<void> {
    state.error = ''

    try {
      const key = await ssh.generateKey(request)
      await refresh()
      state.selected = key.id
    }
    catch (err) {
      state.error = ssh.errorMessage(err)
      throw err
    }
  }

  /** 删除密钥对 */
  async function remove(keyId: string): Promise<void> {
    state.error = ''

    try {
      await ssh.deleteKey(keyId)
      await refresh()
    }
    catch (err) {
      state.error = ssh.errorMessage(err)
      throw err
    }
  }

  return {
    keys,
    selected,
    keyword,
    loading,
    error,
    visibleKeys,
    current,
    refresh,
    generate,
    remove,
  }
}
