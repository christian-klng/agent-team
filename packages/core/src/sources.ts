import {
  caldavAccounts,
  dataSources,
  db,
  mailAccounts,
  webdavStores,
} from "@agent-team/db";
import { eq } from "drizzle-orm";
import { decryptSecret } from "./crypto";

export interface MailAccountConfig {
  accountId: string;
  dataSourceId: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapUser: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  fromAddress: string;
  fromName: string | null;
}

export interface CaldavAccountConfig {
  accountId: string;
  dataSourceId: string;
  serverUrl: string;
  username: string;
  password: string;
}

export interface WebdavStoreConfig {
  storeId: string;
  dataSourceId: string;
  baseUrl: string;
  username: string;
  password: string;
  rootPath: string;
}

export type SourceRow = typeof dataSources.$inferSelect;

export type SourceWithConfig =
  | { source: SourceRow; type: "email"; config: MailAccountConfig }
  | { source: SourceRow; type: "caldav"; config: CaldavAccountConfig }
  | { source: SourceRow; type: "webdav"; config: WebdavStoreConfig };

export async function getSourceWithConfig(
  dataSourceId: string,
): Promise<SourceWithConfig> {
  const [source] = await db
    .select()
    .from(dataSources)
    .where(eq(dataSources.id, dataSourceId));
  if (!source) throw new Error(`Datenquelle ${dataSourceId} nicht gefunden`);

  if (source.type === "email") {
    const [acc] = await db
      .select()
      .from(mailAccounts)
      .where(eq(mailAccounts.dataSourceId, source.id));
    if (!acc) throw new Error("Mail-Konto-Konfiguration fehlt");
    return {
      source,
      type: "email",
      config: {
        accountId: acc.id,
        dataSourceId: source.id,
        imapHost: acc.imapHost,
        imapPort: acc.imapPort,
        imapTls: acc.imapTls,
        imapUser: acc.imapUser,
        imapPassword: decryptSecret(acc.imapPasswordEnc),
        smtpHost: acc.smtpHost,
        smtpPort: acc.smtpPort,
        smtpUser: acc.smtpUser,
        smtpPassword: decryptSecret(acc.smtpPasswordEnc),
        fromAddress: acc.fromAddress,
        fromName: acc.fromName,
      },
    };
  }

  if (source.type === "caldav") {
    const [acc] = await db
      .select()
      .from(caldavAccounts)
      .where(eq(caldavAccounts.dataSourceId, source.id));
    if (!acc) throw new Error("CalDAV-Konto-Konfiguration fehlt");
    return {
      source,
      type: "caldav",
      config: {
        accountId: acc.id,
        dataSourceId: source.id,
        serverUrl: acc.serverUrl,
        username: acc.username,
        password: decryptSecret(acc.passwordEnc),
      },
    };
  }

  const [store] = await db
    .select()
    .from(webdavStores)
    .where(eq(webdavStores.dataSourceId, source.id));
  if (!store) throw new Error("WebDAV-Store-Konfiguration fehlt");
  return {
    source,
    type: "webdav",
    config: {
      storeId: store.id,
      dataSourceId: source.id,
      baseUrl: store.baseUrl,
      username: store.username,
      password: decryptSecret(store.passwordEnc),
      rootPath: store.rootPath,
    },
  };
}

export async function getMailAccountConfigById(
  accountId: string,
): Promise<MailAccountConfig> {
  const [acc] = await db
    .select()
    .from(mailAccounts)
    .where(eq(mailAccounts.id, accountId));
  if (!acc) throw new Error(`Mail-Konto ${accountId} nicht gefunden`);
  const full = await getSourceWithConfig(acc.dataSourceId);
  if (full.type !== "email") throw new Error("Kein Mail-Konto");
  return full.config;
}

export async function getWebdavStoreConfigById(
  storeId: string,
): Promise<WebdavStoreConfig> {
  const [store] = await db
    .select()
    .from(webdavStores)
    .where(eq(webdavStores.id, storeId));
  if (!store) throw new Error(`Dokumenten-Speicher ${storeId} nicht gefunden`);
  const full = await getSourceWithConfig(store.dataSourceId);
  if (full.type !== "webdav") throw new Error("Kein WebDAV-Store");
  return full.config;
}
