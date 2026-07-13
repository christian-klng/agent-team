import { requireUserId } from "@/lib/api-auth";
import { agentRunQueue, publishAppEvent } from "@agent-team/core";
import { agentRuns, agents, db } from "@agent-team/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Startet einen manuellen Lauf (Testlauf oder "An Agent senden"). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.userId, userId)));
  if (!agent) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = z
    .object({ prompt: z.string().max(10_000).optional() })
    .safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  const [run] = await db
    .insert(agentRuns)
    .values({ userId, agentId: agent.id, status: "queued" })
    .returning();
  if (!run) {
    return NextResponse.json({ error: "Run konnte nicht angelegt werden" }, { status: 500 });
  }

  await agentRunQueue().add(
    "run",
    { runId: run.id, ...(parsed.data.prompt ? { prompt: parsed.data.prompt } : {}) },
    { jobId: `manual-${run.id}`, attempts: 1 },
  );
  await publishAppEvent(userId, {
    type: "run.status",
    runId: run.id,
    agentId: agent.id,
    status: "queued",
  });

  return NextResponse.json({ runId: run.id }, { status: 201 });
}
