import { requireUserId } from "@/lib/api-auth";
import { fetchMailAttachment } from "@agent-team/core";
import { db, mailAttachments, mailMessages } from "@agent-team/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/** Anhang-Download als IMAP-Proxy (keine Blob-Speicherung in der App). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; attId: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id, attId } = await params;

  const [msg] = await db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(and(eq(mailMessages.id, id), eq(mailMessages.userId, userId)));
  if (!msg) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  const [att] = await db
    .select()
    .from(mailAttachments)
    .where(and(eq(mailAttachments.id, attId), eq(mailAttachments.messageId, id)));
  if (!att) {
    return NextResponse.json({ error: "Anhang nicht gefunden" }, { status: 404 });
  }

  const result = await fetchMailAttachment(id, Number(att.partId ?? 0));
  if (!result) {
    return NextResponse.json({ error: "Anhang nicht ladbar" }, { status: 502 });
  }

  return new Response(new Uint8Array(result.content), {
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(result.filename)}"`,
    },
  });
}
