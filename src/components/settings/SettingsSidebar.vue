<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { SETTINGS_PAGES } from '@/constants/settings'
import type { SettingsPageId } from '@/types/settings'

defineProps<{
  active: SettingsPageId
}>()

const emit = defineEmits<{
  select: [page: SettingsPageId]
}>()
</script>

<template>
  <aside class="settings-sidebar scroll-thin">
    <nav class="space-y-1 p-3" aria-label="设置分类">
      <button
        v-for="page in SETTINGS_PAGES"
        :key="page.id"
        type="button"
        :aria-current="active === page.id ? 'page' : undefined"
        :class="['settings-nav-item', active === page.id && 'settings-nav-item-active']"
        @click="emit('select', page.id)"
      >
        <AppIcon :name="page.icon" :size="14" class="shrink-0" />
        <span>{{ page.label }}</span>
      </button>
    </nav>
  </aside>
</template>

<style scoped>
.settings-sidebar {
  overflow-y: auto;
  width: 25%;
  min-width: 100px;
  max-width: 174px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-line-soft);
  background: color-mix(in oklch, var(--color-panel) 50%, transparent);
}

.settings-nav-item {
  display: flex;
  width: 100%;
  height: 32px;
  cursor: pointer;
  align-items: center;
  gap: 9px;
  border-radius: 6px;
  padding: 0 10px;
  color: var(--color-txt-3);
  font-size: 11.5px;
  text-align: left;
  transition: color 150ms ease, background-color 150ms ease;
}

.settings-nav-item:hover,
.settings-nav-item:focus-visible {
  background: var(--color-hover);
  color: var(--color-txt-2);
  outline: none;
}

.settings-nav-item-active {
  background: color-mix(in oklch, var(--color-violet) 15%, var(--color-raised));
  color: var(--color-txt);
}

.settings-nav-item-active svg {
  color: var(--color-violet);
}

@media (prefers-reduced-motion: reduce) {
  .settings-nav-item {
    transition: none;
  }
}
</style>
