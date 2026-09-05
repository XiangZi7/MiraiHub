import { readonly } from "vue";
import { storeToRefs } from "pinia";
import { useWorkspaceStore } from "@/stores/workspace";
export type { WorkspaceTab } from "@/stores/workspace";

/** 保留组件的只读接口；状态与动作由 Pinia 持有。 */
export function useWorkspaceTabs() {
  const store = useWorkspaceStore();
  const { activeId, active } = storeToRefs(store);
  const {
    open,
    close,
    closeMany,
    activate,
    reorder,
    setStatus,
    closeByConnection,
    restore,
  } = store;
  return {
    tabs: readonly(store.tabs),
    activeId,
    active,
    open,
    close,
    closeMany,
    activate,
    reorder,
    setStatus,
    closeByConnection,
    restore,
  };
}
