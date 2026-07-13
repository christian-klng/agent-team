import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { caldavAccounts } from "./sources";

export const calendars = pgTable(
  "calendars",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => caldavAccounts.id, { onDelete: "cascade" }),
    caldavUrl: text().notNull(),
    displayName: text().notNull(),
    color: text(),
    ctag: text(),
    syncToken: text(),
    syncEnabled: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calendars_account_url").on(t.accountId, t.caldavUrl)],
);

export type EventAttendee = {
  email?: string;
  name?: string;
  partstat?: string;
  self?: boolean;
};

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    calendarId: uuid()
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    objectUrl: text().notNull(),
    etag: text(),
    icalUid: text(),
    summary: text().notNull().default(""),
    description: text(),
    location: text(),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    allDay: boolean().notNull().default(false),
    rrule: text(),
    status: text(),
    organizer: jsonb().$type<{ email?: string; name?: string }>(),
    attendees: jsonb().$type<EventAttendee[]>().notNull().default([]),
    /** Roh-ICS wird für RSVP-Antworten benötigt. */
    rawIcs: text(),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("calendar_events_calendar_url").on(t.calendarId, t.objectUrl),
    index("calendar_events_user_starts").on(t.userId, t.startsAt),
  ],
);
