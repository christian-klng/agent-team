import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { dataSources } from "./sources";

export const agents = pgTable("agents", {
  id: uuid().primaryKey().defaultRandom(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text().notNull(),
  description: text(),
  color: text().notNull().default("#8b5cf6"),
  /** Slug für den Skill-Ordner im Agent-Workspace. */
  skillName: text().notNull(),
  /** Quelle der Wahrheit für den Skill; wird pro Run in den Workspace materialisiert. */
  skillMarkdown: text().notNull(),
  model: text().notNull().default("claude-sonnet-4-5"),
  maxTurns: integer().notNull().default(15),
  enabledTools: jsonb().$type<string[]>().notNull().default([]),
  enabled: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const agentTriggers = pgTable("agent_triggers", {
  id: uuid().primaryKey().defaultRandom(),
  agentId: uuid()
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  dataSourceId: uuid()
    .notNull()
    .references(() => dataSources.id, { onDelete: "cascade" }),
  eventKinds: jsonb().$type<string[]>().notNull().default([]),
  filter: jsonb()
    .$type<{
      folderIds?: string[];
      calendarIds?: string[];
      senderPattern?: string;
      pathPrefix?: string;
    }>()
    .notNull()
    .default({}),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const agentMemories = pgTable("agent_memories", {
  agentId: uuid()
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  content: text().notNull().default(""),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const triggerEvents = pgTable(
  "trigger_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    dataSourceId: uuid()
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    /** Referenz auf den Auslöser: mail_messages.id, calendar_events.id oder Dateipfad. */
    externalRef: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    dedupKey: text().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trigger_events_dedup_key").on(t.dedupKey),
    index("trigger_events_source").on(t.dataSourceId),
  ],
);

export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** null = manueller Start / Testlauf. */
    triggerEventId: uuid().references(() => triggerEvents.id, {
      onDelete: "set null",
    }),
    status: runStatus().notNull().default("queued"),
    sdkSessionId: text(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    error: text(),
    numTurns: integer().notNull().default(0),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    cacheReadTokens: integer().notNull().default(0),
    costUsd: numeric({ precision: 12, scale: 6 }).notNull().default("0"),
    modelUsage: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_runs_agent").on(t.agentId, t.createdAt),
    index("agent_runs_user_status").on(t.userId, t.status),
  ],
);

export const runEventType = pgEnum("run_event_type", [
  "trigger",
  "assistant_text",
  "tool_call",
  "tool_result",
  "user_message",
  "decision_created",
  "result",
  "error",
]);

export const agentRunEvents = pgTable(
  "agent_run_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid()
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    type: runEventType().notNull(),
    content: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_run_events_run_seq").on(t.runId, t.seq)],
);
