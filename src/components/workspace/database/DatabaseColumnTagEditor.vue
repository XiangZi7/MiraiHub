<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, reactive, shallowRef, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCollapse from '@/components/ui/AppCollapse.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { CONNECTION_TAG_COLORS } from '@/constants/connection'
import {
  autoFillCandidates,
  defaultTagColor,
  normalizeTagConfig,
  tagColorCss,
  tagLabel,
} from '@/composables/useDatabaseColumnTags'
import type { ConnectionTagColor } from '@/types/connection'
import type { ColumnTagConfig, ColumnTagStyle } from '@/types/database'
import { cn } from '@/utils/cn'
import DatabaseCellTag from './DatabaseCellTag.vue'

const { t } = useI18n()

/**
 * 列标签化规则编辑器。原生设置窗口与浏览器预览的页内浮层共用这一份表单，
 * 宿主只负责取目标列、把结果交回主窗口。
 */
const props = withDefaults(
  defineProps<{
    column: string
    initial?: ColumnTagConfig | null
    /** 当前页里该列出现过的值，用于一键填充。 */
    sampleValues?: readonly string[]
    /** 正在提交，禁用按钮避免重复点击。 */
    saving?: boolean
  }>(),
  { initial: null, sampleValues: () => [], saving: false }
)

const emit = defineEmits<{
  cancel: []
  submit: [config: ColumnTagConfig | null]
}>()

interface RuleDraft {
  id: number
  value: string
  label: string
  color: ConnectionTagColor
}

interface Example {
  id: string
  label: string
  style: ColumnTagStyle
  rules: Array<Omit<RuleDraft, 'id'>>
}

let nextId = 1
const state = reactive({
  style: 'badge' as ColumnTagStyle,
  rules: [] as RuleDraft[],
})
/** 第一次给列配标签时展开说明；改已有规则的人通常已经会用了。 */
const helpOpen = shallowRef(!props.initial)

const styleOptions = computed<
  Array<{ id: ColumnTagStyle; label: string; hint: string }>
>(() => [
  { id: 'badge', label: t('徽章'), hint: t('带底色的标签，适合方法、分类') },
  { id: 'dot', label: t('圆点'), hint: t('彩色圆点加原文，适合状态码') },
])

const examples = computed<Example[]>(() => [
  {
    id: 'switch',
    label: t('启用 / 禁用'),
    style: 'badge',
    rules: [
      { value: '1', label: t('启用'), color: 'green' },
      { value: '0', label: t('禁用'), color: 'gray' },
    ],
  },
  {
    id: 'method',
    label: t('HTTP 方法'),
    style: 'badge',
    rules: [
      { value: 'GET', label: '', color: 'blue' },
      { value: 'POST', label: '', color: 'violet' },
      { value: 'PUT', label: '', color: 'amber' },
      { value: 'DELETE', label: '', color: 'red' },
    ],
  },
  {
    id: 'status',
    label: t('HTTP 状态码'),
    style: 'dot',
    rules: [
      { value: '200', label: '', color: 'green' },
      { value: '404', label: '', color: 'amber' },
      { value: '500', label: '', color: 'red' },
    ],
  },
])

const validRules = computed(() =>
  state.rules.filter(rule => rule.value.trim().length > 0)
)
const canSubmit = computed(() => validRules.value.length > 0 && !props.saving)
const unusedSamples = computed(() => {
  const used = new Set(state.rules.map(rule => rule.value.trim()))
  return props.sampleValues.filter(value => !used.has(value))
})

function makeRule(value = '', index = state.rules.length): RuleDraft {
  return { id: nextId++, value, label: '', color: defaultTagColor(index) }
}

function addRule(): void {
  state.rules.push(makeRule())
}

function fillFromSamples(
  values: readonly string[] = unusedSamples.value
): void {
  for (const value of values) state.rules.push(makeRule(value))
}

function applyExample(example: Example): void {
  const used = new Set(state.rules.map(rule => rule.value.trim()))
  // 空白草稿行让位给示例，避免表里留一行没用的空规则。
  state.rules = state.rules.filter(rule => rule.value.trim())
  for (const rule of example.rules)
    if (!used.has(rule.value)) state.rules.push({ id: nextId++, ...rule })
  state.style = example.style
}

function removeRule(id: number): void {
  const index = state.rules.findIndex(rule => rule.id === id)
  if (index >= 0) state.rules.splice(index, 1)
}

