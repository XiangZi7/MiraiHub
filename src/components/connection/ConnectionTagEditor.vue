<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { CONNECTION_TAG_COLORS } from '@/constants/connection'
import type { ConnectionTagColor, ConnectionTagDefinition } from '@/types/connection'

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
const suggestions = computed(() => props.availableTags.filter(
  tag => !selectedKeys.value.has(tag.name.toLocaleLowerCase()),
))

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
        <span
          v-for="tag in selectedTags"
          :key="tag"
          class="tag-chip"
          :style="{ '--tag-color': tagColor(tag) }"
        >
          <span class="max-w-28 truncate">{{ tag }}</span>
          <button type="button" :aria-label="`移除标签 ${tag}`" @click="removeTag(tag)">
            <AppIcon name="lucide:x" :size="11" />
          </button>
        </span>
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
        <button
          v-for="tag in suggestions"
          :key="tag.name"
          type="button"
          class="tag-suggestion"
          :style="{ '--tag-color': tagColor(tag.name) }"
          @mousedown.prevent
          @click="addTag(tag.name)"
        >
          <AppIcon name="lucide:plus" :size="10" />
          {{ tag.name }}
        </button>
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
  min-height: 36px;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-panel) 88%, transparent);
  padding: 5px 7px;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.tag-input-shell:focus-within {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-violet) 12%, transparent);
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

.tag-chip,
.tag-suggestion {
  display: inline-flex;
  cursor: pointer;
  align-items: center;
  gap: 3px;
  border: 1px solid color-mix(in oklch, var(--tag-color) 42%, transparent);
  border-radius: 5px;
  background: color-mix(in oklch, var(--tag-color) 12%, transparent);
  padding: 2px 5px;
  color: var(--tag-color);
  font-size: 10px;
  line-height: 15px;
}

.tag-chip > button {
  display: grid;
  cursor: pointer;
  place-items: center;
  border-radius: 3px;
  opacity: 0.72;
}

.tag-chip > button:hover,
.tag-chip > button:focus-visible,
.tag-suggestion:hover,
.tag-suggestion:focus-visible {
  background: color-mix(in oklch, var(--tag-color) 18%, transparent);
  opacity: 1;
  outline: none;
}

.tag-color-option {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  cursor: pointer;
  border: 2px solid transparent;
  border-radius: 50%;
  background: var(--tag-color);
  outline: none;
  transition: box-shadow 150ms ease, transform 150ms ease;
}

.tag-color-option:hover,
.tag-color-option:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--tag-color) 22%, transparent);
}

.tag-color-option-active {
  border-color: color-mix(in oklch, white 78%, var(--tag-color));
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--tag-color) 26%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .tag-input-shell,
  .tag-color-option {
    transition: none;
  }
}
</style>
