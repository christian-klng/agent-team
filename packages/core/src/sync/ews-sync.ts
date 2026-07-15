import { createHash } from "node:crypto";
import {
  calendarEvents,
  calendars,
  db,
  mailAttachments,
  mailFolders,
  mailMessageBodies,
  mailMessages,
} from "@agent-team/db";
import { and, eq, isNull } from "drizzle-orm";
import { simpleParser, type ParsedMail } from "mailparser";
import {
  EwsClient,
  type EwsCalendarItem,
  type EwsItemSummary,
  type EwsWellKnownFolder,
} from "../connectors/ews";
import type { EwsMailAccountConfig, SourceRow } from "../sources";
import { buildSnippet, sanitizeMailHtml } from "./mail-content";
import type { DetectedChange } from "./types";

const SYNC_BATCH_SIZE = 256;
/** Batches pro Ordner und Lauf — Notbremse gegen Endlosschleifen. */
const MAX_BATCHES_PER_FOLDER = 400;
/** Größere Mails beim Sync nur als Envelope erfassen; Body kommt on demand. */
const INGEST_MIME_MAX_BYTES = 8 * 1024 * 1024;
/**
 * Baseline-Fenster: nur Mails der letzten N Tage werden beim Erst-Sync
 * aufgenommen (analog zum IMAP-Backfill-Cap und zum Kalender-Zeitfenster).
 * Die Enumeration läuft trotzdem komplett durch, um den SyncState zu setzen —
 * begrenzt wird also nur, WAS gespeichert wird, nicht die einmalige Aufzählung.
 */
const BASELINE_WINDOW_DAYS = 180;

type FolderRow = typeof mailFolders.$inferSelect;

const ROLE_BY_WELL_KNOWN: Record<EwsWellKnownFolder, FolderRow["role"]> = {
  inbox: "inbox",
  sentitems: "sent",
  drafts: "drafts",
  deleteditems: "trash",
  junkemail: "spam",
  archive: "archive",
};

const DEFAULT_SYNC_ROLES = new Set(["inbox", "sent", "archive"]);

/**
 * Stabile numerische UID aus der EWS-ItemId (mail_messages.uid ist NOT NULL
 * und pro Ordner eindeutig). 52 Bit: sicher als JS-Integer, Kollisionen pro
 * Ordner praktisch ausgeschlossen.
 */
export function ewsUidFromItemId(itemId: string): number {
  const digest = createHash("sha256").update(itemId).digest();
  return Number(BigInt(`0x${digest.subarray(0, 8).toString("hex")}`) & ((1n << 52n) - 1n));
}

function addrList(list: { name?: string; address?: string }[]): {
  name?: string;
  address: string;
}[] {
  return list
    .filter((a) => a.address)
    .map((a) => ({ name: a.name || undefined, address: a.address! }));
}

function summaryToRow(
  cfg: EwsMailAccountConfig,
  source: SourceRow,
  folder: FolderRow,
  item: EwsItemSummary,
): typeof mailMessages.$inferInsert {
  return {
    userId: source.userId,
    accountId: cfg.accountId,
    folderId: folder.id,
    uid: ewsUidFromItemId(item.itemId),
    ewsItemId: item.itemId,
    messageIdHdr: item.internetMessageId,
    subject: item.subject,
    fromName: item.from?.name ?? null,
    fromEmail: item.from?.address?.toLowerCase() ?? null,
    toAddrs: addrList(item.to),
    ccAddrs: addrList(item.cc),
    sentAt: item.sentAt
      ? new Date(item.sentAt)
      : item.receivedAt
        ? new Date(item.receivedAt)
        : null,
    seen: item.isRead,
    hasAttachments: item.hasAttachments,
    size: item.size,
  };
}

/**
 * Holt eine Nachricht vollständig (MIME) via GetItem, parst und speichert
 * sie. Fällt bei Fehlern auf die Envelope-Daten aus SyncFolderItems zurück.
 * Liefert null bei Duplikat.
 */
