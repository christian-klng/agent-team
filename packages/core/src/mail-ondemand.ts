import {
  db,
  mailFolders,
  mailMessageBodies,
  mailMessages,
} from "@agent-team/db";
import { eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { EwsClient } from "./connectors/ews";
import { createImapClient } from "./connectors/imap";
import { getMailAccountConfigById, type MailAccountConfig } from "./sources";
import { buildSnippet, sanitizeMailHtml } from "./sync/mail-content";

export interface MailBody {
  textBody: string | null;
  htmlSanitized: string | null;
}

type MessageRow = typeof mailMessages.$inferSelect;
type FolderRow = typeof mailFolders.$inferSelect;

/** Holt den Roh-MIME-Inhalt einer Mail — je nach Konto via IMAP oder EWS. */
async function fetchRawMime(
  cfg: MailAccountConfig,
  msg: MessageRow,
  folder: FolderRow,
  maxBytes: number,
): Promise<Buffer | null> {
  if (cfg.protocol === "ews") {
    if (!msg.ewsItemId) return null;
    const client = new EwsClient(cfg);
    try {
      // Base64-Overhead im SOAP-Body einrechnen (~4/3).
      return await client.getItemMime(msg.ewsItemId, {
        maxBytes: Math.ceil((maxBytes * 4) / 3) + 1024 * 1024,
      });
    } finally {
      client.close();
    }
  }

  const client = createImapClient(cfg);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(folder.path);
    try {
      const fetched = await client.fetchOne(
        String(msg.uid),
        { source: { maxLength: maxBytes } },
        { uid: true },
      );
      if (!fetched || !fetched.source) return null;
      return Buffer.isBuffer(fetched.source)
        ? fetched.source
        : Buffer.from(fetched.source);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Holt den Body einer Mail on-demand via IMAP (Backfill-Mails haben nur
 * Envelopes) und cacht ihn dauerhaft in mail_message_bodies.
 */
export async function fetchAndStoreMailBody(messageId: string): Promise<MailBody | null> {
  const [existing] = await db
    .select()
    .from(mailMessageBodies)
    .where(eq(mailMessageBodies.messageId, messageId));
  if (existing) {
    return { textBody: existing.textBody, htmlSanitized: existing.htmlSanitized };
  }

  const [msg] = await db
    .select()
    .from(mailMessages)
    .where(eq(mailMessages.id, messageId));
  if (!msg) return null;
  const [folder] = await db
    .select()
    .from(mailFolders)
    .where(eq(mailFolders.id, msg.folderId));
  if (!folder) return null;

  const cfg = await getMailAccountConfigById(msg.accountId);
  const raw = await fetchRawMime(cfg, msg, folder, 4 * 1024 * 1024);
  if (!raw) return null;
  const parsed = await simpleParser(raw);
  const textBody = parsed.text ?? null;
  const htmlSanitized = parsed.html ? sanitizeMailHtml(parsed.html) : null;

  await db
    .insert(mailMessageBodies)
    .values({ messageId, textBody, htmlSanitized })
    .onConflictDoNothing();
  if (textBody && !msg.snippet) {
    await db
      .update(mailMessages)
      .set({ snippet: buildSnippet(textBody) })
      .where(eq(mailMessages.id, messageId));
  }
  return { textBody, htmlSanitized };
}

/** Lädt einen Anhang on-demand (partId = Index aus der Sync-Erfassung). */
export async function fetchMailAttachment(
  messageId: string,
  partIndex: number,
): Promise<{ filename: string; contentType: string; content: Buffer } | null> {
  const [msg] = await db
    .select()
    .from(mailMessages)
    .where(eq(mailMessages.id, messageId));
  if (!msg) return null;
  const [folder] = await db
    .select()
    .from(mailFolders)
    .where(eq(mailFolders.id, msg.folderId));
  if (!folder) return null;

  const cfg = await getMailAccountConfigById(msg.accountId);
  const raw = await fetchRawMime(cfg, msg, folder, 50 * 1024 * 1024);
  if (!raw) return null;
  const parsed = await simpleParser(raw);
  const att = parsed.attachments[partIndex];
  if (!att) return null;
  return {
    filename: att.filename ?? `anhang-${partIndex}`,
    contentType: att.contentType ?? "application/octet-stream",
    content: att.content,
  };
}
