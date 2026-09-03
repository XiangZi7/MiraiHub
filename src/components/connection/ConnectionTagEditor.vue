<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue'
import { CONNECTION_TAG_COLORS } from '@/constants/connection'
import type { ConnectionTagColor, ConnectionTagDefinition } from '@/types/connection'
import ConnectionTagBadge from './ConnectionTagBadge.vue'

const props = withDefaults(defineProps<{
  availableTags?: readonly ConnectionTagDefinition[]
}>(), {
  availableTags: () => [],
})

const tags = defineModel<string>({ required: true })
const color = defineModel<ConnectionTagColor>('color', { required: true })
const draft = shallowRef('')
const inputId = useId()

const selectedTags = computed(() => tags.value
  .split(/[,，]/)
  .map(tag => tag.trim())
  .filter(Boolean))

const selectedKeys = computed(() => new Set(selectedTags.value.map(tag => tag.toLocaleLowerCase())))
const suggestions = computed(() => {
  const query = draft.value.trim().toLocaleLowerCase()
  return props.availableTags
    .filter(tag => !selectedKeys.value.has(tag.name.toLocaleLowerCase()))
    .filter(tag => !query || tag.name.toLocaleLowerCase().includes(query))
    .slice(0, 12)
})

function definitionOf(name: string): ConnectionTagDefinition | undefined {
  const key = name.toLocaleLowerCase()
  return props.availableTags.find(tag => tag.name.toLocaleLowerCase() === key)
}

function tagColor(name: string): string {
  const tone = definitionOf(name)?.color ?? color.value
  return CONNECTION_TAG_COLORS.find(option => option.id === tone)?.css ?? 'var(--color-accent)'
}

function addTag(rawName = draft.value): void {
  const name = rawName.trim().replace(/[,，]+$/, '').trim()
  if (!name || selectedKeys.value.has(name.toLocaleLowerCase())) {
    draft.value = ''
    return
  }

  const definition = definitionOf(name)
  if (definition)
    color.value = definition.color

  tags.value = [...selectedTags.value, definition?.name ?? name].join(', ')
  draft.value = ''
}

function removeTag(name: string): void {
  tags.value = selectedTags.value.filter(tag => tag !== name).join(', ')
}

function handleInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
    event.preventDefault()
    addTag()
    return
  }

  if (event.key === 'Backspace' && !draft.value && selectedTags.value.length)
    removeTag(selectedTags.value.at(-1) ?? '')
}
</script>

<template>
  <div class="grid gap-2.5">
    <div class="space-y-1.5">
      <label :for="inputId" class="block text-[11px] font-medium text-txt-2">Tags</label>
      <div class="tag-input-shell">
        <ConnectionTagBadge
          v-for="tag in selectedTags"
          :key="tag"
          :label="tag"
          :color="tagColor(tag)"
          removable
          @remove="removeTag(tag)"
        />
        <input
          :id="inputId"
          v-model="draft"
          class="tag-input"
          placeholder="输入后按 Enter 创建"
          autocomplete="off"
          @keydown="handleInputKeydown"
          @blur="addTag()"
        >
      </div>
    </div>

    <div v-if="suggestions.length" class="space-y-1.5">
      <p class="text-[10px] text-txt-4">
        共享标签 · 点击即可使用
      </p>
      <div class="flex flex-wrap gap-1.5">
        <ConnectionTagBadge
          v-for="tag in suggestions"
          :key="tag.name"
          :label="tag.name"
          :color="tagColor(tag.name)"
          selectable
          @mousedown.prevent
          @select="addTag(tag.name)"
        />
      </div>
    </div>

    <fieldset class="space-y-1.5">
      <legend class="block text-[11px] font-medium text-txt-2">
        Tag Color
      </legend>
      <div class="flex min-h-7 items-center gap-2" role="radiogroup" aria-label="标签颜色">
        <button
          v-for="option in CONNECTION_TAG_COLORS"
          :key="option.id"
          type="button"
          role="radio"
          :aria-checked="color === option.id"
          :aria-label="option.label"
          :title="option.label"
          :class="['tag-color-option', color === option.id && 'tag-color-option-active']"
          :style="{ '--tag-color': option.css }"
          @click="color = option.id"
        />
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.tag-input-shell {
  display: flex;
  min-height: 34px;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-panel);
  padding: 5px 8px;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.tag-input-shell:focus-within {
  border-color: var(--color-line-strong);
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-violet) 9%, transparent);
}

.tag-input {
  min-width: 130px;
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--color-txt);
  font-size: 12px;
  outline: none;
}

.tag-input::placeholder {
  color: var(--color-txt-4);
}

.tag-color-option {
  position: relative;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  outline: none;
  transition: border-color 150ms ease, background-color 150ms ease;
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
  border-color: color-mix(in oklch, var(--tag-color) 30%, var(--color-line-strong));
  background: color-mix(in oklch, var(--tag-color) 8%, var(--color-raised));
}

.tag-color-option-active::before {
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--tag-color) 13%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .tag-input-shell,
  .tag-color-option {
    transition: none;
  }
}
</style>
