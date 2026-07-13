import type { TriggerFilter } from "@agent-team/shared";

export interface AgentTriggerRow {
  id?: string;
  dataSourceId: string;
  eventKinds: string[];
  filter: TriggerFilter;
}

export interface AgentListItem {
  id: string;
  name: string;
  description: string | null;
  color: string;
  model: string;
  maxTurns: number;
  skillMarkdown: string;
  enabledTools: string[];
  enabled: boolean;
  createdAt: string;
  triggers: AgentTriggerRow[];
  runCount: number;
  totalCost: number;
  lastRunAt: string | null;
}

export interface AgentDetail extends AgentListItem {
  memory: string;
}

export interface RunListItem {
  id: string;
  agentId: string;
  agentName: string;
  agentColor: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  costUsd: string;
  numTurns: number;
  error: string | null;
}
