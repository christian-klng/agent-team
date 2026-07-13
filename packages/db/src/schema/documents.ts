import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { webdavStores } from "./sources";

export const documentFiles = pgTable(
  "document_files",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    storeId: uuid()
      .notNull()
      .references(() => webdavStores.id, { onDelete: "cascade" }),
    path: text().notNull(),
    name: text().notNull(),
    isDir: boolean().notNull().default(false),
    etag: text(),
    size: bigint({ mode: "number" }),
    mime: text(),
    modifiedAt: timestamp({ withTimezone: true }),
    /** Soft-Delete: Datei ist im externen Speicher verschwunden. */
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("document_files_store_path").on(t.storeId, t.path),
    index("document_files_store_dir").on(t.storeId, t.isDir),
  ],
);
