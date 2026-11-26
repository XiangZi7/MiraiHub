<script setup lang="ts">
import { computed, onScopeDispose, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener } from '@vueuse/core'
import { containerDetails } from '@/api/docker'
import { errorMessage } from '@/api/ssh'
import AppButton from '@/components/ui/AppButton.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import DocumentWindowFrame from '@/components/ui/DocumentWindowFrame.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { translateNativeMessage } from '@/i18n/native'
import ContainerDetailContent from '@/pages/docker/components/container-detail-content.vue'
import { useConnectionsStore } from '@/stores/connections'
import { isDockerConnection } from '@/types/connection'
import type { DockerContainerDetails } from '@/types/docker'
import { dockerTargetFingerprint } from '@/utils/docker-target'
import { closeWindow, IS_TAURI } from '@/utils/window'

const props = defineProps<{
  connectionId: string
  containerId: string
  containerName?: string
}>()
const { t } = useI18n()
const connections = useConnectionsStore()
const profile = computed(() => {
  const item = connections.find(props.connectionId)
  return item && isDockerConnection(item) ? item : undefined
})
const target = computed(() =>
  profile.value
    ? dockerTargetFingerprint(profile.value, id => connections.find(id))
    : ''
)
const state = reactive({
  details: null as DockerContainerDetails | null,
  loading: false,
  changed: false,
  error: '',
})
const title = computed(() =>
  t('容器“{name}”的详情', {
    name:
      state.details?.name ||
      props.containerName ||
      props.containerId.slice(0, 12),
  })
)
let boundTarget = ''
let generation = 0

/** 主窗口切换了这个配置的目标后丢弃旧详情及进行中的请求。 */
watch(target, current => {
  if (boundTarget && boundTarget !== current) {
    ++generation
    Object.assign(state, {
      details: null,
      changed: true,
      loading: false,
      error: '',
    })
  }
})

/** 手动刷新沿用同一目标；仅接受最后一个请求的响应。 */
async function refresh(): Promise<void> {
  if (state.changed) return
  const request = ++generation
  state.loading = true
  state.error = ''
  try {
    if (!props.connectionId || !/^[a-f0-9]{64}$/i.test(props.containerId))
      throw new Error(t('详情窗口缺少有效的连接或容器 ID'))
    await connections.refresh()
    if (request !== generation) return
    const selected = profile.value
    if (!selected) throw new Error(t('找不到此容器使用的 Docker 连接'))
    boundTarget ||= target.value
    if (boundTarget !== target.value) return
    const details = await containerDetails(
      selected.settings,
      props.containerId,
      selected.id
    )
    if (request === generation && boundTarget === target.value)
      state.details = details
  } catch (error) {
    if (request === generation)
      state.error = translateNativeMessage(errorMessage(error))
  } finally {
    if (request === generation) state.loading = false
  }
}
watch(
  () => [props.connectionId, props.containerId],
  () => {
    boundTarget = ''
    state.changed = false
    state.details = null
    void refresh()
  },
  { immediate: true }
)
onScopeDispose(() => {
  ++generation
})

/** Escape 和标题栏的关闭按钮使用同一个窗口关闭操作。 */
function close(): void {
  if (IS_TAURI) closeWindow()
  else window.close()
}
useEventListener('keydown', event => {
  if (event.key === 'Escape') close()
})
</script>

<template>
  <!-- 与 SSH 文件和容器日志共用原生窗口标题栏、拖动和窗口按钮。 -->
  <DocumentWindowFrame
    :title="title"
    :meta="profile?.name"
    :close-action="close"
  >
    <template #actions>
      <!-- 刷新一次容器详情与当次资源读数。 -->
      <IconButton
        icon="lucide:refresh-cw"
        :title="t('刷新容器详情')"
        :size="14"
        :disabled="state.loading || state.changed"
        @click="refresh"
      />
    </template>
    <div
      class="bg-pane flex min-h-0 flex-1 flex-col"
      :aria-busy="state.loading"
    >
      <!-- 连接变化或请求失败时提供与当前状态相对应的操作。 -->
      <AppEmptyState
        v-if="state.changed || state.error"
        class="m-auto"
        icon="lucide:circle-alert"
        :title="t('无法读取容器详情')"
        :description="
          state.changed
            ? t('Docker 连接已更改，请从容器列表重新打开详情。')
            : state.error
        "
      >
        <AppButton
          v-if="!state.changed"
          size="sm"
          @click="refresh"
          >{{ t('重试') }}</AppButton
        >
      </AppEmptyState>
      <!-- 加载已有数据时保留同一内容区域的位置。 -->
      <ContainerDetailContent
        v-else-if="state.details"
        :details="state.details"
      />
      <div
        v-else
        class="text-txt-3 m-auto flex items-center gap-2 text-xs"
        role="status"
      >
        <AppIcon
          name="lucide:loader-circle"
          :size="14"
          class="motion-safe:animate-spin"
        />
        {{ t('正在加载…') }}
      </div>
    </div>
  </DocumentWindowFrame>
</template>
