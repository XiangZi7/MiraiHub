import { invoke } from "@tauri-apps/api/core";
import type {
  AgentConfig,
  AgentConfigInput,
  AgentRun,
  AgentTarget,
} from "@/types/agent";
import { IS_TAURI } from "@/utils/window";
function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI)
    return Promise.reject(new Error("请在 MiraiHub 桌面程序中使用 AI Agent"));
  return invoke<T>(command, args);
}
export const getConfig = () => call<AgentConfig>("ai_get_config");
export const saveConfig = (config: AgentConfigInput, clearKey: boolean) =>
  call<AgentConfig>("ai_save_config", { config, clearKey });
export const testConfig = () => call<string>("ai_test_config");
export const start = (target: AgentTarget, prompt: string) =>
  call<AgentRun>("ai_start", { target, prompt });
export const send = (runId: string, prompt: string) =>
  call<AgentRun>("ai_send", { runId, prompt });
export const step = (runId: string) => call<AgentRun>("ai_step", { runId });
export const respond = (runId: string, approvalId: string, approve: boolean) =>
  call<AgentRun>("ai_respond", { runId, approvalId, approve });
export const cancel = (runId: string) => call<void>("ai_cancel", { runId });
export const forget = (runId: string) => call<void>("ai_forget", { runId });
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return String(error);
}
