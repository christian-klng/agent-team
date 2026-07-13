import type { AppEvent } from "@agent-team/shared";
import IORedis from "ioredis";

let publisher: IORedis | undefined;

function getPublisher(): IORedis {
  if (!publisher) {
    publisher = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");
  }
  return publisher;
}

export function userEventChannel(userId: string): string {
  return `events:user:${userId}`;
}

export async function publishAppEvent(userId: string, event: AppEvent): Promise<void> {
  try {
    await getPublisher().publish(userEventChannel(userId), JSON.stringify(event));
  } catch (err) {
    // SSE ist Komfort, kein kritischer Pfad — Fehler nur loggen.
    console.error("publishAppEvent fehlgeschlagen:", err);
  }
}

/** Eigene Subscriber-Verbindung (Redis-Subscribe blockiert die Verbindung). */
export function createEventSubscriber(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");
}

/** Kanal, über den die Web-App den Worker zum Scheduler-Abgleich auffordert. */
export const RECONCILE_CHANNEL = "scheduler:reconcile";

export async function requestSchedulerReconcile(): Promise<void> {
  try {
    await getPublisher().publish(RECONCILE_CHANNEL, "reconcile");
  } catch (err) {
    console.error("requestSchedulerReconcile fehlgeschlagen:", err);
  }
}
