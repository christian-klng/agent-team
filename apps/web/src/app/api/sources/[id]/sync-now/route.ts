import { requireUserId } from "@/lib/api-auth";
import { syncQueue } from "@agent-team/core";
import { dataSources, db } from "@agent-team/db";
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

  const [source] = await db
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.id, id), eq(dataSources.userId, userId)));
  if (!source) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  await syncQueue().add(
    "sync",
    { dataSourceId: source.id },
    { jobId: `sync-now-${source.id}-${Date.now()}` },
  );
  return NextResponse.json({ ok: true });
}
