import {
  agents,
  calendarEvents,
  calendars,
  caldavAccounts,
  contactEmails,
  contacts,
  dataSources,
  db,
  documentFiles,
  mailAccounts,
  mailFolders,
} from "@agent-team/db";
import {
  contactUpsertPayloadSchema,
  documentWritePayloadSchema,
  emailSendPayloadSchema,
  eventRsvpPayloadSchema,
  skillUpdatePayloadSchema,
  type DecisionType,
} from "@agent-team/shared";
import { and, eq } from "drizzle-orm";
// Expliziter Dateipfad: ESM erlaubt keine Verzeichnis-Importe.
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { createCaldavClient } from "../connectors/caldav";
import { EwsClient } from "../connectors/ews";
import { createImapClient } from "../connectors/imap";
import { createSmtpTransport } from "../connectors/smtp";
import {
  assertInsideRoot,
  createWebdavClient,
  normalizeWebdavPath,
} from "../connectors/webdav";
import {
  getMailAccountConfigById,
  getSourceWithConfig,
  getWebdavStoreConfigById,
} from "../sources";

export interface ExecutionContext {
  userId: string;
}

export type ExecutionResult = Record<string, unknown>;

/**
 * Deterministische Ausführung freigegebener Entscheidungen. Hier — und nur
 * hier — passieren Seiteneffekte. Kein LLM beteiligt.
 */
export async function executeDecisionPayload(
  type: DecisionType,
  rawPayload: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  switch (type) {
    case "email_send":
      return executeEmailSend(rawPayload, ctx);
    case "event_rsvp":
      return executeEventRsvp(rawPayload, ctx);
    case "document_write":
      return executeDocumentWrite(rawPayload, ctx);
    case "contact_upsert":
      return executeContactUpsert(rawPayload, ctx);
    case "skill_update":
      return executeSkillUpdate(rawPayload, ctx);
  }
}

async function executeEmailSend(
  rawPayload: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const payload = emailSendPayloadSchema.parse(rawPayload);
  const cfg = await getMailAccountConfigById(payload.accountId);

  // Ownership prüfen.
  const source = await getSourceWithConfig(cfg.dataSourceId);
  if (source.source.userId !== ctx.userId) {
    throw new Error("Mail-Konto gehört nicht zum Nutzer.");
  }

  // Threading-Header aus der Original-Mail übernehmen.
  let inReplyTo: string | undefined;
  let references: string | undefined;
  if (payload.inReplyToMessageId) {
    const { mailMessages } = await import("@agent-team/db");
    const [orig] = await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, payload.inReplyToMessageId));
    if (orig?.messageIdHdr) {
      inReplyTo = orig.messageIdHdr;
      references = [...orig.referencesHdrs, orig.messageIdHdr].join(" ");
    }
  }

  const mail = {
    from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress,
    to: payload.to.join(", "),
    ...(payload.cc.length > 0 ? { cc: payload.cc.join(", ") } : {}),
    subject: payload.subject,
    text: payload.bodyText,
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references ? { references } : {}),
  };

  // Einmal komponieren, dann identisch senden und in "Gesendet" ablegen.
  const raw = await new MailComposer(mail).compile().build();

  if (cfg.protocol === "ews") {
    // Exchange versendet und legt die Kopie selbst in "Gesendete Elemente" ab.
    const client = new EwsClient(cfg);
    try {
      await client.sendMailMime(raw);
    } finally {
      client.close();
    }
    return {
      sentTo: payload.to,
      cc: payload.cc,
      subject: payload.subject,
      appendedToSent: true,
    };
  }

  const transport = createSmtpTransport(cfg);
  try {
    await transport.sendMail({
      envelope: { from: cfg.fromAddress, to: [...payload.to, ...payload.cc] },
      raw,
    });
  } finally {
    transport.close();
  }

  // Kopie in den Gesendet-Ordner (best effort).
  let appendedToSent = false;
  try {
    const [sentFolder] = await db
      .select()
      .from(mailFolders)
      .where(
        and(eq(mailFolders.accountId, cfg.accountId), eq(mailFolders.role, "sent")),
      );
    if (sentFolder) {
      const client = createImapClient(cfg);
      await client.connect();
      try {
        await client.append(sentFolder.path, raw, ["\\Seen"]);
        appendedToSent = true;
      } finally {
        await client.logout().catch(() => {});
      }
    }
  } catch (err) {
    console.warn("[executor] Ablage in Gesendet fehlgeschlagen:", err);
  }

  return {
    sentTo: payload.to,
    cc: payload.cc,
    subject: payload.subject,
    appendedToSent,
  };
}

