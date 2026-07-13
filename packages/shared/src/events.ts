/** Typen der SSE-Events (Server → Browser) über Redis-PubSub. */
export type AppEvent =
  | {
      type: "run.event";
      runId: string;
      agentId: string;
      seq: number;
      eventType: string;
      content: unknown;
    }
  | { type: "run.status"; runId: string; agentId: string; status: string }
  | { type: "decision.changed"; decisionId: string; status: string }
  | {
      type: "sync.status";
      sourceId: string;
      status: "ok" | "error" | "running";
      error?: string;
    }
  | { type: "mail.new"; accountId: string; messageId: string };

export type RunEventType =
  | "trigger"
  | "assistant_text"
  | "tool_call"
  | "tool_result"
  | "user_message"
  | "decision_created"
  | "result"
  | "error";

export const runStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof runStatuses)[number];

export const runStatusLabels: Record<RunStatus, string> = {
  queued: "Wartet",
  running: "Läuft",
  completed: "Abgeschlossen",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
};
