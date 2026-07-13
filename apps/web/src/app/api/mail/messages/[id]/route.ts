import { requireUserId } from "@/lib/api-auth";
import { fetchAndStoreMailBody } from "@agent-team/core";
import {
  db,
  mailAttachments,
  mailMessageBodies,
  mailMessages,
} from "@agent-team/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/** Einzelne Mail inkl. Body (holt den Body bei Bedarf on-demand via IMAP). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const [msg] = await db
    .select()
    .from(mailMessages)
    .where(and(eq(mailMessages.id, id), eq(mailMessages.userId, userId)));
  if (!msg) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  let [body] = await db
    .select()
    .from(mailMessageBodies)
    .where(eq(mailMessageBodies.messageId, id));

  if (!body) {
    try {
      const fetched = await fetchAndStoreMailBody(id);
      if (fetched) {
        body = {
          messageId: id,
          textBody: fetched.textBody,
          htmlSanitized: fetched.htmlSanitized,
          fetchedAt: new Date(),
        };
      }
    } catch (err) {
      console.error("Body-Fetch fehlgeschlagen:", err);
    }
  }

  const attachments = await db
    .select()
    .from(mailAttachments)
    .where(eq(mailAttachments.messageId, id));

  return NextResponse.json({
    ...msg,
    textBody: body?.textBody ?? null,
    htmlSanitized: body?.htmlSanitized ?? null,
    bodyAvailable: !!body,
    attachments,
  });
}
