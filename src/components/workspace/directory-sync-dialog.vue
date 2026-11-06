<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { scanSyncDirectories, type SyncScan } from '@/api/workspace-files'
import { directoryDifferences } from '@/utils/directory-sync'
import { useFileTransfers } from '@/composables/useFileTransfers'
import * as ssh from '@/api/ssh'
import { toast } from '@/composables/useToast'
const props = defineProps<{ sessionId: string; localPath: string; remotePath: string }>()
const emit = defineEmits<{ close: []; complete: [] }>()
const { t } = useI18n()
const transfers = useFileTransfers()
// 响应式状态
const state = reactive({
  // 单向同步方向
  direction: 'upload' as 'upload' | 'download',
  // 双端目录只读快照
  scan: null as SyncScan | null,
  // 用户从预览中勾选的文件
  selected: [] as string[],
  // 扫描或传输期间禁用重复执行
  busy: false,
})
const { direction, scan, selected, busy } = toRefs(state)
const differences = computed(() => state.scan ? directoryDifferences(state.scan, state.direction) : [])
let generation = 0
watch(() => state.direction, () => { state.selected = [] })
// 关闭后丢弃迟到的扫描结果。
onBeforeUnmount(() => { generation += 1 })
/** 扫描两个目录，仅生成差异，用户核对后才允许传输。 */
async function preview(): Promise<void> {
  const token = ++generation
  state.busy = true
  state.scan = null
  state.selected = []
  try {
    const result = await scanSyncDirectories(props.sessionId, props.localPath, props.remotePath)
    if (token !== generation) return
    state.scan = result
    state.selected = differences.value.filter(item => !item.conflict).map(item => item.path)
  } catch (error) { if (token === generation) toast.error({ title: t('扫描目录失败'), description: ssh.errorMessage(error) }) }
  finally { if (token === generation) state.busy = false }
}
/** 将锁定快照中的选中文件送入传输队列，只同步新增或变化内容。 */
async function execute(): Promise<void> {
  if (!state.scan || state.busy) return
  const scan = state.scan
  const sessionId = props.sessionId
  const direction = state.direction
  const files = differences.value.filter(item => state.selected.includes(item.path) && !item.conflict)
  state.busy = true
  let succeeded = 0
  try {
    for (const file of files) {
      if (direction === 'upload') {
        const parts = file.path.split('/').slice(0, -1)
        let parent = scan.remoteRoot
        for (const part of parts) {
          const next = `${parent.replace(/\/$/u, '')}/${part}`
          if (!await ssh.pathExists(sessionId, next)) await ssh.createPath(sessionId, parent, part, true)
          parent = next
        }
        if (await transfers.upload({ sessionId, localPath: `${scan.localRoot}/${file.path}`, remotePath: `${scan.remoteRoot.replace(/\/$/u, '')}/${file.path}`, overwrite: true })) succeeded++
      } else if (await transfers.download({ sessionId, remotePath: `${scan.remoteRoot.replace(/\/$/u, '')}/${file.path}`, localPath: `${scan.localRoot}/${file.path}`, overwrite: true })) succeeded++
    }
    toast.info(t('同步完成：成功 {done} / {total}', { done: succeeded, total: files.length }))
    state.scan = null
    state.selected = []
    emit('complete')
  } catch (error) { toast.error({ title: t('同步失败'), description: ssh.errorMessage(error) }) }
  finally { state.busy = false }
}
</script>
<template>
  <AppDialog :title="t('目录同步')" wide @close="!busy && emit('close')">
    <div class="grid min-h-0 gap-3 overflow-auto p-4 text-xs">
      <p class="text-txt-3 break-all">{{ localPath }} ↔ {{ remotePath }}</p>
      <p class="text-txt-3">{{ t('按大小和修改时间比较，选中项目会覆盖目标文件；不会删除文件。') }}</p>
      <select v-model="direction" class="field" :disabled="busy"><option value="upload">{{ t('本地 → 远端') }}</option><option value="download">{{ t('远端 → 本地') }}</option></select>
      <AppButton :disabled="busy" @click="preview">{{ busy ? t('处理中…') : t('预览差异') }}</AppButton>
      <div v-if="scan" class="border-line max-h-64 overflow-auto rounded border">
        <p v-if="!differences.length" class="text-txt-3 p-3">{{ t('没有需要同步的文件') }}</p>
        <label v-for="item in differences" :key="item.path" class="border-line-soft flex items-center gap-2 border-b p-2"><input v-model="selected" type="checkbox" :value="item.path" :disabled="busy || item.conflict" /><span class="min-w-0 flex-1 truncate">{{ item.path }}</span><span :class="item.conflict ? 'text-danger' : 'text-txt-3'">{{ item.conflict ? t('类型冲突') : item.reason === 'missing' ? t('新增') : t('覆盖') }}</span></label>
      </div>
      <AppButton variant="primary" :disabled="busy || !scan || !selected.length" @click="execute">{{ t('同步选中文件') }} ({{ selected.length }})</AppButton>
    </div>
  </AppDialog>
</template>
