<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { ContextMenuItem } from '@/types/context-menu'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  open: boolean
  x: number
  y: number
  items: readonly ContextMenuItem[]
  label?: string
  scrollable?: boolean
}>()

const emit = defineEmits<{
  close: []
  select: [id: string]
}>()

const menu = useTemplateRef<HTMLElement>('menu')
const menuStyle = shallowRef<CSSProperties>({ left: '8px', top: '8px' })
const submenuLeft = shallowRef(false)

function rootEnabledItems(): HTMLButtonElement[] {
  return [...(menu.value?.querySelectorAll<HTMLButtonElement>(':scope > .app-context-menu-entry > [role="menuitem"]:not(:disabled)') ?? [])]
}

async function positionMenu(): Promise<void> {
  if (!props.open)
    return
  menuStyle.value = { left: `${props.x}px`, top: `${props.y}px` }
  await nextTick()
  const element = menu.value
  if (!element)
    return
  const padding = 8
  const width = element.offsetWidth
  const height = element.offsetHeight
  const left = Math.max(padding, Math.min(props.x, window.innerWidth - width - padding))
  const top = Math.max(padding, Math.min(props.y, window.innerHeight - height - padding))
  submenuLeft.value = left + width * 2 + 14 > window.innerWidth
  menuStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    '--menu-origin-x': left < props.x ? '100%' : '0%',
    '--menu-origin-y': top < props.y ? '100%' : '0%',
  }
  rootEnabledItems()[0]?.focus()
}

function selectItem(item: ContextMenuItem): void {
  if (item.disabled || item.children?.length)
    return
  emit('select', item.id)
  emit('close')
}

function handleKeydown(event: KeyboardEvent): void {
  const current = document.activeElement as HTMLButtonElement | null
  const submenu = current?.closest<HTMLElement>('.app-context-submenu')
  const scope = submenu ?? menu.value
  const items = [...(scope?.querySelectorAll<HTMLButtonElement>(':scope > .app-context-menu-entry > [role="menuitem"]:not(:disabled)') ?? [])]
  if (!items.length)
    return
  const index = items.indexOf(current as HTMLButtonElement)
  let nextIndex = index

  if (event.key === 'ArrowDown')
    nextIndex = index < items.length - 1 ? index + 1 : 0
  else if (event.key === 'ArrowUp')
    nextIndex = index > 0 ? index - 1 : items.length - 1
  else if (event.key === 'Home')
    nextIndex = 0
  else if (event.key === 'End')
    nextIndex = items.length - 1
  else if (event.key === 'ArrowRight' && current?.dataset.hasChildren === 'true') {
    event.preventDefault()
    current.parentElement?.querySelector<HTMLButtonElement>('.app-context-submenu [role="menuitem"]:not(:disabled)')?.focus()
    return
  }
  else if (event.key === 'ArrowLeft' && submenu) {
    event.preventDefault()
    submenu.parentElement?.querySelector<HTMLButtonElement>(':scope > [role="menuitem"]')?.focus()
    return
  }
  else if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  else {
    return
  }

  event.preventDefault()
  items[nextIndex]?.focus()
}

watch(
  [() => props.open, () => props.x, () => props.y, () => props.items],
  ([open]) => {
    if (open)
      void positionMenu()
  },
  { deep: true },
)

useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  if (props.open && !menu.value?.contains(event.target as Node))
    emit('close')
}, { capture: true })
useEventListener(window, 'resize', () => props.open && emit('close'))
useEventListener(window, 'blur', () => props.open && emit('close'))
</script>

<template>
  <Teleport to="body">
    <Transition name="context-menu">
      <div
        v-if="open"
        ref="menu"
        class="app-context-menu"
        :class="scrollable && 'app-context-menu-scroll scroll-thin'"
        role="menu"
        aria-orientation="vertical"
        :aria-label="label ?? 'Context menu'"
        :style="menuStyle"
        @keydown="handleKeydown"
        @contextmenu.prevent
      >
        <template v-for="item in items" :key="item.id">
          <div v-if="item.groupLabel" class="app-context-menu-group">{{ item.groupLabel }}</div>
          <div v-if="item.separatorBefore" class="app-context-menu-separator" role="separator" />
          <div class="app-context-menu-entry">
            <button
              type="button"
              role="menuitem"
              :aria-checked="item.checked ?? undefined"
              :aria-haspopup="item.children?.length ? 'menu' : undefined"
              :disabled="item.disabled"
              :data-has-children="Boolean(item.children?.length)"
              :class="['app-context-menu-item', item.danger && 'app-context-menu-item-danger']"
              @click="selectItem(item)"
            >
              <span :class="['app-context-menu-icon', item.iconTone && `app-context-menu-icon-${item.iconTone}`]" aria-hidden="true">
                <AppIcon v-if="item.checked" name="lucide:check" :size="14" />
                <AppIcon v-else-if="item.icon" :name="item.icon" :size="14" />
              </span>
              <span class="min-w-0 flex-1 truncate text-left">{{ item.label }}</span>
              <kbd v-if="item.shortcut" class="app-context-menu-shortcut">{{ item.shortcut }}</kbd>
              <AppIcon v-if="item.children?.length" name="lucide:chevron-right" :size="12" class="text-txt-4" />
            </button>

            <div v-if="item.children?.length" :class="['app-context-submenu', submenuLeft && 'app-context-submenu-left']" role="menu" :aria-label="item.label">
              <template v-for="child in item.children" :key="child.id">
                <div v-if="child.groupLabel" class="app-context-menu-group">{{ child.groupLabel }}</div>
                <div v-if="child.separatorBefore" class="app-context-menu-separator" role="separator" />
                <div class="app-context-menu-entry">
                  <button
                    type="button"
                    role="menuitem"
                    :aria-checked="child.checked ?? undefined"
                    :disabled="child.disabled"
                    :class="['app-context-menu-item', child.danger && 'app-context-menu-item-danger']"
                    @click="selectItem(child)"
                  >
                    <span :class="['app-context-menu-icon', child.iconTone && `app-context-menu-icon-${child.iconTone}`]" aria-hidden="true">
                      <AppIcon v-if="child.checked" name="lucide:check" :size="14" />
                      <AppIcon v-else-if="child.icon" :name="child.icon" :size="14" />
                    </span>
                    <span class="min-w-0 flex-1 truncate text-left">{{ child.label }}</span>
                    <kbd v-if="child.shortcut" class="app-context-menu-shortcut">{{ child.shortcut }}</kbd>
                  </button>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-context-menu,
