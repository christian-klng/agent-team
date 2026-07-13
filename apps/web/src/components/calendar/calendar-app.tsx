"use client";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { de } from "date-fns/locale";
import { ChevronLeft, ChevronRight, MapPin, Users } from "lucide-react";
import { useMemo, useState } from "react";

interface CalendarInfo {
  id: string;
  displayName: string;
  color: string;
  accountName: string;
}

interface EventOccurrence {
  id: string;
  calendarId: string;
  summary: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  status: string | null;
  organizer: { email?: string; name?: string } | null;
  attendees: { email?: string; name?: string; partstat?: string; self?: boolean }[];
  occurrenceStart: string;
  occurrenceEnd: string | null;
}

type ViewMode = "monat" | "woche" | "agenda";

function EventChip({
  event,
  color,
  compact,
}: {
  event: EventOccurrence;
  color: string;
  compact?: boolean;
}) {
  const start = new Date(event.occurrenceStart);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(
              "block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] leading-tight text-white",
              compact && "py-px",
            )}
            style={{ backgroundColor: color }}
          >
            {!event.allDay && format(start, "HH:mm") + " "}
            {event.summary || "(ohne Titel)"}
          </button>
        }
      />
      <PopoverContent className="w-72 text-sm">
        <p className="font-medium">{event.summary || "(ohne Titel)"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {event.allDay
            ? format(start, "EEEE, d. MMMM yyyy", { locale: de }) + " · ganztägig"
            : `${format(start, "EEE, d. MMM HH:mm", { locale: de })}${
                event.occurrenceEnd
                  ? ` – ${format(new Date(event.occurrenceEnd), "HH:mm")}`
                  : ""
              }`}
        </p>
        {event.location && (
          <p className="mt-2 flex items-center gap-1.5 text-xs">
            <MapPin className="size-3" /> {event.location}
          </p>
        )}
        {event.attendees.length > 0 && (
          <p className="mt-1 flex items-start gap-1.5 text-xs">
            <Users className="mt-0.5 size-3 shrink-0" />
            <span>
              {event.attendees
                .map((a) => `${a.name || a.email}${a.self ? " (du)" : ""}`)
                .join(", ")}
            </span>
          </p>
        )}
        {event.description && (
          <p className="mt-2 line-clamp-4 text-xs text-muted-foreground">
            {event.description}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function CalendarApp() {
  const [view, setView] = useState<ViewMode>("monat");
  const [anchor, setAnchor] = useState(() => new Date());
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const range = useMemo(() => {
    if (view === "monat") {
      return {
        from: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
        to: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }),
      };
    }
    if (view === "woche") {
      return {
        from: startOfWeek(anchor, { weekStartsOn: 1 }),
        to: endOfWeek(anchor, { weekStartsOn: 1 }),
      };
    }
    return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 30) };
  }, [view, anchor]);

  const { data: calendars = [] } = useQuery({
    queryKey: ["calendar", "calendars"],
    queryFn: () => api.get<CalendarInfo[]>("/api/calendar/calendars"),
  });
  const { data: events = [] } = useQuery({
    queryKey: ["calendar", "events", range.from.toISOString(), range.to.toISOString()],
    queryFn: () =>
      api.get<EventOccurrence[]>(
        `/api/calendar/events?from=${range.from.toISOString()}&to=${range.to.toISOString()}`,
      ),
  });

  const colorById = useMemo(
    () => new Map(calendars.map((c) => [c.id, c.color])),
    [calendars],
  );
  const visibleEvents = useMemo(
    () => events.filter((e) => !hidden.has(e.calendarId)),
    [events, hidden],
  );
  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventOccurrence[]>();
    for (const e of visibleEvents) {
      const key = format(new Date(e.occurrenceStart), "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
    }
    return map;
  }, [visibleEvents]);

  function navigate(dir: -1 | 1) {
    setAnchor((d) =>
      view === "monat" ? addMonths(d, dir) : view === "woche" ? addWeeks(d, dir) : addDays(d, dir * 30),
    );
  }

  const title =
    view === "monat"
      ? format(anchor, "MMMM yyyy", { locale: de })
      : view === "woche"
        ? `KW ${format(anchor, "w", { locale: de })} · ${format(range.from, "d. MMM", { locale: de })} – ${format(range.to, "d. MMM yyyy", { locale: de })}`
        : `${format(range.from, "d. MMM", { locale: de })} – ${format(range.to, "d. MMM yyyy", { locale: de })}`;

  const days = eachDayOfInterval({ start: range.from, end: range.to });

  return (
    <div className="flex h-full">
      {/* Kalender-Liste */}
      <aside className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-sidebar p-3 lg:flex">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Kalender</p>
        {calendars.map((cal) => {
          const isHidden = hidden.has(cal.id);
          return (
            <button
              key={cal.id}
              onClick={() =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(cal.id)) next.delete(cal.id);
                  else next.add(cal.id);
                  return next;
                })
              }
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50",
                isHidden && "opacity-40",
              )}
            >
              <span
                className="size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: cal.color }}
              />
              <span className="min-w-0 flex-1 truncate text-left">{cal.displayName}</span>
            </button>
          );
        })}
        {calendars.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Kein Kalender verbunden. Lege in den Einstellungen eine
            CalDAV-Datenquelle an.
          </p>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Kopfzeile */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => navigate(1)}>
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
            Heute
          </Button>
          <h1 className="ml-2 min-w-0 flex-1 truncate text-sm font-semibold md:text-base">
            {title}
          </h1>
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="monat">Monat</TabsTrigger>
              <TabsTrigger value="woche">Woche</TabsTrigger>
              <TabsTrigger value="agenda">Agenda</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Monatsansicht */}
        {view === "monat" && (
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto_repeat(6,1fr)] overflow-y-auto">
            {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
              <div key={d} className="border-b px-2 py-1 text-center text-xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {days.map((day) => {
              const dayEvents = eventsByDay.get(format(day, "yyyy-MM-dd")) ?? [];
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "min-h-20 border-r border-b p-1",
                    !isSameMonth(day, anchor) && "bg-muted/40",
                  )}
                >
                  <span
                    className={cn(
                      "mb-1 inline-flex size-5 items-center justify-center rounded-full text-[11px]",
                      isToday(day)
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  <div className="grid gap-0.5">
                    {dayEvents.slice(0, 3).map((e, i) => (
                      <EventChip
                        key={`${e.id}-${e.occurrenceStart}-${i}`}
                        event={e}
                        color={colorById.get(e.calendarId) ?? "#64748b"}
                        compact
                      />
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="px-1 text-[10px] text-muted-foreground">
                        +{dayEvents.length - 3} weitere
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Wochenansicht */}
        {view === "woche" && (
          <div className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto">
            {days.slice(0, 7).map((day) => {
              const dayEvents = eventsByDay.get(format(day, "yyyy-MM-dd")) ?? [];
              return (
                <div key={day.toISOString()} className="flex min-h-full flex-col border-r">
                  <div
                    className={cn(
                      "sticky top-0 border-b bg-background p-2 text-center text-xs",
                      isToday(day) && "font-semibold text-primary",
                    )}
                  >
                    {format(day, "EEE d.", { locale: de })}
                  </div>
                  <div className="grid content-start gap-1 p-1">
                    {dayEvents.map((e, i) => (
                      <EventChip
                        key={`${e.id}-${e.occurrenceStart}-${i}`}
                        event={e}
                        color={colorById.get(e.calendarId) ?? "#64748b"}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Agenda */}
        {view === "agenda" && (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {days
              .filter((day) => (eventsByDay.get(format(day, "yyyy-MM-dd")) ?? []).length > 0)
              .map((day) => {
                const dayEvents = eventsByDay.get(format(day, "yyyy-MM-dd")) ?? [];
                return (
                  <div key={day.toISOString()} className="mb-4">
                    <p
                      className={cn(
                        "mb-1 text-xs font-semibold",
                        isToday(day) ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {format(day, "EEEE, d. MMMM", { locale: de })}
                    </p>
                    <div className="grid gap-1">
                      {dayEvents.map((e, i) => (
                        <div key={`${e.id}-${i}`} className="flex items-center gap-3 rounded-md border p-2">
                          <span
                            className="h-8 w-1 shrink-0 rounded"
                            style={{ backgroundColor: colorById.get(e.calendarId) ?? "#64748b" }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {e.summary || "(ohne Titel)"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {e.allDay
                                ? "Ganztägig"
                                : `${format(new Date(e.occurrenceStart), "HH:mm")}${
                                    e.occurrenceEnd
                                      ? ` – ${format(new Date(e.occurrenceEnd), "HH:mm")}`
                                      : ""
                                  }`}
                              {e.location && ` · ${e.location}`}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            {visibleEvents.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Keine Termine in diesem Zeitraum.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
