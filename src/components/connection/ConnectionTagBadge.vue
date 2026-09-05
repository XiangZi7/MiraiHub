<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'

withDefaults(
  defineProps<{
    label: string
    color: string
    compact?: boolean
    removable?: boolean
    selectable?: boolean
  }>(),
  {
    compact: false,
    removable: false,
    selectable: false,
  }
)

const emit = defineEmits<{
  remove: []
  select: []
}>()
</script>

<template>
  <component
    :is="selectable ? 'button' : 'span'"
    :type="selectable ? 'button' : undefined"
    :class="[
      'connection-tag-badge',
      compact && 'connection-tag-badge-compact',
      selectable && 'connection-tag-badge-selectable',
    ]"
    :style="{ '--tag-color': color }"
    @click="selectable && emit('select')"
  >
    <span
      class="connection-tag-dot"
      aria-hidden="true"
    />
    <span class="connection-tag-label">{{ label }}</span>
    <button
      v-if="removable"
      type="button"
      class="connection-tag-remove"
      :aria-label="`移除标签 ${label}`"
      @click.stop="emit('remove')"
    >
      <AppIcon
        name="lucide:x"
        :size="10"
      />
    </button>
  </component>
</template>

<style scoped>
.connection-tag-badge {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  height: 22px;
  align-items: center;
  gap: 5px;
  border: 1px solid color-mix(in oklch, var(--tag-color) 12%, var(--color-line));
  border-radius: 5px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 2.5%), transparent),
    color-mix(in oklch, var(--tag-color) 6%, var(--color-card));
  padding: 0 4px 0 6px;
  color: var(--color-txt-2);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 3%);
  font-size: 10px;
  line-height: 1;
}

.connection-tag-dot {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--tag-color);
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--tag-color) 11%, transparent);
}

.connection-tag-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-tag-remove {
  display: grid;
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  cursor: pointer;
  place-items: center;
  border-radius: 3px;
  color: var(--color-txt-4);
  outline: none;
  transition:
    color 150ms ease,
    background-color 150ms ease;
}

.connection-tag-remove:hover,
.connection-tag-remove:focus-visible {
  background: var(--color-hover);
  color: var(--color-txt);
}

.connection-tag-badge-selectable {
  cursor: pointer;
  outline: none;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease;
}

.connection-tag-badge-selectable:hover,
.connection-tag-badge-selectable:focus-visible {
  border-color: color-mix(
    in oklch,
    var(--tag-color) 22%,
    var(--color-line-strong)
  );
  background-color: color-mix(
    in oklch,
    var(--tag-color) 9%,
    var(--color-raised)
  );
  color: var(--color-txt);
}

.connection-tag-badge-compact {
  height: 17px;
  gap: 4px;
  border-color: color-mix(
    in oklch,
    var(--tag-color) 9%,
    var(--color-line-soft)
  );
  border-radius: 4px;
  background: color-mix(in oklch, var(--tag-color) 4%, var(--color-card));
  padding: 0 5px;
  color: var(--color-txt-3);
  font-size: 8.5px;
}

.connection-tag-badge-compact .connection-tag-dot {
  width: 4px;
  height: 4px;
  box-shadow: none;
}

@media (prefers-reduced-motion: reduce) {
  .connection-tag-remove,
  .connection-tag-badge-selectable {
    transition: none;
  }
}
</style>
