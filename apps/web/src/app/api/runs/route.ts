import { requireUserId } from "@/lib/api-auth";
import { agentRuns, agents, db } from "@agent-team/db";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  const conditions: SQL[] = [eq(agentRuns.userId, userId)];
  if (agentId) conditions.push(eq(agentRuns.agentId, agentId));

  const rows = await db
    .select({
      run: agentRuns,
      agentName: agents.name,
      agentColor: agents.color,
    })
    .from(agentRuns)
    .innerJoin(agents, eq(agentRuns.agentId, agents.id))
    .where(and(...conditions))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);

  return NextResponse.json(
    rows.map((r) => ({ ...r.run, agentName: r.agentName, agentColor: r.agentColor })),
  );
}
