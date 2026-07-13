import { requireUserId } from "@/lib/api-auth";
import { agents, db, decisions } from "@agent-team/db";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  const conditions: SQL[] = [eq(decisions.userId, userId)];
  if (status) conditions.push(eq(decisions.status, status as "open"));

  const rows = await db
    .select({
      decision: decisions,
      agentName: agents.name,
      agentColor: agents.color,
    })
    .from(decisions)
    .innerJoin(agents, eq(decisions.agentId, agents.id))
    .where(and(...conditions))
    .orderBy(desc(decisions.createdAt))
    .limit(limit);

  return NextResponse.json(
    rows.map((r) => ({ ...r.decision, agentName: r.agentName, agentColor: r.agentColor })),
  );
}
