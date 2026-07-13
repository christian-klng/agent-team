import { requireUserId } from "@/lib/api-auth";
import {
  agentMemories,
  agentRuns,
  agentTriggers,
  agents,
  db,
} from "@agent-team/db";
import { agentUpdateSchema } from "@agent-team/shared";
import { and, count, eq, sum } from "drizzle-orm";
import { NextResponse } from "next/server";

async function getOwnedAgent(id: string, userId: string) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.userId, userId)));
  return agent;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const agent = await getOwnedAgent(id, userId);
  if (!agent) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const triggers = await db
    .select()
    .from(agentTriggers)
    .where(eq(agentTriggers.agentId, agent.id));
  const [memory] = await db
    .select()
    .from(agentMemories)
    .where(eq(agentMemories.agentId, agent.id));
  const [stats] = await db
    .select({ runCount: count(), totalCost: sum(agentRuns.costUsd) })
    .from(agentRuns)
    .where(eq(agentRuns.agentId, agent.id));

  return NextResponse.json({
    ...agent,
    triggers,
    memory: memory?.content ?? "",
    runCount: Number(stats?.runCount ?? 0),
    totalCost: Number(stats?.totalCost ?? 0),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const agent = await getOwnedAgent(id, userId);
  if (!agent) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = agentUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  await db
    .update(agents)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.maxTurns !== undefined ? { maxTurns: input.maxTurns } : {}),
      ...(input.skillMarkdown !== undefined ? { skillMarkdown: input.skillMarkdown } : {}),
      ...(input.enabledTools !== undefined ? { enabledTools: input.enabledTools } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agent.id));

  if (input.triggers !== undefined) {
    await db.delete(agentTriggers).where(eq(agentTriggers.agentId, agent.id));
    if (input.triggers.length > 0) {
      await db.insert(agentTriggers).values(
        input.triggers.map((t) => ({
          agentId: agent.id,
          dataSourceId: t.dataSourceId,
          eventKinds: t.eventKinds,
          filter: t.filter,
        })),
      );
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const agent = await getOwnedAgent(id, userId);
  if (!agent) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.delete(agents).where(eq(agents.id, agent.id));
  return NextResponse.json({ ok: true });
}
