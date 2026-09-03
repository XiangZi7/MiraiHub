<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { useSshTerminal } from '@/composables/useSshTerminal'
import type { SshConfig, SshSessionStatus } from '@/types/ssh'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  /**
   * 要连接的目标。为空表示还没选服务器，此时展示空状态而不是一个连不上的终端。
   * 由上层在用户选中连接后传入。
   */
  config?: SshConfig
  /** 连接名，展示在工具条上。缺省时退回 user@host */
  title?: string
  /** 请求远端 PTY 使用的终端类型 */
  terminalType?: string
  /** shell 就绪后自动执行，空串表示不执行 */
  startupCommand?: string
}>()

const emit = defineEmits<{
  /**
   * 连接状态变化。带上后端会话 id，
   * 让机器面板能用它去查系统指标与目录列表。
   */
  status: [status: SshSessionStatus, sessionId: string]
}>()

const containerRef = useTemplateRef<HTMLElement>('terminal')

const { status, sessionId, mount, connect, resize } = useSshTerminal()

// xterm 是否已挂到容器上。挂载只做一次，重连复用同一个实例。
// 用普通变量而非响应式：模板不读它，只是 watch 内部的一次性标记
let mounted = false

/** 状态变化即上报，让标签页的状态点跟着走 */
watch(status, value => emit('status', value, sessionId.value), { immediate: true })

/** 工具条上的连接状态文案与配色 */
const statusMeta = computed(() => {
  switch (status.value) {
    case 'connected':
      return { text: 'Connected', tone: 'text-accent', dot: 'accent' as const }
    case 'connecting':
      return { text: 'Connecting…', tone: 'text-amber', dot: 'amber' as const }
    default:
      return { text: 'Disconnected', tone: 'text-txt-3', dot: 'txt-3' as const }
  }
})

/** 标题栏展示的目标 */
const endpoint = computed(() => {
  if (!props.config)
    return '未选择服务器'

  return props.title || `${props.config.username}@${props.config.host}`
})

/**
 * 连接提示是瞬时界面状态，不写入 xterm 缓冲区。
 * 这样连接完成后提示会真正移除，重连也不会把它夹在远端输出中间。
 */
const connectingText = computed(() => {
  if (!props.config)
    return ''

  return `正在连接 ${props.config.username}@${props.config.host}:${props.config.port} …`
})

/**
 * 挂载并连接。
 * 容器要等 v-if 渲染出来才有尺寸，所以由 watch 在 config 就位后触发，
 * 而不是在 onMounted 里抢跑 —— 那时容器高度还是 0，fit 会算出 1 行。
 */
watch(
  () => props.config,
  async (config) => {
    if (!config || !containerRef.value)
      return

    if (!mounted) {
      mount(containerRef.value)
      mounted = true
    }

    await connect(config, {
      terminalType: props.terminalType,
      startupCommand: props.startupCommand,
    }).catch(() => {
      // 失败原因已经写进终端并存到 composable 的 error，这里只是别让 rejection 逃逸
    })
  },
  { immediate: true, flush: 'post' },
)

/**
 * 容器尺寸变化时重新适配。
 * 光靠 window resize 不够：收起机器面板会让终端变宽，但窗口尺寸没变，
 * 不重算的话右侧会留一大片空白。
 */
useResizeObserver(containerRef, () => resize())

/** 重连：先断干净再按原配置连一次 */
async function reconnect(): Promise<void> {
  if (!props.config)
    return

  await connect(props.config, {
    terminalType: props.terminalType,
    startupCommand: props.startupCommand,
  }).catch(() => {})
}
</script>

<template>
  <section class="pane min-w-0 flex-1 bg-terminal">
    <!-- 会话工具条 -->
    <div class="flex h-9 shrink-0 items-center gap-2.5 border-b border-line-soft px-3">
      <span :class="['flex items-center gap-1.5 text-[11px]', statusMeta.tone]">
        <StatusDot :tone="statusMeta.dot" :size="6" :glow="status === 'connected'" />
        <span>{{ statusMeta.text }}</span>
      </span>

      <span class="rounded border border-line bg-card px-1.5 py-0.5 text-[10px] font-medium text-txt-2">
        SSH
      </span>

      <span class="truncate text-[11px] text-txt-2" :title="sessionId || undefined">
        {{ endpoint }}
      </span>

      <div class="flex-1" />

      <IconButton icon="lucide:columns-2" :size="14" title="分屏" />
      <IconButton icon="lucide:search" :size="14" title="搜索" />
      <IconButton icon="lucide:rotate-cw" :size="14" title="重连" @click="reconnect" />
      <IconButton icon="lucide:ellipsis" :size="14" title="更多" />
    </div>

    <!-- 终端输出区。xterm 自己接管这个容器的滚动与渲染 -->
    <div v-if="config" class="relative min-h-0 flex-1">
      <div ref="terminal" class="absolute inset-0 p-2" />
      <p
        v-if="status === 'connecting'"
        class="pointer-events-none absolute top-2 left-2 z-10 font-mono text-xs leading-[1.4] text-txt-3"
        role="status"
        aria-live="polite"
      >
        {{ connectingText }}
      </p>
    </div>

    <!-- 还没选服务器 -->
    <div v-else class="flex min-h-0 flex-1 items-center justify-center">
      <div class="flex flex-col items-center gap-3 text-center">
        <div class="grid size-14 place-items-center rounded-2xl border border-line bg-card text-txt-3">
          <AppIcon name="lucide:square-terminal" :size="26" />
        </div>
        <p class="text-sm text-txt-2">
          还没有打开终端
        </p>
        <p class="max-w-70 text-xs text-txt-4">
          从左侧选一台服务器，或新建一个连接
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* xterm 默认给容器加内边距的位置不对，且它的滚动条要跟项目其余部分统一 */
:deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: var(--color-line-strong) transparent;
}

:deep(.xterm-viewport)::-webkit-scrollbar {
  width: 8px;
}

:deep(.xterm-viewport)::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--color-line-strong);
}

:deep(.xterm-viewport)::-webkit-scrollbar-track {
  background: transparent;
}
</style>
