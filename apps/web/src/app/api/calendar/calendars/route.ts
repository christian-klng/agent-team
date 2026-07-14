import { requireUserId } from "@/lib/api-auth";
import { caldavAccounts, calendars, dataSources, db, mailAccounts } from "@agent-team/db";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  // Kalender hängen entweder an einem CalDAV-Konto oder (Exchange) an einem
  // EWS-Mail-Konto — die Datenquelle kommt aus dem jeweils gesetzten FK.
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
    .leftJoin(caldavAccounts, eq(calendars.accountId, caldavAccounts.id))
    .leftJoin(mailAccounts, eq(calendars.ewsAccountId, mailAccounts.id))
    .innerJoin(
      dataSources,
      sql`${dataSources.id} = coalesce(${caldavAccounts.dataSourceId}, ${mailAccounts.dataSourceId})`,
    )
    .where(eq(calendars.userId, userId));

  return NextResponse.json(
    rows.map((r) => ({ ...r, color: r.color ?? r.accountColor })),
  );
}