async function ingestFullEwsMessage(
  client: EwsClient,
  cfg: EwsMailAccountConfig,
  source: SourceRow,
  folder: FolderRow,
  item: EwsItemSummary,
): Promise<{
  id: string;
  subject: string;
  fromEmail: string | null;
  fromName: string | null;
  snippet: string;
} | null> {
  let parsed: ParsedMail | null = null;
  try {
    const mime = await client.getItemMime(item.itemId, { maxBytes: INGEST_MIME_MAX_BYTES });
    parsed = await simpleParser(mime);
  } catch (err) {
    console.warn(
      `[sync:ews] MIME-Abruf fehlgeschlagen (${folder.path}, ${item.subject || "ohne Betreff"}):`,
      err instanceof Error ? err.message : err,
    );
  }

  const textBody = parsed?.text ?? null;
  const htmlSanitized = parsed?.html ? sanitizeMailHtml(parsed.html) : null;
  const attachments = (parsed?.attachments ?? []).map((a) => ({
    filename: a.filename,
    mime: a.contentType,
    size: a.size,
  }));
  const references = parsed?.references
    ? Array.isArray(parsed.references)
      ? parsed.references
      : [parsed.references]
    : [];

  const row = summaryToRow(cfg, source, folder, item);
  const inserted = await db
    .insert(mailMessages)
    .values({
      ...row,
      inReplyTo: parsed?.inReplyTo ?? null,
      referencesHdrs: references,
      snippet: buildSnippet(textBody),
      hasAttachments: attachments.length > 0 || row.hasAttachments,
    })
    .onConflictDoNothing()
    .returning({ id: mailMessages.id });

  const created = inserted[0];
  if (!created) return null;

  if (textBody !== null || htmlSanitized !== null) {
    await db
      .insert(mailMessageBodies)
      .values({ messageId: created.id, textBody, htmlSanitized })
      .onConflictDoNothing();
  }
  if (attachments.length > 0) {
    await db.insert(mailAttachments).values(
      attachments.map((a, i) => ({
        messageId: created.id,
        filename: a.filename ?? null,
        mime: a.mime ?? null,
        size: a.size ?? null,
        partId: String(i),
      })),
    );
  }

  return {
    id: created.id,
    subject: item.subject,
    fromEmail: item.from?.address?.toLowerCase() ?? null,
    fromName: item.from?.name ?? null,
    snippet: buildSnippet(textBody),
  };
}

async function upsertEwsFolders(client: EwsClient, cfg: EwsMailAccountConfig, source: SourceRow) {
  const remote = await client.getWellKnownFolders();
  for (const f of remote) {
    const role = ROLE_BY_WELL_KNOWN[f.wellKnown];
    await db
      .insert(mailFolders)
      .values({
        userId: source.userId,
        accountId: cfg.accountId,
        path: f.wellKnown,
        displayName: f.displayName,
        role,
        ewsFolderId: f.folderId,
        syncEnabled: DEFAULT_SYNC_ROLES.has(role),
      })
      .onConflictDoUpdate({
        target: [mailFolders.accountId, mailFolders.path],
        set: {
          displayName: f.displayName,
          role,
          ewsFolderId: f.folderId,
          updatedAt: new Date(),
        },
      });
  }
}

const CAL_WINDOW_PAST_DAYS = 90;
const CAL_WINDOW_FUTURE_DAYS = 400;
/** Stabiler Platzhalter in calendars.caldavUrl für den Exchange-Standardkalender. */
const EWS_CALENDAR_URL = "ews://calendar";

/** MyResponseType (EWS) → PARTSTAT (iCalendar). */
function partstatFromResponseType(v: string | null): string | null {
  switch (v) {
    case "Accept":
      return "ACCEPTED";
    case "Decline":
      return "DECLINED";
    case "Tentative":
      return "TENTATIVE";
    case "NoResponseReceived":
      return "NEEDS-ACTION";
    default:
      return null; // Organizer/Unknown
  }
}

