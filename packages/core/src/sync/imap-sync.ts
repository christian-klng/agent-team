import {
  db,
  mailAttachments,
  mailFolders,
  mailMessageBodies,
  mailMessages,
} from "@agent-team/db";
import { and, eq, sql } from "drizzle-orm";
import type { ImapFlow, ListResponse } from "imapflow";
import { simpleParser } from "mailparser";
import { createImapClient } from "../connectors/imap";
import type { ImapMailAccountConfig, SourceRow } from "../sources";
import { buildSnippet, sanitizeMailHtml } from "./mail-content";
import type { DetectedChange } from "./types";

const BACKFILL_MAX_MESSAGES = 1000;
const SOURCE_MAX_BYTES = 2 * 1024 * 1024;

type FolderRow = typeof mailFolders.$inferSelect;

function roleFromListEntry(entry: ListResponse): FolderRow["role"] {
  if (entry.path.toUpperCase() === "INBOX") return "inbox";
  switch (entry.specialUse) {
    case "\\Sent":
      return "sent";
    case "\\Drafts":
      return "drafts";
    case "\\Trash":
      return "trash";
    case "\\Archive":
      return "archive";
    case "\\Junk":
      return "spam";
    default:
      return "other";
  }
}

const DEFAULT_SYNC_ROLES = new Set(["inbox", "sent", "archive"]);

function toDate(v: Date | string | undefined | null): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function addrList(list?: { name?: string; address?: string }[]): {
  name?: string;
  address: string;
}[] {
  return (list ?? [])
    .filter((a) => a.address)
    .map((a) => ({ name: a.name || undefined, address: a.address! }));
}

interface BodyStructureNode {
  disposition?: string;
  type?: string;
  childNodes?: BodyStructureNode[];
}

function hasAttachments(node: BodyStructureNode | undefined): boolean {
  if (!node) return false;
  if (node.disposition === "attachment") return true;
  return (node.childNodes ?? []).some(hasAttachments);
}

async function upsertFolders(
  client: ImapFlow,
  cfg: ImapMailAccountConfig,
  source: SourceRow,
): Promise<void> {
  const entries = await client.list();
  for (const entry of entries) {
    const role = roleFromListEntry(entry);
    await db
      .insert(mailFolders)
      .values({
        userId: source.userId,
        accountId: cfg.accountId,
        path: entry.path,
        displayName: entry.name,
        role,
        syncEnabled: DEFAULT_SYNC_ROLES.has(role),
      })
      .onConflictDoUpdate({
        target: [mailFolders.accountId, mailFolders.path],
        set: { displayName: entry.name, role, updatedAt: new Date() },
      });
  }
}

/** Holt eine Mail vollständig, parst und speichert sie. Liefert die Row-ID oder null (Duplikat). */
async function ingestFullMessage(
  client: ImapFlow,
  cfg: ImapMailAccountConfig,
  source: SourceRow,
  folder: FolderRow,
  uid: number,
): Promise<{ id: string; subject: string; fromEmail: string | null; fromName: string | null; snippet: string } | null> {
  const msg = await client.fetchOne(
    String(uid),
    {
      envelope: true,
      flags: true,
      size: true,
      internalDate: true,
      bodyStructure: true,
      source: { maxLength: SOURCE_MAX_BYTES },
    },
    { uid: true },
  );
  if (!msg) return null;

  let textBody: string | null = null;
  let htmlSanitized: string | null = null;
  let attachments: { filename?: string; mime?: string; size?: number }[] = [];
  try {
    if (msg.source) {
      const parsed = await simpleParser(msg.source);
      textBody = parsed.text ?? null;
      htmlSanitized = parsed.html ? sanitizeMailHtml(parsed.html) : null;
      attachments = parsed.attachments.map((a) => ({
        filename: a.filename,
        mime: a.contentType,
        size: a.size,
      }));
    }
  } catch (err) {
    console.warn(`[sync:mail] Parse-Fehler UID ${uid} in ${folder.path}:`, err);
  }

  const envelope = msg.envelope;
  const from = addrList(envelope?.from)[0];
  const flags = msg.flags ?? new Set<string>();

  const inserted = await db
    .insert(mailMessages)
    .values({
      userId: source.userId,
      accountId: cfg.accountId,
      folderId: folder.id,
      uid,
      messageIdHdr: envelope?.messageId ?? null,
      inReplyTo: envelope?.inReplyTo ?? null,
      subject: envelope?.subject ?? "",
      fromName: from?.name ?? null,
      fromEmail: from?.address?.toLowerCase() ?? null,
      toAddrs: addrList(envelope?.to),
      ccAddrs: addrList(envelope?.cc),
      sentAt: toDate(envelope?.date) ?? toDate(msg.internalDate),
      seen: flags.has("\\Seen"),
      answered: flags.has("\\Answered"),
      flagged: flags.has("\\Flagged"),
      snippet: buildSnippet(textBody),
      hasAttachments: attachments.length > 0 || hasAttachments(msg.bodyStructure as BodyStructureNode),
      size: msg.size ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: mailMessages.id });

  const row = inserted[0];
  if (!row) return null;

  if (textBody !== null || htmlSanitized !== null) {
    await db
      .insert(mailMessageBodies)
      .values({ messageId: row.id, textBody, htmlSanitized })
      .onConflictDoNothing();
  }
  if (attachments.length > 0) {
    await db.insert(mailAttachments).values(
      attachments.map((a, i) => ({
        messageId: row.id,
        filename: a.filename ?? null,
        mime: a.mime ?? null,
        size: a.size ?? null,
        partId: String(i),
      })),
    );
  }

  return {
    id: row.id,
    subject: envelope?.subject ?? "",
    fromEmail: from?.address?.toLowerCase() ?? null,
    fromName: from?.name ?? null,
    snippet: buildSnippet(textBody),
  };
}

