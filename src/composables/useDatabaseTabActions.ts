import { computed, reactive } from "vue";
import type { ContextMenuItem } from "@/types/context-menu";
interface QueryActionTab {
  id: string;
  label: string;
  kind: "query" | "object" | "table-designer";
  sql?: string;
  savedQueryId?: string | null;
}
interface Options {
  tabs: () => readonly QueryActionTab[];
  close: (ids: string[]) => void;
  hasSavedQuery: (id: string) => boolean;
  copy: (id: string) => Promise<void>;
  duplicate: (id: string) => void;
  save: (id: string) => void;
}
export function useDatabaseTabActions(options: Options) {
  const state = reactive({ pendingIds: [] as string[] });
  function draft(tab: QueryActionTab): boolean {
    return (
      tab.kind === "table-designer" ||
      (tab.kind === "query" &&
        Boolean(tab.sql?.trim()) &&
        (!tab.savedQueryId || !options.hasSavedQuery(tab.savedQueryId)))
    );
  }
  const description = computed(() => {
    const tabs = options
      .tabs()
      .filter((tab) => state.pendingIds.includes(tab.id) && draft(tab));
    const names = tabs
      .slice(0, 5)
      .map((tab) => `“${tab.label}”`)
      .join("、");
    return `${names}${tabs.length > 5 ? ` 等 ${tabs.length} 个标签` : ""}包含未保存的 SQL 或建表草稿。关闭后这些草稿将被丢弃；取消后可先保存或复制内容。`;
  });
  function requestClose(ids: string[]): void {
    const tabs = options.tabs().filter((tab) => ids.includes(tab.id));
    if (tabs.some(draft)) state.pendingIds = tabs.map((tab) => tab.id);
    else options.close(tabs.map((tab) => tab.id));
  }
  function cancel(): void {
    state.pendingIds = [];
  }
  function confirm(): void {
    const ids = [...state.pendingIds];
    cancel();
    options.close(ids);
  }
  function contextItems(id: string): ContextMenuItem[] {
    const tab = options.tabs().find((tab) => tab.id === id);
    if (tab?.kind !== "query") return [];
    return [
      {
        id: "query:duplicate",
        label: "复制为新查询标签",
        icon: "lucide:copy-plus",
      },
      {
        id: "query:save",
        label: "保存查询",
        icon: "lucide:save",
        disabled: !tab.sql?.trim(),
      },
      {
        id: "query:copy",
        label: "复制 SQL",
        icon: "lucide:clipboard",
        disabled: !tab.sql?.trim(),
      },
    ];
  }
  async function action(id: string, action: string): Promise<void> {
    if (!contextItems(id).some((item) => item.id === action && !item.disabled))
      return;
    if (action === "query:duplicate") options.duplicate(id);
    else if (action === "query:save") options.save(id);
    else if (action === "query:copy") await options.copy(id);
  }
  return {
    state,
    description,
    requestClose,
    confirm,
    cancel,
    contextItems,
    action,
  };
}