function calendarItemToValues(
  cfg: EwsMailAccountConfig,
  source: SourceRow,
  calendarId: string,
  item: EwsCalendarItem,
) {
  const partstat = partstatFromResponseType(item.myResponseType);
  return {
    userId: source.userId,
    calendarId,
    objectUrl: item.itemId,
    etag: item.changeKey,
    icalUid: item.uid,
    summary: item.subject,
    location: item.location,
    startsAt: item.start ? new Date(item.start) : null,
    endsAt: item.end ? new Date(item.end) : null,
    allDay: item.isAllDay,
    organizer: item.organizer
      ? {
          email: item.organizer.address?.toLowerCase(),
          name: item.organizer.name,
        }
      : item.myResponseType === "Organizer"
        ? { email: cfg.fromAddress.toLowerCase(), name: cfg.fromName ?? undefined }
        : null,
    attendees: partstat
      ? [{ email: cfg.fromAddress.toLowerCase(), self: true, partstat }]
      : [],
  };
}

/**
 * Exchange-Kalender über dieselbe EWS-Verbindung in die calendar_events-
 * Tabellen syncen. CalendarView löst Serien in Einzelvorkommen auf; der
 * ChangeKey dient als ETag-Äquivalent für die Änderungserkennung.
 */
async function syncEwsCalendar(
  client: EwsClient,
  cfg: EwsMailAccountConfig,
  source: SourceRow,
): Promise<DetectedChange[]> {
  const changes: DetectedChange[] = [];

  await db
    .insert(calendars)
    .values({
      userId: source.userId,
      ewsAccountId: cfg.accountId,
      caldavUrl: EWS_CALENDAR_URL,
      displayName: "Exchange-Kalender",
    })
    .onConflictDoUpdate({
      target: [calendars.ewsAccountId, calendars.caldavUrl],
      set: { updatedAt: new Date() },
    });
  const [calRow] = await db
    .select()
    .from(calendars)
    .where(
      and(eq(calendars.ewsAccountId, cfg.accountId), eq(calendars.caldavUrl, EWS_CALENDAR_URL)),
    );
  if (!calRow || !calRow.syncEnabled) return changes;

  const now = Date.now();
  const items = await client.findCalendarItems(
    new Date(now - CAL_WINDOW_PAST_DAYS * 86400_000).toISOString(),
    new Date(now + CAL_WINDOW_FUTURE_DAYS * 86400_000).toISOString(),
  );

  const existing = await db
    .select({
      id: calendarEvents.id,
      objectUrl: calendarEvents.objectUrl,
      etag: calendarEvents.etag,
      attendees: calendarEvents.attendees,
    })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.calendarId, calRow.id), isNull(calendarEvents.deletedAt)));
  const existingByUrl = new Map(existing.map((e) => [e.objectUrl, e]));
  const seenUrls = new Set<string>();

  for (const item of items) {
    seenUrls.add(item.itemId);
    const values = calendarItemToValues(cfg, source, calRow.id, item);
    const prev = existingByUrl.get(item.itemId);
    const payload = {
      eventId: "",
      calendarId: calRow.id,
      summary: item.subject,
      startsAt: values.startsAt?.toISOString() ?? null,
      organizerEmail: values.organizer?.email ?? null,
      selfPartstat: partstatFromResponseType(item.myResponseType),
    };

    if (!prev) {
      const [row] = await db
        .insert(calendarEvents)
        .values(values)
        .onConflictDoUpdate({
          target: [calendarEvents.calendarId, calendarEvents.objectUrl],
          set: { etag: values.etag, deletedAt: null, updatedAt: new Date() },
        })
        .returning({ id: calendarEvents.id });
      if (row) {
        changes.push({
          kind: "event.new",
          externalRef: row.id,
          dedupKey: `cal:${calRow.id}:${item.itemId}:${item.changeKey ?? "new"}`,
          payload: { ...payload, eventId: row.id },
        });
      }
    } else if (prev.etag !== item.changeKey) {
      await db
        .update(calendarEvents)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(calendarEvents.id, prev.id));
      changes.push({
        kind: "event.updated",
        externalRef: prev.id,
        dedupKey: `cal:${calRow.id}:${item.itemId}:${item.changeKey ?? "upd"}`,
        payload: { ...payload, eventId: prev.id },
      });
    }
  }

  // Verschwundene Einträge im Fenster als gelöscht markieren (kein Trigger).
  for (const e of existing) {
    if (!seenUrls.has(e.objectUrl)) {
      await db
        .update(calendarEvents)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(calendarEvents.id, e.id));
    }
  }

  return changes;
}

