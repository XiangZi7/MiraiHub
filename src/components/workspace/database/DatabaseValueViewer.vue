<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { toast } from '@/composables/useToast'
import { copyText } from '@/utils/clipboard'
import { cn } from '@/utils/cn'
import { decodeBinaryValue, isBinaryValue } from '@/utils/database-grid'

const { t } = useI18n()

type ViewerTab = 'text' | 'json' | 'hex' | 'image'

/** 十六进制视图最多展示的字节数，超大 BLOB 不把 DOM 撑爆。 */
const HEX_LIMIT = 4096
const JSON_LINE_LIMIT = 5000

const props = defineProps<{
  /** 当前单元格的标识；切换时未应用的草稿写回原单元格。没有选中单元格时为 null。 */
  cellKey: string | null
  column?: string
  dataType?: string
  value: string | null
  editable?: boolean
  nullable?: boolean
}>()

const emit = defineEmits<{
  save: [value: string | null, cellKey: string]
  close: []
}>()

const draft = shallowRef(props.value ?? '')
let baseline = props.value ?? ''
const activeTab = shallowRef<ViewerTab>('text')

const binary = computed(() => isBinaryValue(props.value, props.dataType))
const bytes = computed<Uint8Array | null>(() => {
  if (props.value === null) return null
  return binary.value
    ? decodeBinaryValue(props.value)
    : new TextEncoder().encode(props.value)
})
/** 后端写入时不解码 base64，二进制值只读，避免把编码文本当内容写回。 */
const textEditable = computed(() => Boolean(props.editable) && !binary.value)
const dirty = computed(() => textEditable.value && draft.value !== baseline)

