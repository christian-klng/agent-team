import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const dataSourceType = pgEnum("data_source_type", [
  "email",
  "caldav",
  "webdav",
]);

export const syncStatus = pgEnum("sync_status", ["ok", "error", "running"]);

export const dataSources = pgTable("data_sources", {
  id: uuid().primaryKey().defaultRandom(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: dataSourceType().notNull(),
  name: text().notNull(),
  color: text().notNull().default("#6366f1"),
  enabled: boolean().notNull().default(true),
  /** Erst nach dem ersten vollständigen Sync erzeugen Änderungen Trigger-Events. */
  baselineCompletedAt: timestamp({ withTimezone: true }),
  lastSyncAt: timestamp({ withTimezone: true }),
  lastSyncStatus: syncStatus(),
  lastError: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const mailAccounts = pgTable("mail_accounts", {
  id: uuid().primaryKey().defaultRandom(),
  dataSourceId: uuid()
    .notNull()
    .unique()
    .references(() => dataSources.id, { onDelete: "cascade" }),
  imapHost: text().notNull(),
  imapPort: integer().notNull().default(993),
  imapTls: boolean().notNull().default(true),
  imapUser: text().notNull(),
  imapPasswordEnc: text().notNull(),
  smtpHost: text().notNull(),
  smtpPort: integer().notNull().default(465),
  smtpUser: text().notNull(),
  smtpPasswordEnc: text().notNull(),
  fromAddress: text().notNull(),
  fromName: text(),
});

export const caldavAccounts = pgTable("caldav_accounts", {
  id: uuid().primaryKey().defaultRandom(),
  dataSourceId: uuid()
    .notNull()
    .unique()
    .references(() => dataSources.id, { onDelete: "cascade" }),
  serverUrl: text().notNull(),
  username: text().notNull(),
  passwordEnc: text().notNull(),
});

export const webdavStores = pgTable("webdav_stores", {
  id: uuid().primaryKey().defaultRandom(),
  dataSourceId: uuid()
    .notNull()
    .unique()
    .references(() => dataSources.id, { onDelete: "cascade" }),
  baseUrl: text().notNull(),
  username: text().notNull(),
  passwordEnc: text().notNull(),
  /** Begrenzt Sync und Zugriff auf diesen Unterbaum. */
  rootPath: text().notNull().default("/"),
});