export async function syncEwsMailSource(
  cfg: EwsMailAccountConfig,
  source: SourceRow,
): Promise<DetectedChange[]> {
  const changes: DetectedChange[] = [];
  const client = new EwsClient(cfg);
  try {
    await upsertEwsFolders(client, cfg, source);

    const folders = await db
      .select()
      .from(mailFolders)
      .where(
        and(eq(mailFolders.accountId, cfg.accountId), eq(mailFolders.syncEnabled, true)),
      );

    for (const folder of folders) {
      if (!folder.ewsFolderId) continue;

      // Ordner-Baseline: erster Durchlauf erfasst den Bestand ohne Trigger
      // und ohne Bodies (analog zum IMAP-Backfill), begrenzt auf das
      // Baseline-Fenster.
      const folderIsBaseline = folder.ewsSyncState === null;
      const baselineCutoff = Date.now() - BASELINE_WINDOW_DAYS * 86400_000;
      let syncState = folder.ewsSyncState;
      let batches = 0;

      while (batches < MAX_BATCHES_PER_FOLDER) {
        batches++;
        const result = await client.syncFolderItems(
          folder.ewsFolderId,
          syncState,
          SYNC_BATCH_SIZE,
        );
        syncState = result.syncState;

        for (const item of result.created) {
          if (folderIsBaseline) {
            // Nur Mails im Baseline-Fenster aufnehmen; ältere überspringen
            // (der SyncState oben deckt sie trotzdem ab → korrekte Deltas).
            const effectiveDate = item.receivedAt ?? item.sentAt;
            if (effectiveDate && new Date(effectiveDate).getTime() < baselineCutoff) {
              continue;
            }
            await db
              .insert(mailMessages)
              .values(summaryToRow(cfg, source, folder, item))
              .onConflictDoNothing();
            continue;
          }
          const ingested = await ingestFullEwsMessage(client, cfg, source, folder, item);
          if (ingested) {
            changes.push({
              kind: "mail.new",
              externalRef: ingested.id,
              dedupKey: `mail:${cfg.accountId}:${folder.id}:ews:${item.itemId}`,
              payload: {
                messageId: ingested.id,
                accountId: cfg.accountId,
                folderId: folder.id,
                subject: ingested.subject,
                fromEmail: ingested.fromEmail,
                fromName: ingested.fromName,
                snippet: ingested.snippet,
              },
            });
          }
        }

        // Geänderte Items: nur Flags nachziehen (kein Trigger, wie bei IMAP).
        for (const item of result.updated) {
          await db
            .update(mailMessages)
            .set({ seen: item.isRead, updatedAt: new Date() })
            .where(
              and(
                eq(mailMessages.folderId, folder.id),
                eq(mailMessages.ewsItemId, item.itemId),
              ),
            );
        }
        for (const change of result.readFlagChanges) {
          await db
            .update(mailMessages)
            .set({ seen: change.isRead, updatedAt: new Date() })
            .where(
              and(
                eq(mailMessages.folderId, folder.id),
                eq(mailMessages.ewsItemId, change.itemId),
              ),
            );
        }
        // Gelöschte/verschobene Items entfernen (Bodies/Anhänge kaskadieren).
        for (const itemId of result.deletedItemIds) {
          await db
            .delete(mailMessages)
            .where(
              and(
                eq(mailMessages.folderId, folder.id),
                eq(mailMessages.ewsItemId, itemId),
              ),
            );
        }

        // Baseline: Fortschritt pro Batch sichern (kein Trigger-Verlust
        // möglich, da Baseline keine Trigger erzeugt).
        if (folderIsBaseline) {
          await db
            .update(mailFolders)
            .set({ ewsSyncState: syncState, updatedAt: new Date() })
            .where(eq(mailFolders.id, folder.id));
        }

        if (result.includesLastItem) break;
      }

      await db
        .update(mailFolders)
        .set({ ewsSyncState: syncState, updatedAt: new Date() })
        .where(eq(mailFolders.id, folder.id));
    }

    // Kalender über dieselbe (bereits authentifizierte) Verbindung syncen.
    changes.push(...(await syncEwsCalendar(client, cfg, source)));
  } finally {
    client.close();
  }
  return changes;
}
