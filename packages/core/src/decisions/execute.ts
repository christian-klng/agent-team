import { db, decisionAudit, decisions } from "@agent-team/db";
import { and, eq } from "drizzle-orm";
import { publishAppEvent } from "../events";
import { executeDecisionPayload } from "./executors";

/**
 * Führt eine freigegebene Entscheidung aus (Worker-Seite).
 * Statuskette: approved → executing → executed | failed. Kein Auto-Retry.
 */
export async function processApprovedDecision(decisionId: string): Promise<void> {
  // Guard: nur genau einmal von approved nach executing wechseln.
  const [decision] = await db
    .update(decisions)
    .set({ status: "executing", updatedAt: new Date() })
    .where(and(eq(decisions.id, decisionId), eq(decisions.status, "approved")))
    .returning();
  if (!decision) {
    console.log(`[decision] ${decisionId} ist nicht (mehr) freigegeben — übersprungen.`);
    return;
  }

  await db.insert(decisionAudit).values({
    decisionId: decision.id,
    actor: "system",
    action: "execute_started",
    detail: {},
  });
  await publishAppEvent(decision.userId, {
    type: "decision.changed",
    decisionId: decision.id,
    status: "executing",
  });

  try {
    const result = await executeDecisionPayload(decision.type, decision.payload, {
      userId: decision.userId,
    });
    await db
      .update(decisions)
      .set({
        status: "executed",
        executedAt: new Date(),
        executionResult: result,
        updatedAt: new Date(),
      })
      .where(eq(decisions.id, decision.id));
    await db.insert(decisionAudit).values({
      decisionId: decision.id,
      actor: "system",
      action: "execute_succeeded",
      detail: result,
    });
    await publishAppEvent(decision.userId, {
      type: "decision.changed",
      decisionId: decision.id,
      status: "executed",
    });
    console.log(`[decision] ${decision.type} "${decision.title}" ausgeführt.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(decisions)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(decisions.id, decision.id));
    await db.insert(decisionAudit).values({
      decisionId: decision.id,
      actor: "system",
      action: "execute_failed",
      detail: { error: message },
    });
    await publishAppEvent(decision.userId, {
      type: "decision.changed",
      decisionId: decision.id,
      status: "failed",
    });
    console.error(`[decision] ${decision.id} fehlgeschlagen:`, message);
  }
}
