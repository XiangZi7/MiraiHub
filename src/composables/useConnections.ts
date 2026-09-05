import { readonly } from "vue";
import { storeToRefs } from "pinia";
import { useConnectionsStore } from "@/stores/connections";
export function useConnections() {
  const store = useConnectionsStore();
  void store.initialize().catch(() => undefined);
  const { loaded, sshConnections, databaseConnections } = storeToRefs(store);
  const {
    groupsFor,
    find,
    refresh,
    create,
    update,
    remove,
    createGroup,
    renameGroup,
    removeGroup,
    touch,
  } = store;
  return {
    connections: readonly(store.items),
    groups: readonly(store.groups),
    tags: readonly(store.tags),
    loaded,
    sshConnections,
    databaseConnections,
    groupsFor,
    find,
    refresh,
    create,
    update,
    remove,
    createGroup,
    renameGroup,
    removeGroup,
    touch,
  };
}
