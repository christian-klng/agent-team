import { requireUserId } from "@/lib/api-auth";
import { dataSources, db, webdavStores } from "@agent-team/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const rows = await db
    .select({
      storeId: webdavStores.id,
      name: dataSources.name,
      color: dataSources.color,
      rootPath: webdavStores.rootPath,
      baseUrl: webdavStores.baseUrl,
    })
    .from(webdavStores)
    .innerJoin(dataSources, eq(webdavStores.dataSourceId, dataSources.id))
    .where(eq(dataSources.userId, userId));

  return NextResponse.json(rows);
}
