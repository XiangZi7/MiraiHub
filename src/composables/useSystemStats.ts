/**
 * 远端系统指标。
 *
 * 采集走 SSH exec，后端为算 CPU / 网络速率会在远端 sleep 1 秒做两次采样，
 * 所以单次调用本身就要一秒多。轮询间隔定在 5 秒：
 * 再快只会让请求首尾相接，再慢曲线就跟不上实际负载了。
 */

import {
  computed,
  onBeforeUnmount,
  onActivated,
  onDeactivated,
  shallowRef,
  reactive,
  toRefs,
  watch,
  type Ref,
} from 'vue'
import { useDocumentVisibility } from '@vueuse/core'
import * as ssh from '@/api/ssh'
import type { SshSystemStats } from '@/types/ssh'

/** 轮询间隔，毫秒 */
const POLL_INTERVAL = 5000

/** 折线图保留的采样点数。44 个点约 3.5 分钟，够看出趋势又不至于挤成一团 */
const HISTORY_SIZE = 44

export function useSystemStats(sessionId: Ref<string>) {
  // 响应式状态
  const state = reactive({
    // 最近一次采集结果，未采集时为 null
    stats: null as SshSystemStats | null,
    // 首次加载中。后续轮询不置这个标志，否则曲线会每 5 秒闪一次骨架屏
    loading: false,
    // 采集失败的原因
    error: '',
    // 各指标的历史采样，驱动 SparkLine
    history: {
      cpu: [] as number[],
      memory: [] as number[],
      disk: [] as number[],
      network: [] as number[],
    },
  })

  const { stats, loading, error, history } = toRefs(state)

  let timer: ReturnType<typeof setTimeout> | undefined
  // 每次会话变化都递增。旧请求回来时用它判断结果是否已经过期，
  // 同时只阻止同一代请求重入，不妨碍切换服务器后立刻采新机器。
  const visible = useDocumentVisibility()
  const active = shallowRef(true)
  const polling = computed(() => active.value && visible.value === 'visible')
  let generation = 0
  const inflightSessions = new Set<string>()
  let inflightGeneration = -1

  /** 把新采样推进历史，超长丢最早的 */
  function pushHistory(snapshot: SshSystemStats): void {
    const push = (list: number[], value: number): void => {
      list.push(Number.isFinite(value) ? value : 0)
      if (list.length > HISTORY_SIZE) list.shift()
    }

    const { memory, disk, network } = snapshot

    push(state.history.cpu, snapshot.cpu.usage)
    push(state.history.memory, percentOf(memory.usedKb, memory.totalKb))
    push(state.history.disk, percentOf(disk.usedKb, disk.totalKb))
    // 网络没有"百分比"可言，直接放绝对速率，SparkLine 会按自身的最值归一化
    push(state.history.network, network.rxBytesPerSec + network.txBytesPerSec)
  }

  /** 采集一次 */
  async function refresh(): Promise<void> {
    const id = sessionId.value
    const requestGeneration = generation

    if (
      !id ||
      inflightSessions.has(id) ||
      inflightGeneration === requestGeneration
    )
      return

    inflightSessions.add(id)
    inflightGeneration = requestGeneration

    if (!state.stats) state.loading = true

    try {
      const snapshot = await ssh.systemStats(id)

      // 采集期间会话可能已经断了或换了台机器，
      // 这时的结果属于上一台，写进去会让界面显示错误的数据
      if (generation !== requestGeneration || sessionId.value !== id) return

      state.stats = snapshot
      state.error = ''
      pushHistory(snapshot)
    } catch (err) {
      if (generation === requestGeneration && sessionId.value === id)
        state.error = ssh.errorMessage(err)
    } finally {
      inflightSessions.delete(id)
      if (generation === requestGeneration) {
        inflightGeneration = -1
        state.loading = false
      }
    }
  }

  /**
   * 起轮询。
   *
   * 用 setTimeout 自续而不是 setInterval：采集耗时不固定（网络慢时可能好几秒），
   * setInterval 会在慢的时候堆积回调，这样每次都是「上一次结束后再等 5 秒」。
   */
  function schedule(expectedGeneration = generation): void {
    stop()
    if (!polling.value || !sessionId.value) return

    timer = setTimeout(async () => {
      await refresh()
      // 停止后 refresh 可能还在飞，回来时定时器已经清了，此时不该再续
      if (timer !== undefined && generation === expectedGeneration)
        schedule(expectedGeneration)
    }, POLL_INTERVAL)
  }

  function stop(): void {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  /** Pause cached/hidden views without disconnecting their terminal sessions. */
  watch(
    [sessionId, polling],
    async ([id, enabled], previous) => {
      stop()
      const currentGeneration = ++generation
      inflightGeneration = -1
      state.loading = false
      if (!previous || id !== previous[0]) {
        state.stats = null
        state.error = ''
        state.history = { cpu: [], memory: [], disk: [], network: [] }
      }
      if (!id || !enabled) return
      await refresh()
      if (generation === currentGeneration) schedule(currentGeneration)
    },
    { immediate: true }
  )
  onActivated(() => {
    active.value = true
  })
  onDeactivated(() => {
    active.value = false
  })

  onBeforeUnmount(() => {
    // 让正在等待的初次 refresh 失效，避免它在组件卸载后又把轮询定时器续起来。
    generation += 1
    stop()
  })

  /** 是否有数据可展示 */
  const ready = computed(() => state.stats !== null)

  return { stats, loading, error, history, ready, refresh }
}

/** 占比，分母为 0 时返回 0 而不是 NaN */
function percentOf(used: number, total: number): number {
  return total > 0 ? (used / total) * 100 : 0
}
