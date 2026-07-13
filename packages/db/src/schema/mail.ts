import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { mailAccounts } from "./sources";

export const mailFolderRole = pgEnum("mail_folder_role", [
  "inbox",
  "sent",
  "drafts",
  "trash",
  "archive",
  "spam",
  "other",
]);

export const mailFolders = pgTable(
  "mail_folders",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => mailAccounts.id, { onDelete: "cascade" }),
    path: text().notNull(),
    displayName: text().notNull(),
    role: mailFolderRole().notNull().default("other"),
    uidvalidity: bigint({ mode: "number" }),
    lastSeenUid: bigint({ mode: "number" }).notNull().default(0),
    highestModseq: bigint({ mode: "bigint" }),
    syncEnabled: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mail_folders_account_path").on(t.accountId, t.path)],
);

export type EmailAddress = { name?: string; address: string };

export const mailMessages = pgTable(
  "mail_messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => mailAccounts.id, { onDelete: "cascade" }),
    folderId: uuid()
      .notNull()
      .references(() => mailFolders.id, { onDelete: "cascade" }),
    uid: bigint({ mode: "number" }).notNull(),
    messageIdHdr: text(),
    inReplyTo: text(),
    referencesHdrs: jsonb().$type<string[]>().notNull().default([]),
    subject: text().notNull().default(""),
    fromName: text(),
    fromEmail: text(),
    toAddrs: jsonb().$type<EmailAddress[]>().notNull().default([]),
    ccAddrs: jsonb().$type<EmailAddress[]>().notNull().default([]),
    sentAt: timestamp({ withTimezone: true }),
    seen: boolean().notNull().default(false),
    answered: boolean().notNull().default(false),
    flagged: boolean().notNull().default(false),
    snippet: text().notNull().default(""),
    hasAttachments: boolean().notNull().default(false),
    size: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_messages_folder_uid").on(t.folderId, t.uid),
    index("mail_messages_user_sent").on(t.userId, t.sentAt),
    index("mail_messages_from_email").on(t.fromEmail),
    index("mail_messages_message_id_hdr").on(t.messageIdHdr),
  ],
);

export const mailMessageBodies = pgTable("mail_message_bodies", {
  messageId: uuid()
    .primaryKey()
    .references(() => mailMessages.id, { onDelete: "cascade" }),
  textBody: text(),
  htmlSanitized: text(),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const mailAttachments = pgTable("mail_attachments", {
  id: uuid().primaryKey().defaultRandom(),
  messageId: uuid()
    .notNull()
    .references(() => mailMessages.id, { onDelete: "cascade" }),
  filename: text(),
  mime: text(),
  size: integer(),
  /** IMAP-BODYSTRUCTURE-Part-ID für On-Demand-Download. */
  partId: text(),
});
