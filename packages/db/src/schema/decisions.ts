import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agentRuns, agents } from "./agents";
import { user } from "./auth";

export const decisionType = pgEnum("decision_type", [
  "email_send",
  "event_rsvp",
  "document_write",
  "contact_upsert",
  "skill_update",
]);

export const decisionStatus = pgEnum("decision_status", [
  "open",
  "approved",
  "executing",
  "executed",
  "rejected",
  "failed",
]);

export const decisions = pgTable(
  "decisions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    runId: uuid()
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    type: decisionType().notNull(),
    status: decisionStatus().notNull().default("open"),
    title: text().notNull(),
    summary: text().notNull().default(""),
    /** Aktueller, vom Nutzer editierbarer Entwurf. */
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    /** Unverändertes Agent-Original für Diff-Anzeige. */
    originalPayload: jsonb().$type<Record<string, unknown>>().notNull(),
    /** Referenzen auf den Kontext (messageId, eventId, path, contactId …). */
    context: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    decidedAt: timestamp({ withTimezone: true }),
    executedAt: timestamp({ withTimezone: true }),
    executionResult: jsonb().$type<Record<string, unknown>>(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("decisions_user_status").on(t.userId, t.status),
    index("decisions_run").on(t.runId),
  ],
);

export const auditActor = pgEnum("audit_actor", ["agent", "user", "system"]);

export const auditAction = pgEnum("audit_action", [
  "created",
  "edited",
  "approved",
  "rejected",
  "execute_started",
  "execute_succeeded",
  "execute_failed",
]);

export const decisionAudit = pgTable(
  "decision_audit",
  {
    id: uuid().primaryKey().defaultRandom(),
    decisionId: uuid()
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    actor: auditActor().notNull(),
    action: auditAction().notNull(),
    detail: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("decision_audit_decision").on(t.decisionId)],
);