const imageMime = computed(() => {
  const data = binary.value ? bytes.value : null
  if (!data || data.length < 12) return ''
  const hex = Array.from(data.subarray(0, 12), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  if (hex.startsWith('89504e47')) return 'image/png'
  if (hex.startsWith('ffd8ff')) return 'image/jpeg'
  if (hex.startsWith('47494638')) return 'image/gif'
  if (hex.startsWith('424d')) return 'image/bmp'
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250')
    return 'image/webp'
  return ''
})
const imageUrl = computed(() =>
  imageMime.value && props.value
    ? `data:${imageMime.value};base64,${props.value.slice(7)}`
    : ''
)

/* ---------- JSON ---------- */

/** 保留数字原文，雪花 ID 这类大整数不会被 JSON.parse 丢精度。 */
class JsonNumber {
  constructor(readonly source: string) {}
}

type JsonReviver = (key: string, value: unknown) => unknown
const reviver = ((
  _key: string,
  value: unknown,
  context?: { source?: string }
) =>
  typeof value === 'number' && context?.source
    ? new JsonNumber(context.source)
    : value) as unknown as JsonReviver

const parsedJson = computed<{ value: unknown } | null>(() => {
  const text = props.value?.trim()
  if (!text || binary.value || !/^[[{]/u.test(text)) return null
  try {
    return { value: JSON.parse(text, reviver) }
  } catch {
    return null
  }
})

interface JsonLine {
  id: string
  depth: number
  key?: string
  text: string
  tone: string
  foldPath?: string
  collapsed?: boolean
}

const collapsed = reactive(new Set<string>())

function buildJsonLines(ignoreCollapse: boolean, limit: number): JsonLine[] {
  const lines: JsonLine[] = []
  const walk = (
    value: unknown,
    path: string,
    depth: number,
    key: string | undefined,
    comma: string
  ): void => {
    if (lines.length >= limit) return
    const id = path
    if (value !== null && typeof value === 'object' && !(value instanceof JsonNumber)) {
      const isArray = Array.isArray(value)
      const entries: Array<[string | undefined, unknown]> = isArray
        ? (value as unknown[]).map(item => [undefined, item])
        : Object.entries(value)
      const [open, close] = isArray ? ['[', ']'] : ['{', '}']
      if (!entries.length) {
        lines.push({ id, depth, key, text: `${open}${close}${comma}`, tone: 'text-txt-3' })
        return
      }
      if (!ignoreCollapse && collapsed.has(path)) {
        lines.push({
          id,
          depth,
          key,
          text: `${open} … ${close}${comma}  // ${entries.length}`,
          tone: 'text-txt-4',
          foldPath: path,
          collapsed: true,
        })
        return
      }
      lines.push({ id, depth, key, text: open, tone: 'text-txt-3', foldPath: path })
      entries.forEach(([childKey, child], index) =>
        walk(
          child,
          `${path}/${childKey ?? index}`,
          depth + 1,
          childKey,
          index < entries.length - 1 ? ',' : ''
        )
      )
      lines.push({ id: `${path}:end`, depth, text: `${close}${comma}`, tone: 'text-txt-3' })
      return
    }
    if (value instanceof JsonNumber)
      lines.push({ id, depth, key, text: `${value.source}${comma}`, tone: 'text-blue' })
    else
      lines.push({
        id,
        depth,
        key,
        text: `${JSON.stringify(value)}${comma}`,
        tone: typeof value === 'string' ? 'text-txt-2' : 'text-amber',
      })
  }
  if (parsedJson.value) walk(parsedJson.value.value, '$', 0, undefined, '')
  return lines
}

const jsonLines = computed(() =>
  activeTab.value === 'json' ? buildJsonLines(false, JSON_LINE_LIMIT) : []
)

function toggleFold(path: string): void {
  if (collapsed.has(path)) collapsed.delete(path)
  else collapsed.add(path)
}

/** 用展开后的行拼出格式化文本，放进草稿，由用户确认后应用。 */
function formatIntoDraft(): void {
  draft.value = buildJsonLines(true, Number.POSITIVE_INFINITY)
    .map(
      line =>
        `${'  '.repeat(line.depth)}${line.key === undefined ? '' : `${JSON.stringify(line.key)}: `}${line.text}`
    )
    .join('\n')
  activeTab.value = 'text'
}

/* ---------- 十六进制 ---------- */

const hexRows = computed(() => {
  if (activeTab.value !== 'hex' || !bytes.value) return []
  const data = bytes.value.subarray(0, HEX_LIMIT)
  const rows: Array<{ offset: string; hex: string; ascii: string }> = []
  for (let start = 0; start < data.length; start += 16) {
    const chunk = data.subarray(start, start + 16)
    rows.push({
      offset: start.toString(16).padStart(8, '0'),
      hex: Array.from(chunk, byte => byte.toString(16).padStart(2, '0')).join(
        ' '
      ),
      ascii: Array.from(chunk, byte =>
        byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.'
      ).join(''),
    })
  }
  return rows
})

/* ---------- 切换单元格与写回 ---------- */

const tabs = computed(() => {
  const list: Array<{ id: ViewerTab; label: string }> = []
  if (!binary.value) list.push({ id: 'text', label: t('文本') })
  if (parsedJson.value) list.push({ id: 'json', label: 'JSON' })
  if (imageMime.value) list.push({ id: 'image', label: t('图片') })
  if (bytes.value) list.push({ id: 'hex', label: t('十六进制') })
  return list
})

function defaultTab(): ViewerTab {
  if (imageMime.value) return 'image'
  if (binary.value) return 'hex'
  return parsedJson.value ? 'json' : 'text'
}

function flush(key: string | null | undefined): void {
  if (key && dirty.value) emit('save', draft.value, key)
}

watch(
  () => props.cellKey,
  (_, previous) => {
    // 这里 dirty 看的是新单元格的 editable；草稿只可能在可编辑时被改过，直接比较基线
    if (previous && draft.value !== baseline) emit('save', draft.value, previous)
    baseline = props.value ?? ''
    draft.value = baseline
    collapsed.clear()
    activeTab.value = defaultTab()
  }
)
watch(
  () => props.value,
  value => {
    baseline = value ?? ''
    draft.value = baseline
    if (!tabs.value.some(tab => tab.id === activeTab.value))
      activeTab.value = defaultTab()
  }
)
activeTab.value = defaultTab()
onBeforeUnmount(() => flush(props.cellKey))

function apply(): void {
  if (props.cellKey && dirty.value) emit('save', draft.value, props.cellKey)
}

function setNull(): void {
  if (!props.cellKey) return
  baseline = ''
  draft.value = ''
  emit('save', null, props.cellKey)
}

function revert(): void {
  draft.value = baseline
}

async function copyValue(): Promise<void> {
  await copyText(props.value ?? 'NULL')
  toast.success(t('已复制到剪贴板'))
}

const lengthLabel = computed(() => {
  if (props.value === null) return 'NULL'
  const size = bytes.value?.length ?? 0
  return binary.value
    ? t('{value0} 字节', { value0: size.toLocaleString() })
    : t('{value0} 字符 · {value1} 字节', {
        value0: props.value.length.toLocaleString(),
        value1: size.toLocaleString(),
      })
})
</script>

<template>
  <aside
    class="border-line-soft bg-panel flex w-80 shrink-0 flex-col border-l"
    :aria-label="t('值查看器')"
  >
    <header
      class="border-line-soft flex h-8 shrink-0 items-center gap-1 border-b pr-1 pl-2.5"
    >
      <span class="text-txt min-w-0 flex-1 truncate font-mono text-[11px]">{{
        column ?? t('值查看器')
      }}</span>
      <IconButton
        icon="lucide:copy"
        :size="12"
        :title="t('复制值')"
        :disabled="!cellKey"
        @click="copyValue"
      />
      <IconButton
        icon="lucide:x"
        :size="12"
        :title="t('关闭值查看器')"
        @click="emit('close')"
      />
    </header>

    <div
      v-if="!cellKey"
      class="text-txt-4 grid min-h-0 flex-1 place-items-center px-4 text-center text-xs"
    >
      {{ t('选中一个单元格查看完整值') }}
    </div>
    <template v-else>
      <div
        class="border-line-soft text-txt-4 flex shrink-0 flex-wrap items-center gap-x-2 border-b px-2.5 py-1 text-[10px]"
      >
        <span class="text-blue font-mono">{{ dataType }}</span>
        <span>{{ lengthLabel }}</span>
      </div>
      <div
        v-if="tabs.length > 1"
        class="border-line-soft flex shrink-0 items-center gap-0.5 border-b px-1.5 py-1"
      >
        <AppButton
          v-for="tab in tabs"
          :key="tab.id"
          variant="bare"
          :class="
            cn(
              'rounded px-2 py-0.5 text-[10.5px] transition-colors',
              activeTab === tab.id
                ? 'bg-raised text-txt'
                : 'text-txt-3 hover:text-txt-2'
            )
          "
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </AppButton>
      </div>

      <div
        v-if="value === null && !dirty && !textEditable"
        class="text-txt-4 grid min-h-0 flex-1 place-items-center text-xs italic"
      >
        NULL
      </div>
      <textarea
        v-else-if="activeTab === 'text'"
        v-model="draft"
        :readonly="!textEditable"
        :placeholder="value === null ? 'NULL' : ''"
        :aria-label="t('单元格值')"
        spellcheck="false"
        class="scroll-thin bg-terminal text-txt-2 placeholder:text-txt-4 min-h-0 flex-1 resize-none p-2.5 font-mono text-[11px] leading-5 outline-none select-text placeholder:italic"
      />
      <div
        v-else-if="activeTab === 'json'"
        class="scroll-thin bg-terminal min-h-0 flex-1 overflow-auto py-1.5 font-mono text-[11px] leading-5 select-text"
      >
        <div
          v-for="line in jsonLines"
          :key="line.id"
          class="flex whitespace-pre"
          :style="{ paddingLeft: `${line.depth * 14 + 18}px` }"
        >
          <button
            v-if="line.foldPath"
            type="button"
            class="text-txt-4 hover:text-txt -ml-4 w-4 shrink-0 outline-none"
            :aria-label="line.collapsed ? t('展开') : t('折叠')"
            :aria-expanded="!line.collapsed"
            @click="toggleFold(line.foldPath)"
          >
            <AppIcon
              :name="
                line.collapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'
              "
              :size="10"
              class="inline"
            />
          </button>
          <span
            v-if="line.key !== undefined"
            class="text-violet"
            >{{ JSON.stringify(line.key) }}<span class="text-txt-4"
              >:&nbsp;</span
            ></span
          >
          <span :class="line.tone">{{ line.text }}</span>
        </div>
        <p
          v-if="jsonLines.length >= JSON_LINE_LIMIT"
          class="text-amber px-2.5 pt-1 text-[10px]"
        >
          {{ t('内容过长，只显示前 {value0} 行', { value0: JSON_LINE_LIMIT }) }}
        </p>
      </div>
      <div
        v-else-if="activeTab === 'hex'"
        class="scroll-thin bg-terminal min-h-0 flex-1 overflow-auto p-2 font-mono text-[10px] leading-4 whitespace-pre select-text"
      >
        <div
          v-for="row in hexRows"
          :key="row.offset"
          class="flex gap-2"
        >
          <span class="text-txt-4">{{ row.offset }}</span>
          <span class="text-txt-2">{{ row.hex.padEnd(47) }}</span>
          <span class="text-txt-3">{{ row.ascii }}</span>
        </div>
        <p
          v-if="(bytes?.length ?? 0) > HEX_LIMIT"
          class="text-amber pt-1"
        >
          {{ t('只显示前 {value0} 字节', { value0: HEX_LIMIT }) }}
        </p>
      </div>
      <div
        v-else
        class="scroll-thin bg-terminal grid min-h-0 flex-1 place-items-center overflow-auto p-2"
      >
        <img
          :src="imageUrl"
          :alt="column"
          class="max-h-full max-w-full object-contain"
        />
      </div>

      <footer
        v-if="editable"
        class="border-line-soft flex shrink-0 flex-wrap items-center gap-1.5 border-t px-2 py-1.5"
      >
        <AppButton
          size="sm"
          :disabled="!dirty"
          @click="apply"
        >
          {{ t('应用') }}
        </AppButton>
        <AppButton
          size="sm"
          :disabled="!dirty"
          @click="revert"
        >
          {{ t('还原') }}
        </AppButton>
        <AppButton
          size="sm"
          :disabled="!nullable || value === null"
          :title="nullable ? undefined : t('该字段不允许为 NULL')"
          @click="setNull"
        >
          {{ t('设为 NULL') }}
        </AppButton>
        <AppButton
          v-if="activeTab === 'json' && textEditable"
          size="sm"
          @click="formatIntoDraft"
        >
          {{ t('格式化') }}
        </AppButton>
      </footer>
    </template>
  </aside>
</template>
