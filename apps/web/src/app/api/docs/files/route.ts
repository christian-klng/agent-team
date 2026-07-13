import { requireUserId } from "@/lib/api-auth";
import { db, documentFiles } from "@agent-team/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

/** Ordnerinhalt aus dem Sync-Index (read-only Ansicht). */
export async function GET(req: Request) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const url = new URL(req.url);
  const storeId = url.searchParams.get("storeId");
  const path = url.searchParams.get("path") ?? "/";
  if (!storeId) {
    return NextResponse.json({ error: "storeId fehlt" }, { status: 400 });
  }

  // Direkte Kinder: Pfad beginnt mit "<path>/" und enthält danach kein weiteres "/".
  const prefix = path === "/" ? "/" : `${path}/`;
  const rows = await db
    .select()
    .from(documentFiles)
    .where(
      and(
        eq(documentFiles.userId, userId),
        eq(documentFiles.storeId, storeId),
        isNull(documentFiles.deletedAt),
        sql`${documentFiles.path} LIKE ${`${prefix}%`}`,
        sql`${documentFiles.path} NOT LIKE ${`${prefix}%/%`}`,
      ),
    )
    .orderBy(desc(documentFiles.isDir), asc(documentFiles.name));

  return NextResponse.json(rows);
}