/** Backfill: nur Envelopes, keine Bodies, keine Trigger. */
async function backfillFolder(
  client: ImapFlow,
  cfg: ImapMailAccountConfig,
  source: SourceRow,
  folder: FolderRow,
  uidNext: number,
): Promise<void> {
  const start = Math.max(1, uidNext - BACKFILL_MAX_MESSAGES);
  if (uidNext <= 1) return;
  for await (const msg of client.fetch(
    `${start}:*`,
    { envelope: true, flags: true, size: true, internalDate: true, bodyStructure: true },
    { uid: true },
  )) {
    const envelope = msg.envelope;
    const from = addrList(envelope?.from)[0];
    const flags = msg.flags ?? new Set<string>();
    await db
      .insert(mailMessages)
      .values({
        userId: source.userId,
        accountId: cfg.accountId,
        folderId: folder.id,
        uid: msg.uid,
        messageIdHdr: envelope?.messageId ?? null,
        inReplyTo: envelope?.inReplyTo ?? null,
        subject: envelope?.subject ?? "",
        fromName: from?.name ?? null,
        fromEmail: from?.address?.toLowerCase() ?? null,
        toAddrs: addrList(envelope?.to),
        ccAddrs: addrList(envelope?.cc),
        sentAt: toDate(envelope?.date) ?? toDate(msg.internalDate),
        seen: flags.has("\\Seen"),
        answered: flags.has("\\Answered"),
        flagged: flags.has("\\Flagged"),
        hasAttachments: hasAttachments(msg.bodyStructure as BodyStructureNode),
        size: msg.size ?? null,
      })
      .onConflictDoNothing();
  }
}

async function syncFlagsViaCondstore(
  client: ImapFlow,
  folder: FolderRow,
  mailboxModseq: bigint,
): Promise<void> {
  if (!folder.highestModseq || mailboxModseq <= folder.highestModseq) return;
  for await (const msg of client.fetch(
    "1:*",
    { flags: true },
    { uid: true, changedSince: folder.highestModseq },
  )) {
    const flags = msg.flags ?? new Set<string>();
    await db
      .update(mailMessages)
      .set({
        seen: flags.has("\\Seen"),
        answered: flags.has("\\Answered"),
        flagged: flags.has("\\Flagged"),
        updatedAt: new Date(),
      })
      .where(
        and(eq(mailMessages.folderId, folder.id), eq(mailMessages.uid, msg.uid)),
      );
  }
}

export async function syncMailSource(
  cfg: ImapMailAccountConfig,
  source: SourceRow,
): Promise<DetectedChange[]> {
  const changes: DetectedChange[] = [];
  const client = createImapClient(cfg);
  await client.connect();
  try {
    await upsertFolders(client, cfg, source);

    const folders = await db
      .select()
      .from(mailFolders)
      .where(
        and(eq(mailFolders.accountId, cfg.accountId), eq(mailFolders.syncEnabled, true)),
      );

    for (const folder of folders) {
      const lock = await client.getMailboxLock(folder.path);
      try {
        const mailbox = client.mailbox;
        if (!mailbox || typeof mailbox === "boolean") continue;
        const uidValidity = Number(mailbox.uidValidity ?? 0);
        const uidNext = mailbox.uidNext ?? 1;

        let effectiveFolder = folder;
        let folderIsBaseline = folder.lastSeenUid === 0;

        // UIDVALIDITY-Wechsel: alle UIDs sind ungültig → Folder-Reset ohne Trigger.
        if (folder.uidvalidity !== null && folder.uidvalidity !== uidValidity) {
          console.warn(`[sync:mail] UIDVALIDITY-Reset in ${folder.path}`);
          await db.delete(mailMessages).where(eq(mailMessages.folderId, folder.id));
          effectiveFolder = { ...folder, lastSeenUid: 0, highestModseq: null };
          folderIsBaseline = true;
        }

        if (folderIsBaseline) {
          await backfillFolder(client, cfg, source, effectiveFolder, uidNext);
        } else {
          // Neue Mails seit letztem Sync — vollständig inkl. Body.
          const from = effectiveFolder.lastSeenUid + 1;
          if (uidNext > from) {
            const uids = await client.search(
              { uid: `${from}:*` },
              { uid: true },
            );
            for (const uid of (uids || []).filter((u) => u >= from).sort((a, b) => a - b)) {
              const ingested = await ingestFullMessage(client, cfg, source, effectiveFolder, uid);
              if (ingested) {
                changes.push({
                  kind: "mail.new",
                  externalRef: ingested.id,
                  dedupKey: `mail:${cfg.accountId}:${folder.id}:${uidValidity}:${uid}`,
                  payload: {
                    messageId: ingested.id,
                    accountId: cfg.accountId,
                    folderId: folder.id,
                    subject: ingested.subject,
                    fromEmail: ingested.fromEmail,
                    fromName: ingested.fromName,
                    snippet: ingested.snippet,
                  },
                });
              }
            }
          }

          // Flag-Änderungen (gelesen/beantwortet/markiert) via CONDSTORE.
          if (mailbox.highestModseq) {
            await syncFlagsViaCondstore(client, effectiveFolder, mailbox.highestModseq);
          }
        }

        await db
          .update(mailFolders)
          .set({
            uidvalidity: uidValidity,
            lastSeenUid: Math.max(uidNext - 1, 0),
            highestModseq: mailbox.highestModseq ?? null,
            updatedAt: new Date(),
          })
          .where(eq(mailFolders.id, folder.id));
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return changes;
}
