import { requireUserId } from "@/lib/api-auth";
import { calendarEvents, db } from "@agent-team/db";
import { and, eq, gte, isNull, lte, or, isNotNull, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { RRule } from "rrule";

const MAX_OCCURRENCES_PER_EVENT = 200;

/**
 * Termine in einem Zeitfenster; wiederkehrende Termine werden serverseitig
 * zu Einzelvorkommen expandiert.
 */
export async function GET(req: Request) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const url = new URL(req.url);
  const from = new Date(url.searchParams.get("from") ?? Date.now() - 30 * 86400_000);
  const to = new Date(url.searchParams.get("to") ?? Date.now() + 60 * 86400_000);

  const conditions: SQL[] = [
    eq(calendarEvents.userId, userId),
    isNull(calendarEvents.deletedAt),
  ];

  // Einzeltermine im Fenster ODER wiederkehrende (rrule) — letztere expandieren wir unten.
  conditions.push(
    or(
      and(gte(calendarEvents.startsAt, from), lte(calendarEvents.startsAt, to)),
      and(
        isNotNull(calendarEvents.rrule),
        lte(calendarEvents.startsAt, to),
      ),
    )!,
  );

  const rows = await db
    .select({
      id: calendarEvents.id,
      calendarId: calendarEvents.calendarId,
      summary: calendarEvents.summary,
      description: calendarEvents.description,
      location: calendarEvents.location,
      startsAt: calendarEvents.startsAt,
      endsAt: calendarEvents.endsAt,
      allDay: calendarEvents.allDay,
      rrule: calendarEvents.rrule,
      status: calendarEvents.status,
      organizer: calendarEvents.organizer,
      attendees: calendarEvents.attendees,
    })
    .from(calendarEvents)
    .where(and(...conditions))
    .limit(2000);

  const occurrences: unknown[] = [];
  for (const ev of rows) {
    if (!ev.startsAt) continue;
    const durationMs = ev.endsAt ? ev.endsAt.getTime() - ev.startsAt.getTime() : 3600_000;

    if (!ev.rrule) {
      occurrences.push({ ...ev, occurrenceStart: ev.startsAt, occurrenceEnd: ev.endsAt });
      continue;
    }
    try {
      const rule = new RRule({
        ...RRule.parseString(ev.rrule.replace(/^RRULE:/i, "")),
        dtstart: ev.startsAt,
      });
      const starts = rule.between(from, to, true).slice(0, MAX_OCCURRENCES_PER_EVENT);
      for (const start of starts) {
        occurrences.push({
          ...ev,
          occurrenceStart: start,
          occurrenceEnd: new Date(start.getTime() + durationMs),
        });
      }
    } catch {
      // Ungültige RRULE: als Einzeltermin behandeln.
      occurrences.push({ ...ev, occurrenceStart: ev.startsAt, occurrenceEnd: ev.endsAt });
    }
  }

  return NextResponse.json(occurrences);
}
