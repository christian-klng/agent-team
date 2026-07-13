import { requireUserId } from "@/lib/api-auth";
import {
  agentMemories,
  agentRuns,
  agentTriggers,
  agents,
  db,
} from "@agent-team/db";
import { agentInputSchema } from "@agent-team/shared";
import { count, desc, eq, sql, sum } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.userId, userId))
    .orderBy(desc(agents.createdAt));

  const stats = await db
    .select({
      agentId: agentRuns.agentId,
      runCount: count(),
      totalCost: sum(agentRuns.costUsd),
      lastRunAt: sql<string | null>`max(${agentRuns.createdAt})`,
    })
    .from(agentRuns)
    .where(eq(agentRuns.userId, userId))
    .groupBy(agentRuns.agentId);
  const statsByAgent = new Map(stats.map((s) => [s.agentId, s]));

  const triggers = await db.select().from(agentTriggers);
  const triggersByAgent = new Map<string, typeof triggers>();
  for (const t of triggers) {
    const list = triggersByAgent.get(t.agentId) ?? [];
    list.push(t);
    triggersByAgent.set(t.agentId, list);
  }

  return NextResponse.json(
    rows.map((a) => ({
      ...a,
      triggers: triggersByAgent.get(a.id) ?? [],
      runCount: Number(statsByAgent.get(a.id)?.runCount ?? 0),
      totalCost: Number(statsByAgent.get(a.id)?.totalCost ?? 0),
      lastRunAt: statsByAgent.get(a.id)?.lastRunAt ?? null,
    })),
  );
}

export async function POST(req: Request) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const body = await req.json().catch(() => null);
  const parsed = agentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const [agent] = await db
    .insert(agents)
    .values({
      userId,
      name: input.name,
      description: input.description ?? null,
      color: input.color,
      skillName: input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50) || "agent",
      skillMarkdown: input.skillMarkdown,
      model: input.model,
      maxTurns: input.maxTurns,
      enabledTools: input.enabledTools,
      enabled: input.enabled,
    })
    .returning();
  if (!agent) {
    return NextResponse.json({ error: "Anlegen fehlgeschlagen" }, { status: 500 });
  }

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
  await db.insert(agentMemories).values({ agentId: agent.id, content: "" });

  return NextResponse.json(agent, { status: 201 });
}