/** Entfaltet gefaltete ICS-Zeilen (RFC 5545 3.1). */
function unfoldIcs(ics: string): string {
  return ics.replace(/\r?\n[ \t]/g, "");
}

async function executeEventRsvp(
  rawPayload: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const payload = eventRsvpPayloadSchema.parse(rawPayload);

  const [event] = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.id, payload.eventId),
        eq(calendarEvents.userId, ctx.userId),
      ),
    );
  if (!event) throw new Error("Termin nicht gefunden.");

  const [calendar] = await db
    .select()
    .from(calendars)
    .where(eq(calendars.id, event.calendarId));
  if (!calendar) throw new Error("Kalender nicht gefunden.");

  // Exchange-Kalender: RSVP direkt über EWS (AcceptItem/DeclineItem) —
  // Exchange aktualisiert den Kalender und benachrichtigt den Organisator.
  if (calendar.ewsAccountId) {
    const mailCfg = await getMailAccountConfigById(calendar.ewsAccountId);
    if (mailCfg.protocol !== "ews") {
      throw new Error("Kalender-Konto ist kein Exchange-Konto.");
    }
    const full = await getSourceWithConfig(mailCfg.dataSourceId);
    if (full.source.userId !== ctx.userId) {
      throw new Error("Kalender gehört nicht zum Nutzer.");
    }
    const client = new EwsClient(mailCfg);
    try {
      await client.respondToMeeting(event.objectUrl, payload.partstat, payload.comment);
    } finally {
      client.close();
    }
    const selfEmail = mailCfg.fromAddress.toLowerCase();
    const hasSelf = event.attendees.some((a) => a.self);
    await db
      .update(calendarEvents)
      .set({
        attendees: hasSelf
          ? event.attendees.map((a) => (a.self ? { ...a, partstat: payload.partstat } : a))
          : [...event.attendees, { email: selfEmail, self: true, partstat: payload.partstat }],
        updatedAt: new Date(),
      })
      .where(eq(calendarEvents.id, event.id));
    return { partstat: payload.partstat, ewsResponded: true, itipSent: true };
  }

  if (!event.rawIcs) throw new Error("Für diesen Termin liegt kein Roh-ICS vor.");

  if (!calendar.accountId) throw new Error("Kalender hat kein CalDAV-Konto.");
  const [account] = await db
    .select()
    .from(caldavAccounts)
    .where(eq(caldavAccounts.id, calendar.accountId));
  if (!account) throw new Error("CalDAV-Konto nicht gefunden.");

  const full = await getSourceWithConfig(account.dataSourceId);
  if (full.type !== "caldav") throw new Error("Quelle ist kein CalDAV-Konto.");
  const cfg = full.config;
  const selfEmail = cfg.username.toLowerCase();

  // PARTSTAT der eigenen ATTENDEE-Zeile patchen.
  const unfolded = unfoldIcs(event.rawIcs);
  const lines = unfolded.split(/\r?\n/);
  let patched = false;
  const newLines = lines.map((line) => {
    if (
      line.toUpperCase().startsWith("ATTENDEE") &&
      line.toLowerCase().includes(selfEmail)
    ) {
      patched = true;
      let out = line;
      if (/PARTSTAT=[A-Z-]+/i.test(out)) {
        out = out.replace(/PARTSTAT=[A-Z-]+/i, `PARTSTAT=${payload.partstat}`);
      } else {
        out = out.replace(/^ATTENDEE/i, `ATTENDEE;PARTSTAT=${payload.partstat}`);
      }
      return out.replace(/RSVP=TRUE/i, "RSVP=FALSE");
    }
    return line;
  });
  if (!patched) {
    throw new Error(
      `Keine Teilnehmer-Zeile für ${selfEmail} im Termin gefunden — RSVP nicht möglich.`,
    );
  }
  const patchedIcs = newLines.join("\r\n");

  const client = await createCaldavClient(cfg);
  const response = await client.updateCalendarObject({
    calendarObject: {
      url: event.objectUrl,
      data: patchedIcs,
      etag: event.etag ?? undefined,
    },
  });
  if (response.status >= 400) {
    throw new Error(
      response.status === 412
        ? "Konflikt: Der Termin wurde zwischenzeitlich geändert (ETag-Mismatch)."
        : `CalDAV-Server antwortete mit ${response.status}.`,
    );
  }

  await db
    .update(calendarEvents)
    .set({
      rawIcs: patchedIcs,
      attendees: event.attendees.map((a) =>
        a.self ? { ...a, partstat: payload.partstat } : a,
      ),
      updatedAt: new Date(),
    })
    .where(eq(calendarEvents.id, event.id));

  // iTIP-REPLY an den Organisator (best effort, braucht ein Mail-Konto).
  let itipSent = false;
  const organizerEmail = event.organizer?.email;
  if (organizerEmail && organizerEmail !== selfEmail && event.icalUid) {
    try {
      const [anyMailAccount] = await db
        .select({ id: mailAccounts.id })
        .from(mailAccounts)
        .innerJoin(dataSources, eq(mailAccounts.dataSourceId, dataSources.id))
        .where(and(eq(dataSources.userId, ctx.userId), eq(dataSources.enabled, true)));
      if (anyMailAccount) {
        const mailCfg = await getMailAccountConfigById(anyMailAccount.id);
        const dtstamp =
          new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
        const replyIcs = [
          "BEGIN:VCALENDAR",
          "PRODID:-//Agent Team//RSVP//DE",
          "VERSION:2.0",
          "METHOD:REPLY",
          "BEGIN:VEVENT",
          `UID:${event.icalUid}`,
          `DTSTAMP:${dtstamp}`,
          `ATTENDEE;PARTSTAT=${payload.partstat}:mailto:${selfEmail}`,
          `ORGANIZER:mailto:${organizerEmail}`,
          event.startsAt
            ? `DTSTART:${event.startsAt.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`
            : null,
          `SUMMARY:${event.summary}`,
          "END:VEVENT",
          "END:VCALENDAR",
        ]
          .filter((l): l is string => l !== null)
          .join("\r\n");

        const partstatDe =
          payload.partstat === "ACCEPTED"
            ? "Zusage"
            : payload.partstat === "DECLINED"
              ? "Absage"
              : "Vorbehalt";
        const replyMail = {
          from: mailCfg.fromName
            ? `"${mailCfg.fromName}" <${mailCfg.fromAddress}>`
            : mailCfg.fromAddress,
          to: organizerEmail,
          subject: `${partstatDe}: ${event.summary}`,
          text: `${partstatDe} für "${event.summary}".${payload.comment ? `\n\n${payload.comment}` : ""}`,
          icalEvent: { method: "REPLY", content: replyIcs },
        };
        if (mailCfg.protocol === "ews") {
          const ewsClient = new EwsClient(mailCfg);
          try {
            const replyRaw = await new MailComposer(replyMail).compile().build();
            await ewsClient.sendMailMime(replyRaw);
            itipSent = true;
          } finally {
            ewsClient.close();
          }
        } else {
          const transport = createSmtpTransport(mailCfg);
          try {
            await transport.sendMail(replyMail);
            itipSent = true;
          } finally {
            transport.close();
          }
        }
      }
    } catch (err) {
      console.warn("[executor] iTIP-REPLY fehlgeschlagen:", err);
    }
  }

  return { partstat: payload.partstat, caldavUpdated: true, itipSent };
}

