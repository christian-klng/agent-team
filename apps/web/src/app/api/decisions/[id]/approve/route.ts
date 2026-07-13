import { requireUserId } from "@/lib/api-auth";
import { executeDecisionQueue, publishAppEvent } from "@agent-team/core";
import { db, decisionAudit, decisions } from "@agent-team/db";
import { decisionPayloadSchemas } from "@agent-team/shared";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Freigabe durch den Nutzer — der einzige Weg, eine Aktion auszulösen.
 * Idempotenz-Guard: UPDATE nur wenn status='open'.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const [decision] = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.id, id), eq(decisions.userId, userId)));
  if (!decision) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Finale Validierung des (ggf. editierten) Entwurfs.
  const schema = decisionPayloadSchemas[decision.type];
  const validated = schema.safeParse(decision.payload);
  if (!validated.success) {
    return NextResponse.json(
      { error: "Der Entwurf ist unvollständig oder ungültig.", details: validated.error.flatten() },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(decisions)
    .set({ status: "approved", decidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(decisions.id, decision.id), eq(decisions.status, "open")))
    .returning();
  if (!updated) {
    return NextResponse.json(
      { error: "Entscheidung ist nicht (mehr) offen." },
      { status: 409 },
    );
  }

  await db.insert(decisionAudit).values({
    decisionId: decision.id,
    actor: "user",
    action: "approved",
    detail: {},
  });
  await executeDecisionQueue().add(
    "execute",
    { decisionId: decision.id },
    { jobId: `decision-${decision.id}`, attempts: 1 },
  );
  await publishAppEvent(userId, {
    type: "decision.changed",
    decisionId: decision.id,
    status: "approved",
  });

  return NextResponse.json({ ok: true });
}
