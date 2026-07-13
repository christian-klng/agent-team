import {
  bullmqConnection,
  createEventSubscriber,
  createRedisConnection,
  QUEUE_NAMES,
  RECONCILE_CHANNEL,
  syncQueue,
  type SyncJobData,
} from "@agent-team/core";
import { runSyncForSource } from "@agent-team/core/sync";
import { dataSources, db } from "@agent-team/db";
import { Worker } from "bullmq";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const SYNC_CONCURRENCY = 4;

export async function reconcileSchedulers(): Promise<void> {
  const queue = syncQueue();
  const sources = await db.select().from(dataSources);
  const desired = new Map(
    sources.filter((s) => s.enabled).map((s) => [`sync-${s.id}`, s.id]),
  );

  const schedulers = await queue.getJobSchedulers(0, 10_000, true);
  for (const s of schedulers) {
    const key = s.key ?? s.id;
    if (key && key.startsWith("sync") && !desired.has(key)) {
      await queue.removeJobScheduler(key);
      console.log(`[scheduler] Sync-Plan entfernt: ${key}`);
    }
  }
  for (const [key, dataSourceId] of desired) {
    await queue.upsertJobScheduler(
      key,
      { every: SYNC_INTERVAL_MS },
      { name: "sync", data: { dataSourceId } satisfies SyncJobData },
    );
  }
  console.log(`[scheduler] ${desired.size} Sync-Pläne aktiv.`);
}

function startSyncWorker(): Worker<SyncJobData> {
  const lockRedis = createRedisConnection();
  const worker = new Worker<SyncJobData>(
    QUEUE_NAMES.sync,
    async (job) => {
      const { dataSourceId } = job.data;
      // Überlappungsschutz: läuft ein Sync dieser Quelle noch, überspringen.
      const lockKey = `sync-lock:${dataSourceId}`;
      const acquired = await lockRedis.set(lockKey, "1", "EX", 240, "NX");
      if (!acquired) {
        console.log(`[sync] ${dataSourceId}: läuft bereits, übersprungen.`);
        return;
      }
      try {
        await runSyncForSource(dataSourceId);
      } finally {
        await lockRedis.del(lockKey);
      }
    },
    { connection: bullmqConnection(), concurrency: SYNC_CONCURRENCY },
  );
  worker.on("failed", (job, err) => {
    console.error(`[sync] Job ${job?.id} fehlgeschlagen:`, err.message);
  });
  return worker;
}

export async function startWorker(): Promise<void> {
  const workers: Worker[] = [startSyncWorker()];

  // Weitere Prozessoren (Agent-Runs, Follow-ups, Decision-Execution).
  const { registerAgentWorkers } = await import("./agent/register");
  workers.push(...(await registerAgentWorkers()));

  await reconcileSchedulers();

  // Web-App kann nach CRUD einen sofortigen Abgleich anstoßen.
  const sub = createEventSubscriber();
  await sub.subscribe(RECONCILE_CHANNEL);
  sub.on("message", (channel) => {
    if (channel === RECONCILE_CHANNEL) {
      reconcileSchedulers().catch((err) =>
        console.error("[scheduler] Abgleich fehlgeschlagen:", err),
      );
    }
  });

  // Sicherheitsnetz: periodischer Abgleich.
  const interval = setInterval(() => {
    reconcileSchedulers().catch(() => {});
  }, SYNC_INTERVAL_MS);

  const shutdown = async () => {
    console.log("[worker] Fahre herunter …");
    clearInterval(interval);
    await Promise.allSettled(workers.map((w) => w.close()));
    await sub.quit().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[worker] Bereit — Sync-Worker läuft.");
}