async function executeDocumentWrite(
  rawPayload: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const payload = documentWritePayloadSchema.parse(rawPayload);
  const cfg = await getWebdavStoreConfigById(payload.storeId);

  const full = await getSourceWithConfig(cfg.dataSourceId);
  if (full.source.userId !== ctx.userId) {
    throw new Error("Dokumenten-Speicher gehört nicht zum Nutzer.");
  }

  const path = normalizeWebdavPath(payload.path);
  assertInsideRoot(cfg.rootPath, path);
  const client = createWebdavClient(cfg);

  const headers: Record<string, string> = payload.baseEtag
    ? { "If-Match": payload.baseEtag }
    : { "If-None-Match": "*" };

  try {
    const okWrite = await client.putFileContents(path, payload.newContent, {
      headers,
      overwrite: true,
    });
    if (!okWrite) throw new Error("WebDAV-Server hat das Schreiben abgelehnt.");
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 412) {
      throw new Error(
        payload.baseEtag
          ? "Konflikt: Das Dokument wurde zwischenzeitlich geändert (ETag-Mismatch). Bitte neu prüfen."
          : "Konflikt: Die Datei existiert bereits.",
      );
    }
    throw err;
  }

  // Index sofort aktualisieren (der nächste Sync bestätigt).
  try {
    const stat = (await client.stat(path)) as {
      etag?: string;
      size?: number;
      lastmod?: string;
      mime?: string;
      basename: string;
    };
    await db
      .insert(documentFiles)
      .values({
        userId: ctx.userId,
        storeId: cfg.storeId,
        path,
        name: stat.basename,
        isDir: false,
        etag: stat.etag ?? null,
        size: stat.size ?? null,
        mime: stat.mime ?? null,
        modifiedAt: stat.lastmod ? new Date(stat.lastmod) : null,
      })
      .onConflictDoUpdate({
        target: [documentFiles.storeId, documentFiles.path],
        set: {
          etag: stat.etag ?? null,
          size: stat.size ?? null,
          modifiedAt: stat.lastmod ? new Date(stat.lastmod) : null,
          deletedAt: null,
          updatedAt: new Date(),
        },
      });
  } catch {
    // unkritisch — Sync holt es nach
  }

  return { path, bytesWritten: payload.newContent.length };
}

