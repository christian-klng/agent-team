import { requireUserId } from "@/lib/api-auth";
import { publishAppEvent } from "@agent-team/core";
import { db, decisionAudit, decisions } from "@agent-team/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const [updated] = await db
    .update(decisions)
    .set({ status: "rejected", decidedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(decisions.id, id),
        eq(decisions.userId, userId),
        eq(decisions.status, "open"),
      ),
    )
    .returning();
  if (!updated) {
    return NextResponse.json(
      { error: "Entscheidung ist nicht (mehr) offen." },
      { status: 409 },
    );
  }

  await db.insert(decisionAudit).values({
    decisionId: updated.id,
    actor: "user",
    action: "rejected",
    detail: {},
  });
  await publishAppEvent(userId, {
    type: "decision.changed",
    decisionId: updated.id,
    status: "rejected",
  });

  return NextResponse.json({ ok: true });
}
