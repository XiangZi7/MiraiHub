<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import {
  SKIN_COLOR_FIELDS,
  readSkinColors,
  type SkinColorKey,
} from '@/utils/skin-colors'
import type { SkinSettings } from '@/utils/skin'

const { t } = useI18n()

const props = defineProps<{ values: SkinSettings }>()
const emit = defineEmits<{ update: [patch: Partial<SkinSettings>] }>()
const colors = computed(() => readSkinColors(props.values.skinCustomColors))
const fields = computed(() =>
  SKIN_COLOR_FIELDS.map(field => ({
    ...field,
    value:
      colors.value[field.key] ??
      (props.values.skinBase === 'kuriyama-mirai' ? field.light : field.dark),
  }))
)

function updateColor(key: SkinColorKey, event: Event): void {
  emit('update', {
    skinCustomColors: JSON.stringify({
      ...colors.value,
      [key]: (event.target as HTMLInputElement).value,
    }),
  })
}
function resetColor(key: SkinColorKey): void {
  const next = { ...colors.value }
  delete next[key]
  emit('update', { skinCustomColors: JSON.stringify(next) })
}
</script>

<template>
  <section
    class="color-controls"
    :aria-label="t('skin.colors')"
  >
    <div class="color-heading">
      <span>{{ t('skin.colors') }}</span>
      <AppButton
        size="sm"
        @click="emit('update', { skinCustomColors: '{}', skinCustomCss: '' })"
        >{{ t('skin.resetColors') }}</AppButton
      >
    </div>
    <div class="color-grid">
      <div
        v-for="field in fields"
        :key="field.key"
        class="color-field"
      >
        <label>
          <input
            type="color"
            :value="field.value"
            :aria-label="t(`skin.color.${field.key}`)"
            @input="updateColor(field.key, $event)"
          />
          <span
            >{{ t(`skin.color.${field.key}`)
            }}<small>{{ field.value.toUpperCase() }}</small></span
          >
        </label>
        <button
          type="button"
          :disabled="!colors[field.key]"
          :aria-label="
            t('skin.resetColor', { name: t(`skin.color.${field.key}`) })
          "
          @click="resetColor(field.key)"
        >
          {{ t('common.reset') }}
        </button>
      </div>
    </div>
    <p>{{ t('skin.colorHint') }}</p>
  </section>
</template>

<style scoped>
.color-controls {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-panel);
}
.color-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--color-txt);
}
.color-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
  margin-top: 14px;
}
.color-field,
label {
  display: flex;
  align-items: center;
  gap: 10px;
}
.color-field {
  justify-content: space-between;
}
label {
  font-size: 11px;
  color: var(--color-txt-2);
  cursor: pointer;
}
input {
  width: 34px;
  height: 34px;
  padding: 2px;
  border: 1px solid var(--color-line-strong);
  border-radius: 6px;
  background: var(--color-card);
  cursor: pointer;
}
small {
  display: block;
  margin-top: 3px;
  font: 9px var(--font-mono);
  color: var(--color-txt-3);
}
button {
  color: var(--color-accent);
  font-size: 10px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.35;
  cursor: default;
}
input:focus-visible,
button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
}
p {
  margin-top: 12px;
  color: var(--color-txt-3);
  font-size: 10px;
  line-height: 1.7;
}
@container settings (max-width: 620px) {
  .color-grid {
    grid-template-columns: 1fr;
  }
}
</style>
