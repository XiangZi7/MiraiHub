<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  reactive,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import * as ssh from '@/api/ssh'
import type { SshRemoteFile } from '@/types/ssh'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'

const props = defineProps<{
  sessionId: string
  directory: string
  count: number
  mode: 'move' | 'copy'
  busy: boolean
}>()
const emit = defineEmits<{ close: []; submit: [directory: string] }>()
const { t } = useI18n()
const input = useTemplateRef<HTMLInputElement>('input')
// 弹窗打开后把焦点放在目标路径，便于直接粘贴路径并用 Enter 浏览。
onMounted(() => {
  void nextTick(() => input.value?.focus())
})
// 响应式状态
const state = reactive({
  // 用户输入的目标目录，加载成功后替换为后端规范化的绝对路径
  path: props.directory,
  // 最近一次成功读取的目录，只有与输入一致时才能提交
  loadedPath: '',
  // 当前目录中的子目录，用于继续浏览目标位置
  folders: [] as SshRemoteFile[],
  // 目标目录读取状态
  loading: false,
  // 路径不存在或权限不足的反馈
  error: '',
})
const { path, folders, loading, error } = toRefs(state)
let version = 0
const canSubmit = computed(() =>
  Boolean(
    state.loadedPath &&
    state.path === state.loadedPath &&
    !state.loading &&
    !props.busy
  )
)

// 浏览目标目录时保留后端规范化路径，并丢弃旧目录的迟到响应。
async function browse(path = state.path): Promise<void> {
  if (props.busy) return
  const current = ++version
  state.loading = true
  state.error = ''
  try {
    const listing = await ssh.listDirectory(props.sessionId, path)
    if (current !== version) return
    state.path = listing.path
    state.loadedPath = listing.path
    state.folders = listing.entries
      .filter(file => file.kind === 'directory')
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    if (current === version) {
      state.loadedPath = ''
      state.error = ssh.errorMessage(error)
    }
  } finally {
    if (current === version) state.loading = false
  }
}

// 上一级导航以当前已读取的绝对路径计算，根目录保持不变。
function parent(): void {
  void browse(state.loadedPath.replace(/\/[^/]+\/?$/, '') || '/')
}
// 切换连接时重读目标，避免把上一条 SSH 连接的目录用于本次操作。
watch(
  () => props.sessionId,
  () => {
    void browse(props.directory)
  },
  { immediate: true }
)
</script>

<template>
  <AppDialog
    :title="t(mode === 'move' ? 'files.moveTo' : 'files.copyTo')"
    :description="t('files.transferDescription', { count })"
    @close="emit('close')"
  >
    <form
      class="flex items-center gap-2"
      @submit.prevent="browse()"
    >
      <IconButton
        icon="lucide:arrow-up"
        :size="15"
        :title="t('上一级')"
        :disabled="loading || busy || path === '/'"
        @click="parent"
      />
      <input
        v-model="path"
        ref="input"
        :disabled="busy"
        class="border-line bg-input text-txt focus:border-accent min-w-0 flex-1 rounded-md border px-2 py-2 text-xs outline-none"
        :aria-label="t('files.targetDirectory')"
      />
      <AppButton
        size="sm"
        :disabled="loading || busy"
        @click="browse()"
        >{{ t('打开目录') }}</AppButton
      >
    </form>
    <p
      v-if="error"
      role="alert"
      class="text-danger mt-2 text-xs"
    >
      {{ error }}
    </p>
    <div
      class="border-line scroll-thin mt-3 h-60 overflow-auto rounded-md border"
      :aria-busy="loading"
    >
      <p
        v-if="loading"
        role="status"
        class="text-txt-3 p-3 text-xs"
      >
        {{ t('正在读取目录…') }}
      </p>
      <button
        v-for="folder in folders"
        v-else
        :key="folder.path"
        type="button"
        :disabled="busy"
        class="hover:bg-hover text-txt-2 flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs disabled:cursor-wait"
        @click="browse(folder.path)"
      >
        <AppIcon
          name="lucide:folder"
          :size="15"
          class="text-accent shrink-0"
        /><span class="truncate">{{ folder.name }}</span
        ><AppIcon
          name="lucide:chevron-right"
          :size="13"
          class="ml-auto"
        />
      </button>
      <p
        v-if="!loading && !folders.length && !error"
        class="text-txt-3 p-3 text-xs"
      >
        {{ t('files.noSubfolders') }}
      </p>
    </div>
    <template #footer>
      <span
        v-if="busy"
        role="status"
        class="text-txt-3 text-xs"
        >{{ t('files.processing') }}</span
      >
      <div class="flex-1" />
      <AppButton
        size="sm"
        @click="emit('close')"
        >{{ busy ? t('files.background') : t('取消') }}</AppButton
      >
      <AppButton
        size="sm"
        variant="primary"
        :disabled="!canSubmit"
        @click="emit('submit', path)"
        >{{
          t(mode === 'move' ? 'files.moveHere' : 'files.copyHere')
        }}</AppButton
      >
    </template>
  </AppDialog>
</template>
