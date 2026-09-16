<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  defineAsyncComponent,
  nextTick,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { MACHINE_VIEWS } from '@/constants/workspace'
import type { MachineViewId } from '@/types'
import type { SavedConnection } from '@/types/connection'
import { cn } from '@/utils/cn'
import FilesView from './FilesView.vue'

const AiAgentPanel = defineAsyncComponent(
  () => import('@/components/agent/AiAgentPanel.vue')
)

const { t } = useI18n()

/**
 * 机器详情面板。
 * 文件和 AI Agent 共用机器侧面板；Agent 首次打开后保持挂载，保留当前草稿与会话。
 */

const props = defineProps<{
  /** 当前标签对应的连接，无标签时为 undefined */
  connection?: SavedConnection
  title?: string
  active: boolean
  /** 后端 SSH 会话 id，未连上时为空串 */
  sessionId: string
  /** 由主窗口统一管理的面板宽度 */
  width: number
}>()

// 当前视图由 workspace-layout Store 持有，命令面板与服务器页共用。
const view = defineModel<MachineViewId>('view', { required: true })

defineEmits<{
  /** 请求收起面板 */
  close: []
}>()

// 转成 ref 传给子组件的 composable：它们 watch 会话 id 的变化来重新取数
const filesView = useTemplateRef<InstanceType<typeof FilesView>>('filesView')
async function upload(): Promise<void> {
  view.value = 'files'
  await nextTick()
  await filesView.value?.pickUploadFiles()
}
defineExpose({ upload })

const agentVisited = shallowRef(false)
const filesVisited = shallowRef(false)
watch(
  () => (props.active ? view.value : null),
  current => {
    if (current === 'agent') agentVisited.value = true
    if (current === 'files') filesVisited.value = true
  },
  { immediate: true }
)
const target = computed(() => ({
  kind: 'ssh' as const,
  sessionId: props.sessionId,
  database: '',
}))
</script>

<template>
  <section
    class="pane min-w-0 shrink-0"
    :style="{ width: `${props.width}px` }"
  >
    <!-- 视图切换 -->
    <header
      class="border-line-soft flex h-10 shrink-0 items-center gap-1 border-b px-2"
    >
      <button
        v-for="item in MACHINE_VIEWS"
        :key="item.id"
        type="button"
        :class="cn('seg', view === item.id && 'seg-active')"
        :aria-pressed="view === item.id"
        @click="view = item.id"
      >
        <AppIcon
          :name="item.icon"
          :size="13"
        />
        <span>{{ t(item.label) }}</span>
        <span
          v-if="item.id === 'agent'"
          class="text-blue bg-blue/10 rounded px-1 text-[8px]"
          >BETA</span
        >
      </button>

      <div class="flex-1" />

      <IconButton
        icon="lucide:panel-right-close"
        :size="14"
        :title="t('收起机器面板')"
        @click="$emit('close')"
      />
    </header>

    <div
      v-if="filesVisited"
      v-show="view === 'files'"
      class="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <FilesView
        ref="filesView"
        :session-id="sessionId"
        :connection-name="
          connection ? `${connection.name} (${connection.host})` : ''
        "
      />
    </div>
    <AiAgentPanel
      v-if="agentVisited"
      v-show="view === 'agent'"
      :target="target"
      :title="connection?.name || title"
      :active="active && view === 'agent'"
      embedded
    />
  </section>
</template>
