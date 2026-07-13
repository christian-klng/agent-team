import { calendarEvents, calendars, db } from "@agent-team/db";
import { and, eq, isNull } from "drizzle-orm";
import ical from "node-ical";
import { createCaldavClient } from "../connectors/caldav";
import type { CaldavAccountConfig, SourceRow } from "../sources";
import type { DetectedChange } from "./types";

const WINDOW_PAST_DAYS = 90;
const WINDOW_FUTURE_DAYS = 400;

interface ParsedEvent {
  icalUid: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  allDay: boolean;
  rrule: string | null;
  status: string | null;
  organizer: { email?: string; name?: string } | null;
  attendees: { email?: string; name?: string; partstat?: string; self?: boolean }[];
}

function parseAttendee(
  raw: unknown,
  selfEmail: string,
): { email?: string; name?: string; partstat?: string; self?: boolean } | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const email = raw.replace(/^mailto:/i, "").toLowerCase();
    return { email, self: email === selfEmail };
  }
  const obj = raw as { params?: Record<string, unknown>; val?: string };
  const email = obj.val
    ? String(obj.val).replace(/^mailto:/i, "").toLowerCase()
    : undefined;
  return {
    email,
    name: obj.params?.CN ? String(obj.params.CN) : undefined,
    partstat: obj.params?.PARTSTAT ? String(obj.params.PARTSTAT) : undefined,
    self: !!email && email === selfEmail,
  };
}

export function parseIcsEvent(icsData: string, selfEmail: string): ParsedEvent | null {
  const parsed = ical.sync.parseICS(icsData);
  const vevent = Object.values(parsed).find((c) => c?.type === "VEVENT") as
    | ical.VEvent
    | undefined;
  if (!vevent) return null;

  const rawAttendees = vevent.attendee
    ? Array.isArray(vevent.attendee)
      ? vevent.attendee
      : [vevent.attendee]
    : [];

  const organizerRaw = vevent.organizer as unknown as
    | { params?: Record<string, unknown>; val?: string }
    | string
    | undefined;
  const organizer =
    typeof organizerRaw === "string"
      ? { email: organizerRaw.replace(/^mailto:/i, "").toLowerCase() }
      : organizerRaw?.val
        ? {
            email: String(organizerRaw.val).replace(/^mailto:/i, "").toLowerCase(),
            name: organizerRaw.params?.CN ? String(organizerRaw.params.CN) : undefined,
          }
        : null;

  return {
    icalUid: vevent.uid ? String(vevent.uid) : null,
    summary: vevent.summary ? String(vevent.summary) : "",
    description: vevent.description ? String(vevent.description) : null,
    location: vevent.location ? String(vevent.location) : null,
    startsAt: vevent.start ?? null,
    endsAt: vevent.end ?? null,
    allDay: vevent.datetype === "date",
    rrule: vevent.rrule ? vevent.rrule.toString() : null,
    status: (vevent.status as string | undefined) ?? null,
    organizer,
    attendees: rawAttendees
      .map((a) => parseAttendee(a, selfEmail))
      .filter((a): a is NonNullable<typeof a> => a !== null),
  };
}

