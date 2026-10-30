<script setup lang="ts">
import { computed, reactive, toRefs } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { errorMessage } from '@/api/database'
import type {
  DatabaseDataExportFormat,
  DatabaseExportData,
  DatabaseExportLoader,
} from '@/types/database-export'
import type { ContextMenuItem } from '@/types/context-menu'
import {
  databaseExportFileName,
  databaseExportFormats,
} from '@/utils/database-export'
import { enqueueDatabaseDataExport } from '@/services/database-export'
import { IS_TAURI } from '@/utils/window'

const props = defineProps<{
  data: DatabaseExportData
  disabled?: boolean
  loadAll?: () => DatabaseExportLoader
}>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  // 导出格式菜单及其定位。
  menu: false,
  // 菜单横坐标。
  x: 0,
  // 菜单纵坐标。
  y: 0,
  // 待确认的文件格式。
  format: null as DatabaseDataExportFormat | null,
  // 表格默认导出符合筛选的全部已提交数据。
  scope: 'all',
  // SQL 插入语句的目标表名。
  tableName: '',
  // 文件名可独立编辑；默认附上日期以便区分多次备份。
  fileBase: '',
  includeDatabaseName: true,
  includeDate: true,
  includeTime: false,
  fileTime: new Date(),
  // 正在读取数据或写文件。
  busy: false,
  // 导出失败的原因。
  error: '',
})
const { menu, x, y, format, scope, tableName, busy, error } = toRefs(state)
// 格式图标直接放在菜单旁边，复用现有图标与主题颜色，便于集中调整。
const formatIcons = {
  sql: { icon: 'lucide:database', iconTone: 'blue' },
  xlsx: { icon: 'lucide:file-spreadsheet', iconTone: 'success' },
  dictionary: { icon: 'lucide:book-open', iconTone: 'violet' },
  txt: { icon: 'lucide:file-text', iconTone: 'blue' },
  csv: { icon: 'lucide:table-2', iconTone: 'cyan' },
  json: { icon: 'lucide:braces', iconTone: 'amber' },
} satisfies Record<
  DatabaseDataExportFormat,
  Pick<ContextMenuItem, 'icon' | 'iconTone'>
>
const items = computed<ContextMenuItem[]>(() =>
  databaseExportFormats.map(format => ({
    id: format.id,
    ...formatIcons[format.id],
    label: format.id === 'dictionary' ? t('数据字典') : format.label,
  }))
)
const fileName = computed(() =>
  databaseExportFileName(
    state.fileBase,
    databaseExportFormats.find(item => item.id === state.format)?.extension ||
      'sql',
    {
      database: state.includeDatabaseName ? props.data.schema : undefined,
      date: state.includeDate,
      time: state.includeTime,
    },
    state.fileTime
  )
)
const formatTone = {
  sql: 'text-blue',
  xlsx: 'text-success',
  dictionary: 'text-violet',
  txt: 'text-blue',
  csv: 'text-cyan',
  json: 'text-amber',
}
const scopeOptions = computed(() => [
  { value: 'all', label: t('全部数据（应用当前筛选）') },
  { value: 'page', label: t('当前页数据') },
])
/**
 * 点击导出按钮时，在按钮下方打开格式菜单。
 * 记录触发按钮的位置，具体的屏幕边界修正和键盘聚焦由现有菜单组件负责。
 */
function open(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  state.x = rect.left
  state.y = rect.bottom + 4
  state.menu = true
}
/**
 * 选择导出格式后打开范围确认弹窗，并用当前表名初始化 SQL 目标表名。
 * 同时清除上一次导出选择中的错误信息，便于用户重新配置并重试。
 */
function choose(id: string): void {
  state.format =
    databaseExportFormats.find(format => format.id === id)?.id ?? null
  state.tableName = props.data.name
  state.fileBase = props.data.name
  state.fileTime = new Date()
  state.error = ''
}
/** 关闭当前导出配置弹窗；已加入文件传输队列的后台任务继续运行。 */
function close(): void {
  state.format = null
}
/**
 * 确认导出时固定当前数据、筛选条件与格式，选择保存位置后加入文件传输队列。
 * 取消文件选择时不创建任务；选定路径后关闭配置弹窗，由传输中心展示后续进度。
 * 文件选择期间阻止重复提交，选择失败时保留弹窗并显示错误原因。
 */
async function run(): Promise<void> {
  const format = state.format
  if (!format || state.busy || (format === 'sql' && !state.tableName.trim()))
    return
  // 入队前拍下数据和筛选条件，排队期间切页或关闭标签不改变导出目标。
  const source = {
    ...props.data,
    columns: props.data.columns.map(column => ({ ...column })),
    rows: props.data.rows.slice(),
  }
  const loadAll =
    format !== 'dictionary' && state.scope === 'all'
      ? props.loadAll?.()
      : undefined
  const tableName = state.tableName.trim()
  const definition = databaseExportFormats.find(item => item.id === format)!
  const defaultPath = fileName.value
  state.busy = true
  state.error = ''
  try {
    const path = IS_TAURI
      ? await save({
          defaultPath,
          filters: [
            { name: definition.label, extensions: [definition.extension] },
          ],
        })
      : defaultPath
    if (!path) return
    void enqueueDatabaseDataExport({
      data: source,
      format,
      tableName,
      path,
      loadAll,
    })
    state.format = null
  } catch (error) {
    state.error = errorMessage(error)
  } finally {
    state.busy = false
  }
}
</script>

