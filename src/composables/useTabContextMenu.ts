import { computed, nextTick, reactive, watch } from "vue";
import type { ContextMenuItem } from "@/types/context-menu";
import { tabCloseTargets, type TabCloseScope } from "@/utils/tab-actions";
import { copyText } from "@/utils/clipboard";
import { toast } from "@/composables/useToast";
interface MenuTab {
  id: string;
  label: string;
  closable?: boolean;
}
interface Options {
  tabs: () => readonly MenuTab[];
  container: () => HTMLElement | null;
  active: () => string;
  extraItems: (id: string) => readonly ContextMenuItem[];
  close: (id: string) => void;
  closeMany: (ids: string[]) => void;
  reorder: (from: number, to: number) => void;
  action: (id: string, action: string) => void;
}
const scopes: { scope: TabCloseScope; label: string; icon: string }[] = [
  { scope: "current", label: "关闭当前标签", icon: "lucide:x" },
  { scope: "others", label: "关闭其他标签", icon: "lucide:copy-x" },
  { scope: "left", label: "关闭左侧标签", icon: "lucide:arrow-left-to-line" },
  { scope: "right", label: "关闭右侧标签", icon: "lucide:arrow-right-to-line" },
  { scope: "all", label: "关闭全部标签", icon: "lucide:panels-top-left" },
];
export function useTabContextMenu(options: Options) {
  const state = reactive({ open: false, id: "", x: 0, y: 0 });
  const target = computed(() =>
    options.tabs().find((tab) => tab.id === state.id),
  );
  const items = computed<ContextMenuItem[]>(() => {
    if (!target.value) return [];
    const tabs = options.tabs(),
      index = tabs.findIndex((tab) => tab.id === state.id);
    return [
      ...scopes.map(({ scope, label, icon }) => ({
        id: `tabs:${scope}`,
        label,
        icon,
        groupLabel: scope === "current" ? target.value!.label : undefined,
        disabled: !tabCloseTargets(tabs, state.id, scope).length,
      })),
      {
        id: "tabs:first",
        label: "移到最左侧",
        icon: "lucide:move-left",
        separatorBefore: true,
        disabled: index === 0,
      },
      {
        id: "tabs:last",
        label: "移到最右侧",
        icon: "lucide:move-right",
        disabled: index === tabs.length - 1,
      },
      { id: "tabs:copy", label: "复制标签名称", icon: "lucide:copy" },
      ...options
        .extraItems(state.id)
        .map((item, index) =>
          index === 0 ? { ...item, separatorBefore: true } : item,
        ),
    ];
  });
  function show(event: MouseEvent | KeyboardEvent, id: string): void {
    if (!options.tabs().some((tab) => tab.id === id)) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    state.id = id;
    state.x =
      event instanceof MouseEvent && (event.clientX || event.clientY)
        ? event.clientX
        : rect.left + 12;
    state.y =
      event instanceof MouseEvent && (event.clientX || event.clientY)
        ? event.clientY
        : rect.bottom - 2;
    state.open = true;
  }
  function focusTab(): void {
    const tabs = [
      ...(options.container()?.querySelectorAll<HTMLElement>('[role="tab"]') ??
        []),
    ];
    (
      tabs.find((tab) => tab.dataset.reorderableTabId === state.id) ??
      tabs.find((tab) => tab.dataset.reorderableTabId === options.active()) ??
      tabs[0]
    )?.focus();
  }
  function dismiss(): void {
    state.open = false;
    // Restore before opening a dialog so it remembers the tab, not a removed menu item.
    if (!document.activeElement?.closest('[role="menu"]')) return;
    focusTab();
    void nextTick(() => {
      // Closing a tab removes the focused node. Never steal focus from a new dialog.
      if (document.activeElement === document.body) focusTab();
    });
  }
  async function select(action: string): Promise<void> {
    const id = state.id,
      tab = target.value;
    if (
      !tab ||
      !items.value.some((item) => item.id === action && !item.disabled)
    )
      return;
    dismiss();
    const scope = scopes.find((item) => `tabs:${item.scope}` === action)?.scope;
    if (scope) {
      const ids = tabCloseTargets(options.tabs(), id, scope);
      if (scope === "current") {
        if (ids[0]) options.close(ids[0]);
      } else if (ids.length) options.closeMany(ids);
    } else if (action === "tabs:first" || action === "tabs:last") {
      options.reorder(
        options.tabs().findIndex((tab) => tab.id === id),
        action === "tabs:first" ? 0 : options.tabs().length - 1,
      );
    } else if (action === "tabs:copy") {
      try {
        await copyText(tab.label);
        toast.success("标签名称已复制");
      } catch {
        toast.error("复制失败，请检查剪贴板权限");
      }
    } else options.action(id, action);
  }
  watch(
    () =>
      options
        .tabs()
        .map((tab) => tab.id)
        .join("\0"),
    () => {
      if (state.open) dismiss();
    },
  );
  return { state, items, show, dismiss, select };
}