function reset(): void {
  state.style = props.initial?.style ?? 'badge'
  state.rules = (props.initial?.rules ?? []).map((rule, index) => ({
    id: nextId++,
    value: rule.value,
    label: rule.label,
    color: rule.color ?? defaultTagColor(index),
  }))
  // 第一次给枚举列配标签时直接把当前页的取值带进来，通常改改颜色就能用；
  // 哈希、长文本这类每行不同的值不会被带入。
  if (!state.rules.length)
    fillFromSamples(autoFillCandidates(props.sampleValues))
  if (!state.rules.length) addRule()
}

function submit(): void {
  if (!canSubmit.value) return
  emit(
    'submit',
    normalizeTagConfig({
      style: state.style,
      rules: validRules.value.map(({ value, label, color }) => ({
        value,
        label,
        color,
      })),
    })
  )
}

watch(() => props.column, reset, { immediate: true })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3.5">
      <fieldset class="grid shrink-0 gap-1.5">
        <legend class="text-txt-2 text-[11px] font-medium">
          {{ t('标签样式') }}
        </legend>
        <div
          class="grid grid-cols-2 gap-2"
          role="radiogroup"
          :aria-label="t('标签样式')"
        >
          <button
            v-for="option in styleOptions"
            :key="option.id"
            type="button"
            role="radio"
            :aria-checked="state.style === option.id"
            :class="
              cn(
                'border-line bg-panel hover:bg-hover flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                state.style === option.id &&
                  'border-violet/55 bg-violet/8 hover:bg-violet/10'
              )
            "
            @click="state.style = option.id"
          >
            <DatabaseCellTag
              :label="option.id === 'badge' ? 'POST' : '200'"
              :color="
                option.id === 'badge'
                  ? 'var(--color-violet)'
                  : 'var(--color-success)'
              "
              :variant="option.id"
            />
            <span class="min-w-0">
              <span class="text-txt block text-[11.5px]">{{
                option.label
              }}</span>
              <span class="text-txt-4 block text-[10px]">{{
                option.hint
              }}</span>
            </span>
          </button>
        </div>
      </fieldset>

      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <span class="text-txt-2 text-[11px] font-medium">{{
          t('取值规则')
        }}</span>
        <span class="text-txt-4 text-[10px]">{{
          t('单元格文本与“值”完全一致时显示为标签')
        }}</span>
        <div class="flex-1" />
        <IconButton
          icon="lucide:circle-help"
          :size="13"
          :class="helpOpen ? 'text-violet' : 'text-txt-4'"
          :title="t('怎么用')"
          @click="helpOpen = !helpOpen"
        />
        <AppButton
          v-if="unusedSamples.length"
          size="sm"
          :title="t('把当前页出现过的值加入规则')"
          @click="fillFromSamples()"
        >
          <AppIcon
            name="lucide:list-plus"
            :size="11"
          />
          {{ t('从当前页取值') }} ({{ unusedSamples.length }})
        </AppButton>
        <AppButton
          size="sm"
          @click="addRule"
        >
          <AppIcon
            name="lucide:plus"
            :size="11"
          />
          {{ t('添加规则') }}
        </AppButton>
      </div>

      <AppCollapse
        :open="helpOpen"
        class="shrink-0"
      >
        <section
          class="border-line-soft bg-card/70 rounded-lg border px-3 py-2.5 text-[10.5px]"
        >
          <div class="text-txt-2 flex items-center gap-1.5 font-medium">
            <AppIcon
              name="lucide:lightbulb"
              :size="12"
              class="text-amber"
            />
            {{ t('怎么用') }}
          </div>
          <ul class="text-txt-3 mt-1.5 grid list-disc gap-1 pl-4">
            <li>
              {{
                t(
                  '值：单元格里的原始文本，需完全一致（区分大小写），例如 200、POST、1'
                )
              }}
            </li>
            <li>
              {{
                t(
                  '显示文字：标签上展示的文字，留空则显示原值，例如把 1 显示为“启用”'
                )
              }}
            </li>
            <li>
              {{
                t('颜色：同一列可给不同值配不同颜色，未匹配的值仍按原样显示')
              }}
            </li>
          </ul>
          <div class="mt-2.5 flex flex-wrap items-center gap-2">
            <span class="text-txt-4">{{ t('范例') }}</span>
            <button
              v-for="example in examples"
              :key="example.id"
              type="button"
              class="border-line bg-panel hover:bg-hover hover:border-line-strong flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 transition-colors"
              :title="t('点击填入这组规则')"
              @click="applyExample(example)"
            >
              <AppIcon
                name="lucide:plus"
                :size="10"
                class="text-txt-4"
              />
              <span class="text-txt-3">{{ example.label }}</span>
              <DatabaseCellTag
                v-for="rule in example.rules"
                :key="rule.value"
                :label="tagLabel(rule)"
                :color="tagColorCss(rule.color)"
                :variant="example.style"
              />
            </button>
          </div>
        </section>
      </AppCollapse>

      <div
        class="border-line-soft scroll-thin min-h-32 flex-1 overflow-auto rounded-lg border"
      >
        <table class="w-full table-fixed border-collapse text-left text-[11px]">
          <colgroup>
            <col style="width: 28%" />
            <col style="width: 24%" />
            <col style="width: 180px" />
            <col />
            <col style="width: 32px" />
          </colgroup>
          <thead class="database-glass-header database-glass-header--card database-glass-header--sticky text-txt-3">
            <tr>
              <th
                class="border-line-soft border-b px-2.5 py-1.5 font-medium whitespace-nowrap"
              >
                {{ t('值') }}
              </th>
              <th
                class="border-line-soft border-b px-2.5 py-1.5 font-medium whitespace-nowrap"
              >
                {{ t('显示文字') }}
              </th>
              <th
                class="border-line-soft border-b px-2.5 py-1.5 font-medium whitespace-nowrap"
              >
                {{ t('颜色') }}
              </th>
              <th
                class="border-line-soft border-b px-2.5 py-1.5 font-medium whitespace-nowrap"
              >
                {{ t('预览') }}
              </th>
              <th class="border-line-soft border-b" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="rule in state.rules"
              :key="rule.id"
              class="hover:bg-hover"
            >
              <td class="border-line-soft border-b p-0.5">
                <AppInput
                  v-model="rule.value"
                  variant="cell"
                  monospace
                  :placeholder="t('如 200、POST')"
                />
              </td>
              <td class="border-line-soft border-b p-0.5">
                <AppInput
                  v-model="rule.label"
                  variant="cell"
                  :placeholder="t('留空显示原值')"
                />
              </td>
              <td class="border-line-soft border-b px-2 py-1">
                <div
                  class="flex items-center gap-0.75"
                  role="radiogroup"
                  :aria-label="t('标签颜色')"
                >
                  <button
                    v-for="option in CONNECTION_TAG_COLORS"
                    :key="option.id"
                    type="button"
                    role="radio"
                    :aria-checked="rule.color === option.id"
                    :title="t(option.label)"
                    :class="[
                      'tag-color-option',
                      rule.color === option.id && 'tag-color-option-active',
                    ]"
                    :style="{ '--tag-color': option.css }"
                    @click="rule.color = option.id"
                  />
                </div>
              </td>
              <td class="border-line-soft overflow-hidden border-b px-2.5 py-1">
                <DatabaseCellTag
                  v-if="rule.value.trim()"
                  :label="tagLabel(rule)"
                  :color="tagColorCss(rule.color)"
                  :variant="state.style"
                />
                <span
                  v-else
                  class="text-txt-4"
                  >—</span
                >
              </td>
              <td class="border-line-soft border-b p-0.5 text-center">
                <IconButton
                  icon="lucide:x"
                  :size="11"
                  class="text-txt-4 hover:text-danger size-6"
                  :title="t('移除规则')"
                  @click="removeRule(rule.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p
          v-if="!state.rules.length"
          class="text-txt-4 px-3 py-6 text-center text-[11px]"
        >
          {{ t('还没有规则，先添加一条或从当前页取值') }}
        </p>
      </div>
    </div>

    <footer
      class="border-line-soft flex shrink-0 items-center gap-2 border-t px-4 py-3"
    >
      <AppButton
        v-if="initial"
        variant="danger"
        size="sm"
        :disabled="saving"
        @click="emit('submit', null)"
      >
        <AppIcon
          name="lucide:tag-x"
          :size="11"
        />
        {{ t('取消标签化') }}
      </AppButton>
      <div class="flex-1" />
      <AppButton
        :disabled="saving"
        @click="emit('cancel')"
      >
        {{ t('取消') }}
      </AppButton>
      <AppButton
        variant="primary"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ saving ? t('处理中…') : t('保存') }}
      </AppButton>
    </footer>
  </div>
</template>

<style scoped>
.tag-color-option {
  position: relative;
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  outline: none;
  transition:
    border-color 150ms ease,
    background-color 150ms ease;
}

.tag-color-option::before {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: var(--tag-color);
  content: '';
}

.tag-color-option:hover,
.tag-color-option:focus-visible {
  background: var(--color-hover);
}

.tag-color-option-active {
  border-color: color-mix(
    in oklch,
    var(--tag-color) 40%,
    var(--color-line-strong)
  );
  background: color-mix(in oklch, var(--tag-color) 10%, var(--color-raised));
}

@media (prefers-reduced-motion: reduce) {
  .tag-color-option {
    transition: none;
  }
}
</style>
