import { requireUserId } from "@/lib/api-auth";
import { encryptSecret, requestSchedulerReconcile } from "@agent-team/core";
import {
  caldavAccounts,
  dataSources,
  db,
  mailAccounts,
  webdavStores,
} from "@agent-team/db";
import { updateSourceInputSchema } from "@agent-team/shared";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function getOwnedSource(id: string, userId: string) {
  const [source] = await db
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.id, id), eq(dataSources.userId, userId)));
  return source;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const source = await getOwnedSource(id, userId);
  if (!source) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSourceInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  await db
    .update(dataSources)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(dataSources.id, source.id));

  const c = input.config;
  if (c) {
    if (source.type === "email") {
      await db
        .update(mailAccounts)
        .set({
          ...(c.imapHost !== undefined ? { imapHost: c.imapHost } : {}),
          ...(c.imapPort !== undefined ? { imapPort: c.imapPort } : {}),
          ...(c.imapTls !== undefined ? { imapTls: c.imapTls } : {}),
          ...(c.imapUser !== undefined ? { imapUser: c.imapUser } : {}),
          ...(c.imapPassword
            ? { imapPasswordEnc: encryptSecret(c.imapPassword) }
            : {}),
          ...(c.smtpHost !== undefined ? { smtpHost: c.smtpHost } : {}),
          ...(c.smtpPort !== undefined ? { smtpPort: c.smtpPort } : {}),
          ...(c.smtpUser !== undefined ? { smtpUser: c.smtpUser } : {}),
          ...(c.smtpPassword
            ? { smtpPasswordEnc: encryptSecret(c.smtpPassword) }
            : {}),
          ...(c.ewsUrl !== undefined ? { ewsUrl: c.ewsUrl } : {}),
          ...(c.ewsUser !== undefined ? { ewsUser: c.ewsUser } : {}),
          ...(c.ewsPassword
            ? { ewsPasswordEnc: encryptSecret(c.ewsPassword) }
            : {}),
          ...(c.ewsDomain !== undefined ? { ewsDomain: c.ewsDomain || null } : {}),
          ...(c.fromAddress !== undefined ? { fromAddress: c.fromAddress } : {}),
          ...(c.fromName !== undefined ? { fromName: c.fromName } : {}),
        })
        .where(eq(mailAccounts.dataSourceId, source.id));
    } else if (source.type === "caldav") {
      await db
        .update(caldavAccounts)
        .set({
          ...(c.serverUrl !== undefined ? { serverUrl: c.serverUrl } : {}),
          ...(c.username !== undefined ? { username: c.username } : {}),
          ...(c.password ? { passwordEnc: encryptSecret(c.password) } : {}),
        })
        .where(eq(caldavAccounts.dataSourceId, source.id));
    } else {
      await db
        .update(webdavStores)
        .set({
          ...(c.baseUrl !== undefined ? { baseUrl: c.baseUrl } : {}),
          ...(c.username !== undefined ? { username: c.username } : {}),
          ...(c.password ? { passwordEnc: encryptSecret(c.password) } : {}),
          ...(c.rootPath !== undefined ? { rootPath: c.rootPath || "/" } : {}),
        })
        .where(eq(webdavStores.dataSourceId, source.id));
    }
  }

  await requestSchedulerReconcile();
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const source = await getOwnedSource(id, userId);
  if (!source) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  await db.delete(dataSources).where(eq(dataSources.id, source.id));
  await requestSchedulerReconcile();
  return NextResponse.json({ ok: true });
}
