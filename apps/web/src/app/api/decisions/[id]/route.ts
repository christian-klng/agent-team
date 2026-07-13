import { requireUserId } from "@/lib/api-auth";
import { publishAppEvent } from "@agent-team/core";
import { db, decisionAudit, decisions } from "@agent-team/db";
import { decisionPayloadSchemas } from "@agent-team/shared";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Entwurf bearbeiten — nur solange die Entscheidung offen ist. */
export async function PATCH(
  req: Request,
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
  if (decision.status !== "open") {
    return NextResponse.json(
      { error: "Nur offene Entscheidungen können bearbeitet werden." },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = z.object({ payload: z.record(z.unknown()) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  const schema = decisionPayloadSchemas[decision.type];
  const validated = schema.safeParse(parsed.data.payload);
  if (!validated.success) {
    return NextResponse.json(
      {
        error: `Entwurf passt nicht zum Typ ${decision.type}`,
        details: validated.error.flatten(),
      },
      { status: 400 },
    );
  }

  await db
    .update(decisions)
    .set({ payload: validated.data as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(decisions.id, decision.id));
  await db.insert(decisionAudit).values({
    decisionId: decision.id,
    actor: "user",
    action: "edited",
    detail: {},
  });
  await publishAppEvent(userId, {
    type: "decision.changed",
    decisionId: decision.id,
    status: "open",
  });

  return NextResponse.json({ ok: true });
}
