import {
  bullmqConnection,
  processApprovedDecision,
  QUEUE_NAMES,
  type AgentFollowupJobData,
  type AgentRunJobData,
  type ExecuteDecisionJobData,
} from "@agent-team/core";
import { Worker } from "bullmq";
import { executeFollowup, executeRun } from "./runtime";

const RUN_CONCURRENCY = 2; // Kostenbremse: max. 2 parallele LLM-Läufe

/** Registriert die Agent-Runtime-Worker (Runs + Follow-ups). */
export async function registerAgentWorkers(): Promise<Worker[]> {
  const runWorker = new Worker<AgentRunJobData & { prompt?: string }>(
    QUEUE_NAMES.agentRun,
    async (job) => {
      await executeRun(job.data.runId, job.data.prompt);
    },
    { connection: bullmqConnection(), concurrency: RUN_CONCURRENCY },
  );
  runWorker.on("failed", (job, err) => {
    console.error(`[agent] Run-Job ${job?.id} fehlgeschlagen:`, err.message);
  });

  const followupWorker = new Worker<AgentFollowupJobData>(
    QUEUE_NAMES.agentFollowup,
    async (job) => {
      await executeFollowup(job.data.runId, job.data.message);
    },
    { connection: bullmqConnection(), concurrency: RUN_CONCURRENCY },
  );
  followupWorker.on("failed", (job, err) => {
    console.error(`[agent] Follow-up-Job ${job?.id} fehlgeschlagen:`, err.message);
  });

  // Seiteneffekt-Ausführung: bewusst attempts=1 (kein Auto-Retry) — die Jobs
  // werden beim Enqueue so angelegt; hier nur die Verarbeitung.
  const decisionWorker = new Worker<ExecuteDecisionJobData>(
    QUEUE_NAMES.executeDecision,
    async (job) => {
      await processApprovedDecision(job.data.decisionId);
    },
    { connection: bullmqConnection(), concurrency: 2 },
  );
  decisionWorker.on("failed", (job, err) => {
    console.error(`[decision] Job ${job?.id} fehlgeschlagen:`, err.message);
  });

  console.log("[worker] Agent-Runtime-Worker registriert.");
  return [runWorker, followupWorker, decisionWorker];
}
