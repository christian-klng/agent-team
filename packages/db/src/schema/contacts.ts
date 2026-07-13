import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { webdavStores } from "./sources";

export type PastEmployer = { name: string; from?: string; to?: string };

export const contacts = pgTable("contacts", {
  id: uuid().primaryKey().defaultRandom(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  displayName: text().notNull(),
  firstName: text(),
  lastName: text(),
  phone: text(),
  currentEmployer: text(),
  pastEmployers: jsonb().$type<PastEmployer[]>().notNull().default([]),
  notes: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const contactEmails = pgTable(
  "contact_emails",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    email: text().notNull(),
    label: text(),
    isPrimary: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex("contact_emails_user_email").on(t.userId, t.email)],
);

export const contactDocLinks = pgTable("contact_doc_links", {
  id: uuid().primaryKey().defaultRandom(),
  contactId: uuid()
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  storeId: uuid()
    .notNull()
    .references(() => webdavStores.id, { onDelete: "cascade" }),
  path: text().notNull(),
  /** true = ganzer Ordner inkl. Unterordner ist verknüpft. */
  includeChildren: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
