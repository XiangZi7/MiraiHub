import { shallowReactive } from "vue";
import { defineStore } from "pinia";
import { toast } from "@/composables/useToast";
import { IS_TAURI } from "@/utils/window";
import { openRemoteEditorWindow, errorMessage } from "@/api/operations";

export interface RemoteEditRequest {
  sessionId: string;
  path: string;
  connectionName: string;
}

/** 浏览器预览的编辑器请求。桌面版仍由 Rust 按窗口身份管理真实编辑目标。 */
export const useRemoteEditorStore = defineStore("remote-editor", () => {
  const state = shallowReactive({ request: null as RemoteEditRequest | null });
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
  function close(): void {
    state.request = null;
  }
  return { state, open, close };
});
