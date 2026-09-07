<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, nextTick, reactive, useId, useTemplateRef, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import { useAgentModels } from '@/composables/useAgentModels'
import type { AgentApiFormat } from '@/types/agent'

const { t } = useI18n()

const props = defineProps<{
  profileId?: string
  apiFormat: AgentApiFormat
  baseUrl: string
  apiKey: string
  clearKey: boolean
  disabled: boolean
}>()
const model = defineModel<string>({ required: true })
const { models, fetching, error, message, fetchModels } = useAgentModels(
  () => ({
    profileId: props.profileId,
    apiFormat: props.apiFormat,
    baseUrl: props.baseUrl,
    apiKey: props.apiKey,
    clearKey: props.clearKey,
  })
)
const state = reactive({ open: false, search: '', active: -1 })
const input = useTemplateRef<HTMLInputElement>('input')
const menu = useTemplateRef<HTMLElement>('menu')
const id = useId()
const listId = `${id}-models`
const visibleModels = computed(() => {
  const term = state.search.trim().toLocaleLowerCase()
  return models.value.filter(name => name.toLocaleLowerCase().includes(term))
})
const expanded = computed(
  () => state.open && models.value.length > 0 && !props.disabled
)
const activeId = computed(() =>
  expanded.value && state.active >= 0 ? `${listId}-${state.active}` : undefined
)
watch([models, () => props.disabled], () => {
  state.open = false
})
watch(
  visibleModels,
  () => {
    state.active = -1
  },
  { flush: 'sync' }
)
watch(
  () => state.active,
  async () => {
    await nextTick()
    menu.value
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }
)

function openModels(): void {
  if (props.disabled) return
  state.search = ''
  state.active = -1
  state.open = true
}
async function fetch(): Promise<void> {
  if (props.disabled) return
  if (await fetchModels()) {
    await nextTick()
    if (props.disabled) return
    input.value?.focus()
    openModels()
  }
}
function select(name: string): void {
  model.value = name
  state.open = false
  input.value?.focus()
}
function filter(): void {
  state.search = model.value
  state.active = -1
  state.open = true
}
function keydown(event: KeyboardEvent): void {
  if (
    (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
    models.value.length
  ) {
    event.preventDefault()
    if (!expanded.value) openModels()
    const count = visibleModels.value.length
    if (count)
      state.active =
        state.active < 0
          ? event.key === 'ArrowDown'
            ? 0
            : count - 1
          : (state.active + (event.key === 'ArrowDown' ? 1 : -1) + count) %
            count
  } else if (event.key === 'Enter' && expanded.value && state.active >= 0) {
    event.preventDefault()
    const name = visibleModels.value[state.active]
    if (name) select(name)
  } else if (event.key === 'Escape' && expanded.value) {
    event.preventDefault()
    event.stopPropagation()
    state.open = false
  }
}
function focusout(event: FocusEvent): void {
  if (
    !(event.currentTarget as HTMLElement).contains(
      event.relatedTarget as Node | null
    )
  )
    state.open = false
}
</script>

<template>
  <div
    class="ai-model-field"
    @focusout="focusout"
  >
    <label :for="id">{{ t('模型名称') }}</label>
    <div class="ai-model-row">
      <input
        :id="id"
        ref="input"
        v-model="model"
        type="text"
        role="combobox"
        :placeholder="t('输入服务商提供、支持工具调用的模型 ID')"
        autocomplete="off"
        spellcheck="false"
        maxlength="200"
        :disabled="disabled"
        :aria-expanded="expanded"
        aria-autocomplete="list"
        :aria-controls="expanded ? listId : undefined"
        :aria-activedescendant="activeId"
        :aria-describedby="error || message ? `${id}-feedback` : undefined"
        @click="openModels"
        @input="filter"
        @keydown="keydown"
      />
      <AppButton
        :disabled="disabled || fetching || !baseUrl.trim()"
        :aria-busy="fetching"
        @click="fetch"
      >
        {{ fetching ? t('获取中…') : t('获取') }}
      </AppButton>
      <ul
        v-if="expanded"
        :id="listId"
        ref="menu"
        role="listbox"
        :aria-label="t('可用模型')"
        class="ai-model-menu scroll-thin"
      >
        <li
          v-for="(name, index) in visibleModels"
          :id="`${listId}-${index}`"
          :key="name"
          role="option"
          :aria-selected="name === model"
          :data-active="state.active === index"
          @mousedown.prevent
          @click="select(name)"
          @mousemove="state.active = index"
        >
          {{ name }}
        </li>
        <li
          v-if="!visibleModels.length"
          role="presentation"
          class="text-txt-4"
        >
          {{ t('没有匹配模型，可继续手动输入') }}
        </li>
      </ul>
    </div>
    <p
      v-if="error || message"
      :id="`${id}-feedback`"
      :role="error ? 'alert' : 'status'"
      :class="['ai-model-feedback', error ? 'text-danger' : 'text-txt-4']"
    >
      {{ error || message }}
    </p>
  </div>
</template>

<style scoped>
.ai-model-field {
  display: grid;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  color: var(--color-txt-2);
}
.ai-model-row {
  position: relative;
  display: flex;
  gap: 8px;
  min-width: 0;
}
.ai-model-row input {
  box-sizing: border-box;
  flex: 1;
  width: 0;
  min-width: 0;
  min-height: 36px;
  border: 1px solid var(--color-line);
  background: var(--color-input, #ffffff04);
  padding: 9px 10px;
  border-radius: 6px;
  outline: none;
  font-size: 12px;
  color: var(--color-txt);
}
.ai-model-row input:focus {
  border-color: var(--color-accent);
}
.ai-model-row > :deep(button) {
  flex: none;
}
.ai-model-menu {
  position: absolute;
  z-index: 5;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px;
  border: 1px solid var(--color-line-strong);
  border-radius: 6px;
  background: var(--color-panel);
  box-shadow: var(--shadow-pop);
}
.ai-model-menu li {
  padding: 8px;
  border-radius: 4px;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.ai-model-menu li[data-active='true'] {
  background: var(--color-hover);
}
.ai-model-menu li[aria-selected='true'] {
  color: var(--color-accent);
}
.ai-model-feedback {
  font-size: 10px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
