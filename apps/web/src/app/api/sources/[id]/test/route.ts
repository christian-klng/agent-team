import { requireUserId } from "@/lib/api-auth";
import { testMailLegs } from "@/lib/test-mail";
import {
  getSourceWithConfig,
  testCaldavConnection,
  testEwsConnection,
  testWebdavConnection,
} from "@agent-team/core";
import { dataSources, db } from "@agent-team/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Übernimmt Formular-Overrides in die gespeicherte (entschlüsselte) Config.
 * Leere Strings bedeuten „gespeicherten Wert behalten" (z. B. Passwörter).
 */
function applyOverrides<T extends object>(
  stored: T,
  overrides: Record<string, unknown>,
  keys: (keyof T & string)[],
): T {
  const result: Record<string, unknown> = { ...(stored as Record<string, unknown>) };
  for (const key of keys) {
    const value = overrides[key];
    if (value === undefined || value === null || value === "") continue;
    result[key] = typeof result[key] === "number" ? Number(value) : value;
  }
  return result as T;
}

/**
 * Verbindungstest mit gespeicherten Zugangsdaten — optional überschrieben
 * durch die aktuellen (ungespeicherten) Formularwerte aus dem Bearbeiten-Dialog.
 */
export async function POST(
  req: Request,
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

  const body = await req.json().catch(() => ({}));
  const overrides = ((body as { config?: Record<string, unknown> })?.config ?? {});

  try {
    const full = await getSourceWithConfig(source.id);
    if (full.type === "email") {
      if (full.config.protocol === "ews") {
        const cfg = applyOverrides(full.config, overrides, [
          "ewsUrl",
          "ewsUser",
          "ewsPassword",
          "ewsDomain",
        ]);
        const result = await testEwsConnection(cfg);
        return NextResponse.json(result);
      }
      const cfg = applyOverrides(full.config, overrides, [
        "imapHost",
        "imapPort",
        "imapTls",
        "imapUser",
        "imapPassword",
        "smtpHost",
        "smtpPort",
        "smtpUser",
        "smtpPassword",
        "fromAddress",
      ]);
      const result = await testMailLegs(cfg);
      return NextResponse.json(result);
    }
    if (full.type === "caldav") {
      const cfg = applyOverrides(full.config, overrides, [
        "serverUrl",
        "username",
        "password",
      ]);
      const count = await testCaldavConnection(cfg);
      return NextResponse.json({ ok: true, message: `Verbunden — ${count} Kalender gefunden.` });
    }
    const cfg = applyOverrides(full.config, overrides, [
      "baseUrl",
      "username",
      "password",
      "rootPath",
    ]);
    const count = await testWebdavConnection(cfg);
    return NextResponse.json({ ok: true, message: `Verbunden — ${count} Einträge im Root-Ordner.` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message }, { status: 200 });
  }
}
