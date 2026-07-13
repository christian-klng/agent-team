import { requireUserId } from "@/lib/api-auth";
import {
  getSourceWithConfig,
  testCaldavConnection,
  testImapConnection,
  testSmtpConnection,
  testWebdavConnection,
} from "@agent-team/core";
import { dataSources, db } from "@agent-team/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/** Verbindungstest mit gespeicherten Zugangsdaten. */
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

  try {
    const full = await getSourceWithConfig(source.id);
    if (full.type === "email") {
      await testImapConnection(full.config);
      await testSmtpConnection(full.config);
      return NextResponse.json({ ok: true, message: "IMAP- und SMTP-Verbindung erfolgreich." });
    }
    if (full.type === "caldav") {
      const count = await testCaldavConnection(full.config);
      return NextResponse.json({ ok: true, message: `Verbunden — ${count} Kalender gefunden.` });
    }
    const count = await testWebdavConnection(full.config);
    return NextResponse.json({ ok: true, message: `Verbunden — ${count} Einträge im Root-Ordner.` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message }, { status: 200 });
  }
}
