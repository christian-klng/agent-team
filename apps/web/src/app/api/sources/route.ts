import { requireUserId } from "@/lib/api-auth";
import { encryptSecret, requestSchedulerReconcile } from "@agent-team/core";
import {
  caldavAccounts,
  dataSources,
  db,
  mailAccounts,
  webdavStores,
} from "@agent-team/db";
import { createSourceInputSchema } from "@agent-team/shared";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const sources = await db
    .select()
    .from(dataSources)
    .where(eq(dataSources.userId, userId))
    .orderBy(dataSources.createdAt);

  const result = await Promise.all(
    sources.map(async (s) => {
      let config: Record<string, unknown> = {};
      if (s.type === "email") {
        const [acc] = await db
          .select()
          .from(mailAccounts)
          .where(eq(mailAccounts.dataSourceId, s.id));
        if (acc) {
          config =
            acc.protocol === "ews"
              ? {
                  accountId: acc.id,
                  protocol: acc.protocol,
                  ewsUrl: acc.ewsUrl,
                  ewsUser: acc.ewsUser,
                  ewsDomain: acc.ewsDomain,
                  fromAddress: acc.fromAddress,
                  fromName: acc.fromName,
                }
              : {
                  accountId: acc.id,
                  protocol: acc.protocol,
                  imapHost: acc.imapHost,
                  imapPort: acc.imapPort,
                  imapTls: acc.imapTls,
                  imapUser: acc.imapUser,
                  smtpHost: acc.smtpHost,
                  smtpPort: acc.smtpPort,
                  smtpUser: acc.smtpUser,
                  fromAddress: acc.fromAddress,
                  fromName: acc.fromName,
                };
        }
      } else if (s.type === "caldav") {
        const [acc] = await db
          .select()
          .from(caldavAccounts)
          .where(eq(caldavAccounts.dataSourceId, s.id));
        if (acc) {
          config = { accountId: acc.id, serverUrl: acc.serverUrl, username: acc.username };
        }
      } else {
        const [store] = await db
          .select()
          .from(webdavStores)
          .where(eq(webdavStores.dataSourceId, s.id));
        if (store) {
          config = {
            storeId: store.id,
            baseUrl: store.baseUrl,
            username: store.username,
            rootPath: store.rootPath,
          };
        }
      }
      return { ...s, config };
    }),
  );

  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const body = await req.json().catch(() => null);
  const parsed = createSourceInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const [source] = await db
    .insert(dataSources)
    .values({
      userId,
      type: input.type,
      name: input.name,
      color: input.color,
    })
    .returning();
  if (!source) {
    return NextResponse.json({ error: "Anlegen fehlgeschlagen" }, { status: 500 });
  }

  if (input.type === "email") {
    const c = input.config;
    if (c.protocol === "ews") {
      await db.insert(mailAccounts).values({
        dataSourceId: source.id,
        protocol: "ews",
        ewsUrl: c.ewsUrl,
        ewsUser: c.ewsUser,
        ewsPasswordEnc: encryptSecret(c.ewsPassword),
        ewsDomain: c.ewsDomain ?? null,
        fromAddress: c.fromAddress,
        fromName: c.fromName ?? null,
      });
    } else {
      await db.insert(mailAccounts).values({
        dataSourceId: source.id,
        protocol: "imap",
        imapHost: c.imapHost,
        imapPort: c.imapPort,
        imapTls: c.imapTls,
        imapUser: c.imapUser,
        imapPasswordEnc: encryptSecret(c.imapPassword),
        smtpHost: c.smtpHost,
        smtpPort: c.smtpPort,
        smtpUser: c.smtpUser,
        smtpPasswordEnc: encryptSecret(c.smtpPassword),
        fromAddress: c.fromAddress,
        fromName: c.fromName ?? null,
      });
    }
  } else if (input.type === "caldav") {
    const c = input.config;
    await db.insert(caldavAccounts).values({
      dataSourceId: source.id,
      serverUrl: c.serverUrl,
      username: c.username,
      passwordEnc: encryptSecret(c.password),
    });
  } else {
    const c = input.config;
    await db.insert(webdavStores).values({
      dataSourceId: source.id,
      baseUrl: c.baseUrl,
      username: c.username,
      passwordEnc: encryptSecret(c.password),
      rootPath: c.rootPath || "/",
    });
  }

  await requestSchedulerReconcile();
  return NextResponse.json(source, { status: 201 });
}
