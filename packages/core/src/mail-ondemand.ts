import {
  db,
  mailFolders,
  mailMessageBodies,
  mailMessages,
} from "@agent-team/db";
import { eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { createImapClient } from "./connectors/imap";
import { getMailAccountConfigById } from "./sources";
import { buildSnippet, sanitizeMailHtml } from "./sync/mail-content";

export interface MailBody {
  textBody: string | null;
  htmlSanitized: string | null;
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
  const client = createImapClient(cfg);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(folder.path);
    try {
      const fetched = await client.fetchOne(
        String(msg.uid),
        { source: { maxLength: 4 * 1024 * 1024 } },
        { uid: true },
      );
      if (!fetched || !fetched.source) return null;
      const parsed = await simpleParser(fetched.source);
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
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
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
  const client = createImapClient(cfg);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(folder.path);
    try {
      const fetched = await client.fetchOne(
        String(msg.uid),
        { source: { maxLength: 50 * 1024 * 1024 } },
        { uid: true },
      );
      if (!fetched || !fetched.source) return null;
      const parsed = await simpleParser(fetched.source);
      const att = parsed.attachments[partIndex];
      if (!att) return null;
      return {
        filename: att.filename ?? `anhang-${partIndex}`,
        contentType: att.contentType ?? "application/octet-stream",
        content: att.content,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
