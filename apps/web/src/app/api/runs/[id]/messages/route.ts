import { requireUserId } from "@/lib/api-auth";
import { agentFollowupQueue } from "@agent-team/core";
import { agentRuns, db } from "@agent-team/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Nutzer-Nachfrage an einen abgeschlossenen Lauf (Session-Resume). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const [run] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, id), eq(agentRuns.userId, userId)));
  if (!run) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (run.status === "queued" || run.status === "running") {
    return NextResponse.json(
      { error: "Der Lauf ist noch aktiv — bitte warten." },
      { status: 409 },
    );
  }
  if (!run.sdkSessionId) {
    return NextResponse.json(
      { error: "Für diesen Lauf ist keine Session vorhanden." },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = z.object({ message: z.string().min(1).max(10_000) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  await agentFollowupQueue().add(
    "followup",
    { runId: run.id, message: parsed.data.message },
    { attempts: 1 },
  );

  return NextResponse.json({ ok: true }, { status: 202 });
}