export async function syncCaldavSource(
  cfg: CaldavAccountConfig,
  source: SourceRow,
): Promise<DetectedChange[]> {
  const changes: DetectedChange[] = [];
  const client = await createCaldavClient(cfg);
  const remoteCalendars = await client.fetchCalendars();
  const selfEmail = cfg.username.toLowerCase();

  for (const remote of remoteCalendars) {
    if (!remote.url) continue;
    const displayName =
      typeof remote.displayName === "string" && remote.displayName
        ? remote.displayName
        : "Kalender";

    await db
      .insert(calendars)
      .values({
        userId: source.userId,
        accountId: cfg.accountId,
        caldavUrl: remote.url,
        displayName,
        ctag: null, // erst nach erfolgreichem Objekt-Sync setzen
      })
      .onConflictDoUpdate({
        target: [calendars.accountId, calendars.caldavUrl],
        set: { displayName, updatedAt: new Date() },
      });

    const [calRow] = await db
      .select()
      .from(calendars)
      .where(
        and(eq(calendars.accountId, cfg.accountId), eq(calendars.caldavUrl, remote.url)),
      );
    if (!calRow || !calRow.syncEnabled) continue;

    const remoteCtag = (remote.ctag as string | undefined) ?? null;
    if (remoteCtag && calRow.ctag === remoteCtag) continue; // nichts geändert

    const now = Date.now();
    const objects = await client.fetchCalendarObjects({
      calendar: remote,
      timeRange: {
        start: new Date(now - WINDOW_PAST_DAYS * 86400_000).toISOString(),
        end: new Date(now + WINDOW_FUTURE_DAYS * 86400_000).toISOString(),
      },
    });

    const existing = await db
      .select({
        id: calendarEvents.id,
        objectUrl: calendarEvents.objectUrl,
        etag: calendarEvents.etag,
      })
      .from(calendarEvents)
      .where(
        and(eq(calendarEvents.calendarId, calRow.id), isNull(calendarEvents.deletedAt)),
      );
    const existingByUrl = new Map(existing.map((e) => [e.objectUrl, e]));
    const seenUrls = new Set<string>();

    for (const obj of objects) {
      if (!obj.url || !obj.data) continue;
      seenUrls.add(obj.url);
      const parsed = parseIcsEvent(obj.data, selfEmail);
      if (!parsed) continue;
      const etag = obj.etag ?? null;
      const prev = existingByUrl.get(obj.url);

      if (!prev) {
        const [row] = await db
          .insert(calendarEvents)
          .values({
            userId: source.userId,
            calendarId: calRow.id,
            objectUrl: obj.url,
            etag,
            icalUid: parsed.icalUid,
            summary: parsed.summary,
            description: parsed.description,
            location: parsed.location,
            startsAt: parsed.startsAt,
            endsAt: parsed.endsAt,
            allDay: parsed.allDay,
            rrule: parsed.rrule,
            status: parsed.status,
            organizer: parsed.organizer,
            attendees: parsed.attendees,
            rawIcs: obj.data,
          })
          .onConflictDoUpdate({
            target: [calendarEvents.calendarId, calendarEvents.objectUrl],
            set: { etag, rawIcs: obj.data, deletedAt: null, updatedAt: new Date() },
          })
          .returning({ id: calendarEvents.id });
        if (row) {
          changes.push({
            kind: "event.new",
            externalRef: row.id,
            dedupKey: `cal:${calRow.id}:${obj.url}:${etag ?? "new"}`,
            payload: {
              eventId: row.id,
              calendarId: calRow.id,
              summary: parsed.summary,
              startsAt: parsed.startsAt?.toISOString() ?? null,
              organizerEmail: parsed.organizer?.email ?? null,
              selfPartstat:
                parsed.attendees.find((a) => a.self)?.partstat ?? null,
            },
          });
        }
      } else if (prev.etag !== etag) {
        await db
          .update(calendarEvents)
          .set({
            etag,
            icalUid: parsed.icalUid,
            summary: parsed.summary,
            description: parsed.description,
            location: parsed.location,
            startsAt: parsed.startsAt,
            endsAt: parsed.endsAt,
            allDay: parsed.allDay,
            rrule: parsed.rrule,
            status: parsed.status,
            organizer: parsed.organizer,
            attendees: parsed.attendees,
            rawIcs: obj.data,
            updatedAt: new Date(),
          })
          .where(eq(calendarEvents.id, prev.id));
        changes.push({
          kind: "event.updated",
          externalRef: prev.id,
          dedupKey: `cal:${calRow.id}:${obj.url}:${etag ?? "upd"}`,
          payload: {
            eventId: prev.id,
            calendarId: calRow.id,
            summary: parsed.summary,
            startsAt: parsed.startsAt?.toISOString() ?? null,
            organizerEmail: parsed.organizer?.email ?? null,
            selfPartstat: parsed.attendees.find((a) => a.self)?.partstat ?? null,
          },
        });
      }
    }

    // Verschwundene Objekte im Fenster als gelöscht markieren (kein Trigger).
    for (const e of existing) {
      if (!seenUrls.has(e.objectUrl)) {
        await db
          .update(calendarEvents)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(calendarEvents.id, e.id));
      }
    }

    await db
      .update(calendars)
      .set({ ctag: remoteCtag, updatedAt: new Date() })
      .where(eq(calendars.id, calRow.id));
  }

  return changes;
}
