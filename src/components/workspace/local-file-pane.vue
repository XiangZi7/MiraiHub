<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, toRefs } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { useI18n } from 'vue-i18n'
import { listLocalDirectory, type LocalListing, type LocalFileEntry } from '@/api/workspace-files'
import { useFileTransfers } from '@/composables/useFileTransfers'
import { toast } from '@/composables/useToast'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import DirectorySyncDialog from '@/components/workspace/directory-sync-dialog.vue'
const props = defineProps<{ sessionId: string; remotePath: string }>()
const emit = defineEmits<{ upload: [paths: string[]]; refreshed: [] }>()
const { t } = useI18n()
const transfers = useFileTransfers()
// 响应式状态
const state = reactive({
  // 当前浏览目录
  listing: null as LocalListing | null,
  // 可编辑的绝对路径
  path: '',
  // 加载时阻止重复操作
  loading: false,
  // 是否打开同步预览
  syncing: false,
})
const { listing, path, loading, syncing } = toRefs(state)
let generation = 0
/** 浏览本地目录并丢弃过期响应。 */
async function load(path = ''): Promise<void> {
  const token = ++generation
  state.loading = true
  try { const result = await listLocalDirectory(path); if (token === generation) { state.listing = result; state.path = result.path } }
  catch (error) { if (token === generation) toast.error({title: t('读取本地目录失败'), description: String(error)}) }
  finally { if (token === generation) state.loading = false }
}
/** 通过原生选择器切换目录，支持跨盘符浏览。 */
async function chooseDirectory(): Promise<void> {
  const result = await open({ directory: true, multiple: false })
  if (typeof result === 'string') await load(result)
}
/** 面板间拖拽只传路径，文件内容由原生传输处理。 */
function drag(event: DragEvent, entry: LocalFileEntry): void {
  event.dataTransfer?.setData('application/x-miraihub-local', JSON.stringify([entry.path]))
}
/** 仅接受当前会话的远端文件拖拽，在选定本地目录中下载。 */
async function drop(event: DragEvent): Promise<void> {
  const raw = event.dataTransfer?.getData('application/x-miraihub-remote')
  if (!raw || !state.listing) return
  try {
    const item = JSON.parse(raw)
    if (item.sessionId !== props.sessionId || typeof item.path !== 'string' || typeof item.name !== 'string' || /[\\/:]/u.test(item.name) || item.name === '.' || item.name === '..') return
    await transfers.download({ sessionId: props.sessionId, remotePath: item.path, localPath: `${state.listing.path}/${item.name}` })
    await load(state.listing.path)
  } catch (error) { toast.error(String(error)) }
}
onMounted(() => void load())
onBeforeUnmount(() => { generation += 1 })
</script>
<template>
  <section class="border-line flex min-h-0 min-w-0 flex-1 flex-col border-r" @dragover.prevent.stop @drop.prevent.stop="drop">
    <header class="border-line-soft flex h-9 shrink-0 items-center gap-1 border-b px-2 text-xs"><span class="text-txt-2 mr-auto">{{ t('本地文件') }}</span><IconButton icon="lucide:folder-open" :size="14" :title="t('选择本地目录')" @click="chooseDirectory" /><IconButton icon="lucide:arrow-up" :size="14" :title="t('上一级')" :disabled="loading || !listing?.parent" @click="load(listing?.parent || '')" /><IconButton icon="lucide:refresh-cw" :size="14" :title="t('刷新')" :disabled="loading" @click="load(path)" /><IconButton icon="lucide:folder-sync" :size="14" :title="t('目录同步')" :disabled="!listing || !sessionId || !remotePath" @click="syncing = true" /></header>
    <input v-model="path" class="field m-2" :aria-label="t('本地目录路径')" :disabled="loading" @keydown.enter="load(path)" />
    <p class="text-txt-3 px-3 pb-2 text-[10px]">{{ t('双击文件上传，拖到另一栏传输') }}</p>
    <div class="scroll-thin min-h-0 flex-1 overflow-auto p-1">
      <button v-for="entry in listing?.entries ?? []" :key="entry.path" type="button" draggable="true" class="text-txt-2 hover:bg-hover flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs" @dragstart="drag($event, entry)" @dblclick="entry.directory ? load(entry.path) : emit('upload', [entry.path])"><AppIcon :name="entry.directory ? 'lucide:folder' : 'lucide:file'" :size="14" /><span class="truncate">{{ entry.name }}</span></button>
    </div>
    <Teleport to="body"><DirectorySyncDialog v-if="syncing && listing" :session-id="sessionId" :local-path="listing.path" :remote-path="remotePath" @close="syncing = false" @complete="load(path); emit('refreshed')" /></Teleport>
  </section>
</template>
