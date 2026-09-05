import { readonly, shallowReactive } from "vue";
import { toast } from "@/composables/useToast";
import { IS_TAURI } from "@/utils/window";
import { openRemoteEditorWindow, errorMessage } from "@/api/operations";
export interface RemoteEditRequest {
  sessionId: string;
  path: string;
  connectionName: string;
}
const state = shallowReactive({ request: null as RemoteEditRequest | null });
export function useRemoteEditor() {
  function open(request: RemoteEditRequest): void {
    if (IS_TAURI) {
      void openRemoteEditorWindow({ ...request }).catch((error) =>
        toast.error({
          title: "打开远端编辑器失败",
          description: errorMessage(error),
        }),
      );
      return;
    }
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
