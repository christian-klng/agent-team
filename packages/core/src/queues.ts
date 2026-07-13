import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

export const QUEUE_NAMES = {
  sync: "sync",
  agentRun: "agent-run",
  agentFollowup: "agent-followup",
  executeDecision: "execute-decision",
} as const;

export interface SyncJobData {
  dataSourceId: string;
}

export interface AgentRunJobData {
  runId: string;
}

export interface AgentFollowupJobData {
  runId: string;
  message: string;
}

export interface ExecuteDecisionJobData {
  decisionId: string;
}

export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  // BullMQ verlangt maxRetriesPerRequest: null für blockierende Verbindungen.
  return new IORedis(url, { maxRetriesPerRequest: null });
}

/** Verbindungsoptionen für BullMQ-Queues/-Worker (aus REDIS_URL geparst). */
export function bullmqConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    ...(url.username ? { username: url.username } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    ...(url.pathname && url.pathname !== "/"
      ? { db: Number(url.pathname.slice(1)) }
      : {}),
    maxRetriesPerRequest: null,
  };
}

const queues = new Map<string, Queue>();

export function getQueue<T = unknown>(name: string): Queue<T> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: bullmqConnection() });
    queues.set(name, q);
  }
  return q as Queue<T>;
}

export const syncQueue = () => getQueue<SyncJobData>(QUEUE_NAMES.sync);
export const agentRunQueue = () => getQueue<AgentRunJobData>(QUEUE_NAMES.agentRun);
export const agentFollowupQueue = () =>
  getQueue<AgentFollowupJobData>(QUEUE_NAMES.agentFollowup);
export const executeDecisionQueue = () =>
  getQueue<ExecuteDecisionJobData>(QUEUE_NAMES.executeDecision);
