import { requireUserId } from "@/lib/api-auth";
import {
  agentRunEvents,
  agentRuns,
  agents,
  db,
  decisions,
} from "@agent-team/db";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/** Run inkl. Timeline-Events und zugehörigen Decisions (fürs RunPanel). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const [row] = await db
    .select({ run: agentRuns, agentName: agents.name, agentColor: agents.color })
    .from(agentRuns)
    .innerJoin(agents, eq(agentRuns.agentId, agents.id))
    .where(and(eq(agentRuns.id, id), eq(agentRuns.userId, userId)));
  if (!row) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const events = await db
    .select()
    .from(agentRunEvents)
    .where(eq(agentRunEvents.runId, id))
    .orderBy(asc(agentRunEvents.seq));

  const runDecisions = await db
    .select()
    .from(decisions)
    .where(eq(decisions.runId, id));

  return NextResponse.json({
    ...row.run,
    agentName: row.agentName,
    agentColor: row.agentColor,
    events,
    decisions: runDecisions,
  });
}
