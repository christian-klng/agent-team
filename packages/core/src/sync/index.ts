import { dataSources, db } from "@agent-team/db";
import { eq } from "drizzle-orm";
import { publishAppEvent } from "../events";
import { getSourceWithConfig } from "../sources";
import { syncCaldavSource } from "./caldav-sync";
import { syncEwsMailSource } from "./ews-sync";
import { fanOutChanges } from "./fanout";
import { syncMailSource } from "./imap-sync";
import { syncWebdavSource } from "./webdav-sync";

export * from "./types";
export * from "./fanout";
export { parseIcsEvent } from "./caldav-sync";
export { sanitizeMailHtml, buildSnippet } from "./mail-content";

/**
 * Führt einen kompletten Sync-Durchlauf für eine Datenquelle aus:
 * Adapter → Baseline-Gate → Trigger-Fan-out → Statuspflege.
 */
export async function runSyncForSource(dataSourceId: string): Promise<void> {
  const full = await getSourceWithConfig(dataSourceId);
  const { source } = full;
  if (!source.enabled) return;

  await db
    .update(dataSources)
    .set({ lastSyncStatus: "running", updatedAt: new Date() })
    .where(eq(dataSources.id, source.id));
  await publishAppEvent(source.userId, {
    type: "sync.status",
    sourceId: source.id,
    status: "running",
  });

  try {
    const changes =
      full.type === "email"
        ? full.config.protocol === "ews"
          ? await syncEwsMailSource(full.config, source)
          : await syncMailSource(full.config, source)
        : full.type === "caldav"
          ? await syncCaldavSource(full.config, source)
          : await syncWebdavSource(full.config, source);

    if (!source.baselineCompletedAt) {
      // Erster vollständiger Sync: Bestand aufnehmen, aber keine Agenten starten.
      await db
        .update(dataSources)
        .set({
          baselineCompletedAt: new Date(),
          lastSyncAt: new Date(),
          lastSyncStatus: "ok",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(dataSources.id, source.id));
      console.log(
        `[sync] Baseline für ${source.name} abgeschlossen (${changes.length} Einträge übersprungen).`,
      );
    } else {
      const { eventsCreated, runsQueued } = await fanOutChanges(source, changes);
      if (eventsCreated > 0) {
        console.log(
          `[sync] ${source.name}: ${eventsCreated} neue Events, ${runsQueued} Agent-Runs gestartet.`,
        );
      }
      await db
        .update(dataSources)
        .set({
          lastSyncAt: new Date(),
          lastSyncStatus: "ok",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(dataSources.id, source.id));
    }

    await publishAppEvent(source.userId, {
      type: "sync.status",
      sourceId: source.id,
      status: "ok",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(dataSources)
      .set({
        lastSyncAt: new Date(),
        lastSyncStatus: "error",
        lastError: message,
        updatedAt: new Date(),
      })
      .where(eq(dataSources.id, source.id));
    await publishAppEvent(source.userId, {
      type: "sync.status",
      sourceId: source.id,
      status: "error",
      error: message,
    });
    console.error(`[sync] Fehler bei ${source.name}:`, message);
  }
}
