import { requireUserId } from "@/lib/api-auth";
import { testMailLegs } from "@/lib/test-mail";
import {
  testCaldavConnection,
  testWebdavConnection,
} from "@agent-team/core";
import { createSourceInputSchema } from "@agent-team/shared";
import { NextResponse } from "next/server";

/** Verbindungstest für eine noch nicht gespeicherte Konfiguration. */
export async function POST(req: Request) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;

  const body = await req.json().catch(() => null);
  const parsed = createSourceInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  try {
    if (input.type === "email") {
      const result = await testMailLegs({
        accountId: "test",
        dataSourceId: "test",
        imapHost: input.config.imapHost,
        imapPort: input.config.imapPort,
        imapTls: input.config.imapTls,
        imapUser: input.config.imapUser,
        imapPassword: input.config.imapPassword,
        smtpHost: input.config.smtpHost,
        smtpPort: input.config.smtpPort,
        smtpUser: input.config.smtpUser,
        smtpPassword: input.config.smtpPassword,
        fromAddress: input.config.fromAddress,
        fromName: input.config.fromName ?? null,
      });
      return NextResponse.json(result);
    }
    if (input.type === "caldav") {
      const count = await testCaldavConnection({
        accountId: "test",
        dataSourceId: "test",
        serverUrl: input.config.serverUrl,
        username: input.config.username,
        password: input.config.password,
      });
      return NextResponse.json({ ok: true, message: `Verbunden — ${count} Kalender gefunden.` });
    }
    const count = await testWebdavConnection({
      storeId: "test",
      dataSourceId: "test",
      baseUrl: input.config.baseUrl,
      username: input.config.username,
      password: input.config.password,
      rootPath: input.config.rootPath || "/",
    });
    return NextResponse.json({ ok: true, message: `Verbunden — ${count} Einträge im Root-Ordner.` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message }, { status: 200 });
  }
}
