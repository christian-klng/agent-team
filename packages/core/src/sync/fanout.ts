import {
  agentRuns,
  agentTriggers,
  agents,
  db,
  triggerEvents,
} from "@agent-team/db";
import { and, eq } from "drizzle-orm";
import { publishAppEvent } from "../events";
import { agentRunQueue } from "../queues";
import type { SourceRow } from "../sources";
import type { DetectedChange } from "./types";

type TriggerRow = typeof agentTriggers.$inferSelect;

export function matchesTrigger(trigger: TriggerRow, change: DetectedChange): boolean {
  // Leere Kind-Liste = alle Event-Arten dieser Quelle.
  if (trigger.eventKinds.length > 0 && !trigger.eventKinds.includes(change.kind)) {
    return false;
  }
  const f = trigger.filter ?? {};
  const p = change.payload as Record<string, unknown>;

  if (f.folderIds && f.folderIds.length > 0) {
    if (!p.folderId || !f.folderIds.includes(String(p.folderId))) return false;
  }
  if (f.calendarIds && f.calendarIds.length > 0) {
    if (!p.calendarId || !f.calendarIds.includes(String(p.calendarId))) return false;
  }
  if (f.senderPattern) {
    const from = typeof p.fromEmail === "string" ? p.fromEmail : "";
    try {
      if (!new RegExp(f.senderPattern, "i").test(from)) return false;
    } catch {
      // Ungültiges Pattern: als einfacher Substring-Match behandeln.
      if (!from.toLowerCase().includes(f.senderPattern.toLowerCase())) return false;
    }
  }
  if (f.pathPrefix) {
    const path = typeof p.path === "string" ? p.path : "";
    if (!path.startsWith(f.pathPrefix)) return false;
  }
  return true;
}

/**
 * Persistiert erkannte Änderungen als trigger_events (dedupliziert) und
 * startet für jeden passenden Agenten einen Run.
 */
export async function fanOutChanges(
  source: SourceRow,
  changes: DetectedChange[],
): Promise<{ eventsCreated: number; runsQueued: number }> {
  let eventsCreated = 0;
  let runsQueued = 0;
  if (changes.length === 0) return { eventsCreated, runsQueued };

  const triggers = await db
    .select({ trigger: agentTriggers, agent: agents })
    .from(agentTriggers)
    .innerJoin(agents, eq(agentTriggers.agentId, agents.id))
    .where(
      and(eq(agentTriggers.dataSourceId, source.id), eq(agents.enabled, true)),
    );

  for (const change of changes) {
    const inserted = await db
      .insert(triggerEvents)
      .values({
        userId: source.userId,
        dataSourceId: source.id,
        kind: change.kind,
        externalRef: change.externalRef,
        payload: change.payload,
        dedupKey: change.dedupKey,
      })
      .onConflictDoNothing()
      .returning({ id: triggerEvents.id });

    const event = inserted[0];
    if (!event) continue; // schon verarbeitet (Dedup)
    eventsCreated++;

    for (const { trigger, agent } of triggers) {
      if (!matchesTrigger(trigger, change)) continue;

      const [run] = await db
        .insert(agentRuns)
        .values({
          userId: source.userId,
          agentId: agent.id,
          triggerEventId: event.id,
          status: "queued",
        })
        .returning({ id: agentRuns.id });
      if (!run) continue;

      await agentRunQueue().add(
        "run",
        { runId: run.id },
        { jobId: `run-${agent.id}-${event.id}`, attempts: 1 },
      );
      runsQueued++;
      await publishAppEvent(source.userId, {
        type: "run.status",
        runId: run.id,
        agentId: agent.id,
        status: "queued",
      });
    }
  }

  return { eventsCreated, runsQueued };
}