async function executeContactUpsert(
  rawPayload: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const payload = contactUpsertPayloadSchema.parse(rawPayload);

  let contactId = payload.contactId ?? null;

  if (contactId) {
    const [existing] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.userId, ctx.userId)));
    if (!existing) throw new Error("Kontakt nicht gefunden.");
    await db
      .update(contacts)
      .set({
        ...(payload.fields.displayName !== undefined
          ? { displayName: payload.fields.displayName }
          : {}),
        ...(payload.fields.firstName !== undefined
          ? { firstName: payload.fields.firstName }
          : {}),
        ...(payload.fields.lastName !== undefined
          ? { lastName: payload.fields.lastName }
          : {}),
        ...(payload.fields.phone !== undefined ? { phone: payload.fields.phone } : {}),
        ...(payload.fields.currentEmployer !== undefined
          ? { currentEmployer: payload.fields.currentEmployer }
          : {}),
        ...(payload.fields.pastEmployers !== undefined
          ? { pastEmployers: payload.fields.pastEmployers }
          : {}),
        ...(payload.fields.notes !== undefined ? { notes: payload.fields.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contactId));
  } else {
    const displayName =
      payload.fields.displayName ??
      [payload.fields.firstName, payload.fields.lastName].filter(Boolean).join(" ");
    if (!displayName) throw new Error("displayName oder Vor-/Nachname erforderlich.");
    const [created] = await db
      .insert(contacts)
      .values({
        userId: ctx.userId,
        displayName,
        firstName: payload.fields.firstName ?? null,
        lastName: payload.fields.lastName ?? null,
        phone: payload.fields.phone ?? null,
        currentEmployer: payload.fields.currentEmployer ?? null,
        pastEmployers: payload.fields.pastEmployers ?? [],
        notes: payload.fields.notes ?? null,
      })
      .returning();
    if (!created) throw new Error("Kontakt konnte nicht angelegt werden.");
    contactId = created.id;
  }

  for (const email of payload.emails) {
    await db
      .insert(contactEmails)
      .values({
        userId: ctx.userId,
        contactId,
        email: email.email.toLowerCase(),
        label: email.label ?? null,
        isPrimary: email.isPrimary,
      })
      .onConflictDoUpdate({
        target: [contactEmails.userId, contactEmails.email],
        set: {
          contactId,
          ...(email.label !== undefined ? { label: email.label } : {}),
          isPrimary: email.isPrimary,
        },
      });
  }

  return { contactId, emails: payload.emails.map((e) => e.email) };
}

async function executeSkillUpdate(
  rawPayload: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const payload = skillUpdatePayloadSchema.parse(rawPayload);

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, payload.agentId), eq(agents.userId, ctx.userId)));
  if (!agent) throw new Error("Agent nicht gefunden.");

  await db
    .update(agents)
    .set({ skillMarkdown: payload.newMarkdown, updatedAt: new Date() })
    .where(eq(agents.id, agent.id));

  return {
    agentId: agent.id,
    changeSummary: payload.changeSummary,
    previousLength: agent.skillMarkdown.length,
    newLength: payload.newMarkdown.length,
  };
}
