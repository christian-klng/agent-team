import { requireUserId } from "@/lib/api-auth";
import { caldavAccounts, calendars, dataSources, db } from "@agent-team/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const rows = await db
    .select({
      id: calendars.id,
      displayName: calendars.displayName,
      color: calendars.color,
      syncEnabled: calendars.syncEnabled,
      accountName: dataSources.name,
      accountColor: dataSources.color,
    })
    .from(calendars)
    .innerJoin(caldavAccounts, eq(calendars.accountId, caldavAccounts.id))
    .innerJoin(dataSources, eq(caldavAccounts.dataSourceId, dataSources.id))
    .where(eq(calendars.userId, userId));

  return NextResponse.json(
    rows.map((r) => ({ ...r, color: r.color ?? r.accountColor })),
  );
}