.app-context-submenu {
  width: 224px;
  border: 1px solid color-mix(in oklch, var(--color-line-strong) 88%, white 5%);
  border-radius: 11px;
  background: linear-gradient(180deg, color-mix(in oklch, white 3%, transparent), transparent 32%), color-mix(in oklch, var(--color-panel) 94%, transparent);
  box-shadow: 0 18px 48px rgb(0 0 0 / 34%), 0 3px 12px rgb(0 0 0 / 22%), inset 0 1px rgb(255 255 255 / 4%);
  padding: 6px;
  backdrop-filter: blur(28px) saturate(175%);
  -webkit-backdrop-filter: blur(28px) saturate(175%);
}

.app-context-menu { position: fixed; z-index: 100; }
.app-context-menu-scroll { max-height: calc(100dvh - 16px); overflow-y: auto; overscroll-behavior: contain; }
.app-context-menu-entry { position: relative; }
.app-context-submenu {
  position: absolute;
  top: -6px;
  left: calc(100% - 1px);
  display: none;
}
.app-context-submenu-left { right: calc(100% - 1px); left: auto; }
.app-context-menu-entry:hover > .app-context-submenu,
.app-context-menu-entry:focus-within > .app-context-submenu { display: block; }

.app-context-menu-item {
  display: flex;
  width: 100%;
  min-height: 34px;
  cursor: pointer;
  align-items: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 0 7px;
  color: var(--color-txt-2);
  font-size: 11.5px;
  font-weight: 500;
  outline: none;
  transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease;
}
.app-context-menu-item:hover,
.app-context-menu-item:focus-visible { background: var(--color-hover); border-color: color-mix(in oklch, var(--color-line-strong) 65%, transparent); color: var(--color-txt); }
.app-context-menu-item:focus-visible { box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-violet) 42%, transparent); }
.app-context-menu-item:disabled { pointer-events: none; opacity: 0.38; }
.app-context-menu-item-danger { color: var(--color-danger); }
.app-context-menu-item-danger:hover,
.app-context-menu-item-danger:focus-visible { background: color-mix(in oklch, var(--color-danger) 12%, transparent); color: var(--color-danger); }

.app-context-menu-icon { display: grid; width: 20px; height: 20px; flex: none; place-items: center; border-radius: 5px; color: var(--color-txt-3); }
.app-context-menu-item:hover .app-context-menu-icon,
.app-context-menu-item:focus-visible .app-context-menu-icon,
.app-context-menu-icon-violet { color: var(--color-violet); }
.app-context-menu-icon-blue { color: var(--color-blue); }
.app-context-menu-icon-amber { color: var(--color-amber); }
.app-context-menu-icon-danger { color: var(--color-danger); }

.app-context-menu-shortcut { flex: none; border: 1px solid var(--color-line-soft); border-radius: 4px; background: color-mix(in oklch, var(--color-card) 78%, transparent); padding: 1px 5px; color: var(--color-txt-4); font-family: inherit; font-size: 9px; line-height: 1.4; }
.app-context-menu-separator { height: 1px; margin: 5px 4px; background: var(--color-line-soft); }
.app-context-menu-group { padding: 5px 8px 3px; overflow: hidden; color: var(--color-txt-4); font-size: 9px; font-weight: 650; letter-spacing: 0.06em; text-overflow: ellipsis; white-space: nowrap; }

.context-menu-enter-active,
.context-menu-leave-active { transform-origin: var(--menu-origin-x, 0%) var(--menu-origin-y, 0%); transition: opacity 140ms ease, transform 160ms cubic-bezier(0.16, 1, 0.3, 1); }
.context-menu-enter-from,
.context-menu-leave-to { transform: translateY(-3px) scale(0.97); opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .app-context-menu-item,
  .context-menu-enter-active,
  .context-menu-leave-active { transition: none; }
}
</style>
