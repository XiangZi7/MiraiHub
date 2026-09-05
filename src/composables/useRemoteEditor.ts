import { readonly, shallowReactive } from "vue";
import { toast } from "@/composables/useToast";
export interface RemoteEditRequest {
  sessionId: string;
  path: string;
  connectionName: string;
}
const state = shallowReactive({ request: null as RemoteEditRequest | null });
export function useRemoteEditor() {
  function open(request: RemoteEditRequest): void {
    if (state.request) {
      toast.info("请先保存或关闭当前远端编辑器");
      return;
    }
    state.request = { ...request };
  }
  return {
    state: readonly(state),
    open,
    close: () => {
      state.request = null;
    },
  };
}