<template>
  <AppButton
    size="sm"
    :disabled="disabled || busy || !data.columns.length"
    aria-haspopup="menu"
    :aria-expanded="menu"
    @click="open"
  >
    <AppIcon
      name="lucide:download"
      :size="12"
    />{{ t('导出')
    }}<AppIcon
      name="lucide:chevron-down"
      :size="10"
    />
  </AppButton>
  <AppContextMenu
    :open="menu"
    :x="x"
    :y="y"
    :items="items"
    :label="t('导出格式')"
    @close="state.menu = false"
    @select="choose"
  />
  <AppDialog
    v-if="format !== null"
    :title="t('导出数据')"
    @close="close"
  >
    <div class="space-y-4">
      <div
        class="border-line-soft bg-panel/60 flex items-center gap-3 rounded-lg border p-3"
      >
        <span
          class="bg-surface flex size-10 shrink-0 items-center justify-center rounded-lg"
          :class="formatTone[format]"
        >
          <AppIcon
            :name="formatIcons[format].icon"
            :size="23"
          />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-txt text-xs font-medium">
            {{ databaseExportFormats.find(item => item.id === format)?.label }}
          </p>
          <p class="text-txt-3 mt-1 truncate font-mono text-[11px]">
            {{ data.schema ? `${data.schema}.${data.name}` : data.name }}
          </p>
        </div>
        <AppIcon
          name="lucide:file-output"
          :size="17"
          class="text-txt-4"
        />
      </div>
      <AppSelect
        v-if="loadAll && format !== 'dictionary'"
        v-model="scope"
        :label="t('导出范围')"
        :options="scopeOptions"
        :disabled="busy"
      />
      <p
        v-else
        class="text-txt-3 text-xs"
      >
        {{
          format === 'dictionary'
            ? t('导出字段定义与备注，不包含行数据')
            : t('导出当前语句已查询到的全部结果（含所有分页）')
        }}
      </p>
      <div class="border-line-soft space-y-3 rounded-lg border p-3">
        <AppTextField
          v-model="state.fileBase"
          :label="t('文件名')"
          :disabled="busy"
        />
        <div class="flex flex-wrap gap-x-4 gap-y-2">
          <AppCheckbox
            v-if="data.schema"
            v-model="state.includeDatabaseName"
            :label="t('包含数据库名')"
            :disabled="busy"
          />
          <AppCheckbox
            v-model="state.includeDate"
            :label="t('附加日期')"
            :disabled="busy"
          />
          <AppCheckbox
            v-model="state.includeTime"
            :label="t('附加时间')"
            :disabled="busy"
          />
        </div>
        <div
          class="text-txt-2 bg-surface flex items-start gap-2 rounded-md px-2.5 py-2 text-[11px]"
          aria-live="polite"
        >
          <AppIcon
            name="lucide:file-check-2"
            :size="13"
            class="text-violet mt-0.5 shrink-0"
          />
          <span class="font-mono break-all">{{ fileName }}</span>
        </div>
      </div>
      <p class="text-txt-4 flex items-start gap-1.5 text-[10.5px] leading-4">
        <AppIcon
          name="lucide:info"
          :size="12"
          class="mt-0.5 shrink-0"
        />
        {{
          format === 'xlsx'
            ? t(
                'Excel 在后台生成，最多 20 万单元格或 16 MB 文本；更大数据请使用 CSV、TXT、JSON 或 SQL。'
              )
            : t('分批读取并写入文件，可在文件传输中查看进度或取消。')
        }}
      </p>
      <p
        v-if="data.truncated"
        class="text-amber text-xs"
      >
        {{ t('查询结果已达行数上限，导出仅包含已返回的数据') }}
      </p>
      <AppTextField
        v-if="format === 'sql'"
        v-model="tableName"
        :label="t('SQL 目标表名')"
        :disabled="busy"
      />
      <p
        v-if="loadAll && format !== 'dictionary'"
        class="text-txt-4 text-xs"
      >
        {{ t('导出已提交的数据，未提交的单元格修改不包含在内') }}
      </p>
      <p
        v-if="error"
        class="text-danger text-xs"
        role="alert"
      >
        {{ error }}
      </p>
      <p
        v-if="busy"
        class="text-txt-3 text-xs"
        role="status"
      >
        {{ t('正在导出…') }}
      </p>
      <div class="flex justify-end gap-2">
        <AppButton
          variant="ghost"
          @click="close"
          >{{ t('取消') }}</AppButton
        >
        <AppButton
          :disabled="busy || (format === 'sql' && !tableName.trim())"
          variant="primary"
          @click="run"
          ><AppIcon
            name="lucide:download"
            :size="13"
          />{{ t('导出') }}</AppButton
        >
      </div>
    </div>
  </AppDialog>
</template>
