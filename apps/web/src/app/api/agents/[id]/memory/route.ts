import { requireUserId } from "@/lib/api-auth";
import { agentMemories, agents, db } from "@agent-team/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.userId, userId)));
  if (!agent) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ content: z.string().max(20_000) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  await db
    .insert(agentMemories)
    .values({ agentId: agent.id, content: parsed.data.content, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: agentMemories.agentId,
      set: { content: parsed.data.content, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true });
}
