import { requireUserId } from "@/lib/api-auth";
import { db, mailFolders, mailMessages } from "@agent-team/db";
import { and, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";

const PAGE_SIZE = 50;

/**
 * Vereinheitlichte Nachrichtenliste mit Keyset-Pagination.
 * Query-Parameter: accountId?, folderId?, role? (default: inbox, "all" = alle),
 * unread?, hasAttachments?, cursor? (ISO-Datum|id), sort? (date|from)
 */
export async function GET(req: Request) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  const folderId = url.searchParams.get("folderId");
  const role = url.searchParams.get("role") ?? "inbox";
  const unread = url.searchParams.get("unread") === "1";
  const hasAttachments = url.searchParams.get("hasAttachments") === "1";
  const cursor = url.searchParams.get("cursor");

  const conditions: SQL[] = [eq(mailMessages.userId, userId)];

  if (folderId) {
    conditions.push(eq(mailMessages.folderId, folderId));
  } else {
    // Ohne konkreten Ordner: nach Rolle filtern (Standard: Inbox über alle Konten).
    if (role !== "all") {
      const roleFolders = db
        .select({ id: mailFolders.id })
        .from(mailFolders)
        .where(
          and(
            eq(mailFolders.userId, userId),
            eq(mailFolders.role, role as "inbox"),
          ),
        );
      conditions.push(inArray(mailMessages.folderId, roleFolders));
    }
  }
  if (accountId) conditions.push(eq(mailMessages.accountId, accountId));
  if (unread) conditions.push(eq(mailMessages.seen, false));
  if (hasAttachments) conditions.push(eq(mailMessages.hasAttachments, true));

  if (cursor) {
    const [dateStr, id] = cursor.split("~");
    if (dateStr && id) {
      const cursorDate = new Date(dateStr);
      conditions.push(
        or(
          lt(mailMessages.sentAt, cursorDate),
          and(eq(mailMessages.sentAt, cursorDate), lt(mailMessages.id, id)),
        )!,
      );
    }
  }

  const rows = await db
    .select({
      id: mailMessages.id,
      accountId: mailMessages.accountId,
      folderId: mailMessages.folderId,
      subject: mailMessages.subject,
      fromName: mailMessages.fromName,
      fromEmail: mailMessages.fromEmail,
      sentAt: mailMessages.sentAt,
      seen: mailMessages.seen,
      answered: mailMessages.answered,
      flagged: mailMessages.flagged,
      snippet: mailMessages.snippet,
      hasAttachments: mailMessages.hasAttachments,
    })
    .from(mailMessages)
    .where(and(...conditions))
    .orderBy(desc(mailMessages.sentAt), desc(mailMessages.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last?.sentAt ? `${last.sentAt.toISOString()}~${last.id}` : null;

  return NextResponse.json({ messages: page, nextCursor });
}
