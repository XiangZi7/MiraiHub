export interface AgentTarget {
  kind: "ssh" | "database";
  sessionId: string;
  database: string;
}
export interface AgentConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}
export interface AgentConfigInput {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
}
export interface AgentEntry {
  role: "user" | "assistant" | "tool" | "audit" | "error";
  text: string;
  detail?: string;
}
export interface AgentApproval {
  id: string;
  command: string;
  reason: string;
  label: string;
  expiresAt: number;
}
export interface AgentRun {
  id: string;
  target: string;
  provider: string;
  model: string;
  status: "running" | "approval" | "completed" | "cancelled" | "failed";
  entries: AgentEntry[];
  approval: AgentApproval | null;
}
