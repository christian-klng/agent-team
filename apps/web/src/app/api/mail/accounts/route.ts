import { requireUserId } from "@/lib/api-auth";
import {
  dataSources,
  db,
  mailAccounts,
  mailFolders,
  mailMessages,
} from "@agent-team/db";
import { and, count, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

/** Konten inkl. Ordnerbaum und Ungelesen-Zählern für die Mail-Navigation. */
export async function GET() {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const accounts = await db
    .select({
      accountId: mailAccounts.id,
      sourceId: dataSources.id,
      name: dataSources.name,
      color: dataSources.color,
      enabled: dataSources.enabled,
      fromAddress: mailAccounts.fromAddress,
    })
    .from(mailAccounts)
    .innerJoin(dataSources, eq(mailAccounts.dataSourceId, dataSources.id))
    .where(eq(dataSources.userId, userId));

  const folders = await db
    .select({
      id: mailFolders.id,
      accountId: mailFolders.accountId,
      path: mailFolders.path,
      displayName: mailFolders.displayName,
      role: mailFolders.role,
      syncEnabled: mailFolders.syncEnabled,
    })
    .from(mailFolders)
    .where(eq(mailFolders.userId, userId));

  const unreadCounts = await db
    .select({
      folderId: mailMessages.folderId,
      unread: count(),
    })
    .from(mailMessages)
    .where(and(eq(mailMessages.userId, userId), eq(mailMessages.seen, false)))
    .groupBy(mailMessages.folderId);
  const unreadByFolder = new Map(unreadCounts.map((u) => [u.folderId, u.unread]));

  return NextResponse.json(
    accounts.map((acc) => ({
      ...acc,
      folders: folders
        .filter((f) => f.accountId === acc.accountId)
        .map((f) => ({ ...f, unread: unreadByFolder.get(f.id) ?? 0 })),
    })),
  );
}
