import {
  assertInsideRoot,
  createWebdavClient,
  getWebdavStoreConfigById,
  publishAppEvent,
} from "@agent-team/core";
import {
  agentMemories,
  agents,
  calendarEvents,
  calendars,
  contactDocLinks,
  contactEmails,
  contacts,
  dataSources,
  db,
  decisionAudit,
  decisions,
  documentFiles,
  mailAccounts,
  mailMessageBodies,
  mailMessages,
  webdavStores,
} from "@agent-team/db";
import {
  decisionPayloadSchemas,
  decisionTypes,
  type DecisionType,
} from "@agent-team/shared";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

const LIST_LIMIT = 20;
const BODY_CAP = 8_000;
const DOC_CAP = 50_000;

type AgentRow = typeof agents.$inferSelect;

export interface RunToolContext {
  runId: string;
  agent: AgentRow;
  userId: string;
  /** Schreibt ein Run-Event in die Timeline (seq verwaltet die Runtime). */
  emit: (type: "decision_created", content: Record<string, unknown>) => Promise<void>;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
function fail(text: string) {
  return { content: [{ type: "text" as const, text: `Fehler: ${text}` }], isError: true };
}

function cap(text: string | null | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}\n[… gekürzt]` : text;
}

function formatMessageRow(m: {
  id: string;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  sentAt: Date | null;
  snippet: string;
}): string {
  return `- [${m.id}] ${m.sentAt?.toISOString() ?? "?"} | Von: ${m.fromName ?? ""} <${m.fromEmail ?? "?"}> | Betreff: ${m.subject || "(kein Betreff)"}\n  ${m.snippet}`;
}

async function loadMessageWithBody(userId: string, messageId: string) {
  const [msg] = await db
    .select()
    .from(mailMessages)
    .where(and(eq(mailMessages.id, messageId), eq(mailMessages.userId, userId)));
  if (!msg) return null;
  const [body] = await db
    .select()
    .from(mailMessageBodies)
    .where(eq(mailMessageBodies.messageId, messageId));
  return { msg, body };
}

export function formatMailForAgent(
  msg: typeof mailMessages.$inferSelect,
  textBody: string | null,
): string {
  return [
    `Message-ID (intern): ${msg.id}`,
    `Von: ${msg.fromName ?? ""} <${msg.fromEmail ?? "?"}>`,
    `An: ${msg.toAddrs.map((a) => a.address).join(", ")}`,
    msg.ccAddrs.length > 0 ? `CC: ${msg.ccAddrs.map((a) => a.address).join(", ")}` : null,
    `Datum: ${msg.sentAt?.toISOString() ?? "?"}`,
    `Betreff: ${msg.subject || "(kein Betreff)"}`,
    "",
    cap(textBody ?? msg.snippet, BODY_CAP) || "(kein Textinhalt)",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function normalizeSubject(subject: string): string {
  return subject.replace(/^((re|aw|fwd|wg)\s*:\s*)+/i, "").trim().toLowerCase();
}

const CONTACT_FIELD_KEYS = [
  "displayName",
  "firstName",
  "lastName",
  "phone",
  "currentEmployer",
  "pastEmployers",
  "notes",
] as const;

/**
 * Repariert häufige LLM-Fehler im propose_decision-Payload, bevor validiert
 * wird. contact_upsert: Kontaktfelder, die das Modell fälschlich auf oberster
 * Ebene ablegt (statt unter `fields`), werden dorthin gefaltet — sonst würde
 * Zod sie still verwerfen und der Vorschlag käme leer an.
 */
function normalizeProposedPayload(
  type: DecisionType,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (type !== "contact_upsert") return payload;
  const out = { ...payload };
  const fields = {
    ...(out.fields && typeof out.fields === "object" ? (out.fields as Record<string, unknown>) : {}),
  };
  for (const key of CONTACT_FIELD_KEYS) {
    if (out[key] !== undefined && fields[key] === undefined) {
      fields[key] = out[key];
      delete out[key];
    }
  }
  out.fields = fields;
  return out;
}

/** Baut den SDK-MCP-Server mit allen für diesen Agenten aktivierten Tools. */
type ToolDef = NonNullable<Parameters<typeof createSdkMcpServer>[0]["tools"]>[number];

export function buildAgentToolServer(ctx: RunToolContext): {
  server: McpSdkServerConfigWithInstance;
  allowedTools: string[];
} {
  const { agent, userId } = ctx;
  const enabled = new Set(agent.enabledTools);
  const tools: ToolDef[] = [];

  // ---------- Mail ----------
  if (enabled.has("mail_get_message")) {
    tools.push(
      tool(
        "mail_get_message",
        "Liest eine einzelne E-Mail inklusive Text-Inhalt anhand ihrer internen ID.",
        { messageId: z.string().uuid() },
        async ({ messageId }) => {
          const found = await loadMessageWithBody(userId, messageId);
          if (!found) return fail("E-Mail nicht gefunden.");
          return ok(formatMailForAgent(found.msg, found.body?.textBody ?? null));
        },
      ),
    );
  }
  if (enabled.has("mail_search")) {
    tools.push(
      tool(
        "mail_search",
        "Durchsucht E-Mails nach Stichwort in Betreff/Vorschau, optional gefiltert nach Absender und Zeitraum. Liefert max. 20 Treffer.",
        {
          query: z.string().min(1).describe("Suchbegriff"),
          fromEmail: z.string().optional().describe("Absender-Adresse (optional)"),
          sinceDays: z.number().int().positive().optional().describe("Nur E-Mails der letzten N Tage"),
        },
        async ({ query, fromEmail, sinceDays }) => {
          const conditions = [
            eq(mailMessages.userId, userId),
            or(
              ilike(mailMessages.subject, `%${query}%`),
              ilike(mailMessages.snippet, `%${query}%`),
            )!,
          ];
          if (fromEmail) conditions.push(eq(mailMessages.fromEmail, fromEmail.toLowerCase()));
          if (sinceDays) {
            conditions.push(gte(mailMessages.sentAt, new Date(Date.now() - sinceDays * 86400_000)));
          }
          const rows = await db
            .select()
            .from(mailMessages)
            .where(and(...conditions))
            .orderBy(desc(mailMessages.sentAt))
            .limit(LIST_LIMIT);
          if (rows.length === 0) return ok("Keine Treffer.");
          return ok(rows.map(formatMessageRow).join("\n"));
        },
      ),
    );
  }
  if (enabled.has("mail_list_from_sender")) {
    tools.push(
      tool(
        "mail_list_from_sender",
        "Listet die letzten E-Mails eines bestimmten Absenders (max. 20).",
        { email: z.string().email() },
        async ({ email }) => {
          const rows = await db
            .select()
            .from(mailMessages)
            .where(
              and(
                eq(mailMessages.userId, userId),
                eq(mailMessages.fromEmail, email.toLowerCase()),
              ),
            )
            .orderBy(desc(mailMessages.sentAt))
            .limit(LIST_LIMIT);
          if (rows.length === 0) return ok(`Keine E-Mails von ${email} gefunden.`);
          return ok(rows.map(formatMessageRow).join("\n"));
        },
      ),
    );
  }
  if (enabled.has("mail_get_thread")) {
    tools.push(
      tool(
        "mail_get_thread",
        "Liest den Verlauf (Thread) zu einer E-Mail: alle Nachrichten mit gleichem Betreff, chronologisch.",
        { messageId: z.string().uuid() },
        async ({ messageId }) => {
          const found = await loadMessageWithBody(userId, messageId);
          if (!found) return fail("E-Mail nicht gefunden.");
          const subject = normalizeSubject(found.msg.subject);
          const rows = await db
            .select()
            .from(mailMessages)
            .where(eq(mailMessages.userId, userId))
            .orderBy(desc(mailMessages.sentAt))
            .limit(500);
          const thread = rows
            .filter((m) => normalizeSubject(m.subject) === subject)
            .sort((a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0))
            .slice(-LIST_LIMIT);
          return ok(thread.map(formatMessageRow).join("\n"));
        },
      ),
    );
  }

  // ---------- Kalender ----------
  if (enabled.has("calendar_list_events")) {
    tools.push(
      tool(
        "calendar_list_events",
        "Listet Termine in einem Zeitraum (ISO-Daten). Wiederkehrende Termine sind mit RRULE markiert.",
        {
          from: z.string().describe("Start (ISO-Datum)"),
          to: z.string().describe("Ende (ISO-Datum)"),
        },
        async ({ from, to }) => {
          const rows = await db
            .select()
            .from(calendarEvents)
            .where(
              and(
                eq(calendarEvents.userId, userId),
                isNull(calendarEvents.deletedAt),
                gte(calendarEvents.startsAt, new Date(from)),
                lte(calendarEvents.startsAt, new Date(to)),
              ),
            )
            .orderBy(calendarEvents.startsAt)
            .limit(LIST_LIMIT * 2);
          if (rows.length === 0) return ok("Keine Termine in diesem Zeitraum.");
          return ok(
            rows
              .map(
                (e) =>
                  `- [${e.id}] ${e.startsAt?.toISOString() ?? "?"} – ${e.endsAt?.toISOString() ?? "?"} | ${e.summary}${e.location ? ` @ ${e.location}` : ""}${e.rrule ? " (wiederkehrend)" : ""}`,
              )
              .join("\n"),
          );
        },
      ),
    );
  }
  if (enabled.has("calendar_get_event")) {
    tools.push(
      tool(
        "calendar_get_event",
        "Liest einen Termin mit allen Details (Teilnehmer, Organisator, Beschreibung).",
        { eventId: z.string().uuid() },
        async ({ eventId }) => {
          const [e] = await db
            .select()
            .from(calendarEvents)
            .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId)));
          if (!e) return fail("Termin nicht gefunden.");
          return ok(
            [
              `Event-ID (intern): ${e.id}`,
              `Titel: ${e.summary}`,
              `Beginn: ${e.startsAt?.toISOString() ?? "?"}`,
              `Ende: ${e.endsAt?.toISOString() ?? "?"}`,
              e.allDay ? "Ganztägig" : null,
              e.location ? `Ort: ${e.location}` : null,
              e.rrule ? `Wiederholung: ${e.rrule}` : null,
              e.organizer ? `Organisator: ${e.organizer.name ?? ""} <${e.organizer.email ?? "?"}>` : null,
              e.attendees.length > 0
                ? `Teilnehmer:\n${e.attendees.map((a) => `  - ${a.name ?? ""} <${a.email ?? "?"}> [${a.partstat ?? "?"}]${a.self ? " (du)" : ""}`).join("\n")}`
                : null,
              e.description ? `\nBeschreibung:\n${cap(e.description, 2000)}` : null,
            ]
              .filter((l) => l !== null)
              .join("\n"),
          );
        },
      ),
    );
  }
  if (enabled.has("calendar_check_availability")) {
    tools.push(
      tool(
        "calendar_check_availability",
        "Prüft, ob ein Zeitraum frei ist (über alle Kalender). Liefert überschneidende Termine.",
        {
          from: z.string().describe("Start (ISO)"),
          to: z.string().describe("Ende (ISO)"),
        },
        async ({ from, to }) => {
          const start = new Date(from);
          const end = new Date(to);
          const rows = await db
            .select()
            .from(calendarEvents)
            .where(
              and(
                eq(calendarEvents.userId, userId),
                isNull(calendarEvents.deletedAt),
                lte(calendarEvents.startsAt, end),
                gte(calendarEvents.endsAt, start),
              ),
            )
            .limit(LIST_LIMIT);
          if (rows.length === 0) return ok("Der Zeitraum ist frei.");
          return ok(
            `Nicht frei — ${rows.length} überschneidende(r) Termin(e):\n` +
              rows
                .map((e) => `- ${e.startsAt?.toISOString()} – ${e.endsAt?.toISOString()}: ${e.summary}`)
                .join("\n"),
          );
        },
      ),
    );
  }

  // ---------- Dokumente ----------
  if (enabled.has("docs_list_folder")) {
    tools.push(
      tool(
        "docs_list_folder",
        "Listet Dateien und Unterordner eines Ordners im Dokumenten-Speicher.",
        {
          path: z.string().default("/").describe("Ordnerpfad, z. B. /Projekte"),
        },
        async ({ path: folderPath }) => {
          const stores = await db
            .select({ id: webdavStores.id })
            .from(webdavStores)
            .innerJoin(dataSources, eq(webdavStores.dataSourceId, dataSources.id))
            .where(eq(dataSources.userId, userId));
          if (stores.length === 0) return fail("Kein Dokumenten-Speicher verbunden.");
          const prefix = folderPath === "/" ? "/" : `${folderPath.replace(/\/$/, "")}/`;
          const rows = await db
            .select()
            .from(documentFiles)
            .where(
              and(
                eq(documentFiles.userId, userId),
                isNull(documentFiles.deletedAt),
                sql`${documentFiles.path} LIKE ${`${prefix}%`}`,
                sql`${documentFiles.path} NOT LIKE ${`${prefix}%/%`}`,
              ),
            )
            .orderBy(desc(documentFiles.isDir), documentFiles.name)
            .limit(LIST_LIMIT * 3);
          if (rows.length === 0) return ok("Ordner ist leer oder existiert nicht.");
          return ok(
            rows
              .map((f) => `- ${f.isDir ? "[Ordner]" : "[Datei]"} ${f.path}${f.size ? ` (${f.size} B)` : ""}`)
              .join("\n"),
          );
        },
      ),
    );
  }
  if (enabled.has("docs_read_document")) {
    tools.push(
      tool(
        "docs_read_document",
        "Liest ein Text-/Markdown-/CSV-Dokument aus dem Dokumenten-Speicher (max. 50 kB).",
        { path: z.string().describe("Dateipfad, z. B. /Projekte/alpha.md") },
        async ({ path: filePath }) => {
          const [file] = await db
            .select()
            .from(documentFiles)
            .where(
              and(
                eq(documentFiles.userId, userId),
                eq(documentFiles.path, filePath),
                isNull(documentFiles.deletedAt),
              ),
            );
          if (!file || file.isDir) return fail("Datei nicht gefunden.");
          if (!/\.(md|txt|csv|json|xml|yaml|yml)$/i.test(file.name) && !(file.mime ?? "").startsWith("text/")) {
            return fail("Nur Text-Formate (md, txt, csv, json, …) lesbar.");
          }
          try {
            const cfg = await getWebdavStoreConfigById(file.storeId);
            assertInsideRoot(cfg.rootPath, filePath);
            const client = createWebdavClient(cfg);
            const content = (await client.getFileContents(filePath, { format: "text" })) as string;
            return ok(`Inhalt von ${filePath} (etag: ${file.etag ?? "-"}):\n\n${cap(content, DOC_CAP)}`);
          } catch (err) {
            return fail(`Lesen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      ),
    );
  }

  // ---------- Kontakte ----------
  async function formatContact(contactId: string): Promise<string | null> {
    const [c] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)));
    if (!c) return null;
    const emails = await db
      .select()
      .from(contactEmails)
      .where(eq(contactEmails.contactId, c.id));
    const links = await db
      .select()
      .from(contactDocLinks)
      .where(eq(contactDocLinks.contactId, c.id));
    return [
      `Kontakt-ID (intern): ${c.id}`,
      `Name: ${c.displayName}`,
      c.firstName || c.lastName ? `Vor-/Nachname: ${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() : null,
      emails.length > 0
        ? `E-Mail: ${emails.map((e) => `${e.email}${e.isPrimary ? " (primär)" : ""}`).join(", ")}`
        : null,
      c.phone ? `Telefon: ${c.phone}` : null,
      c.currentEmployer ? `Arbeitgeber: ${c.currentEmployer}` : null,
      c.pastEmployers.length > 0
        ? `Frühere Arbeitgeber: ${c.pastEmployers.map((p) => p.name).join(", ")}`
        : null,
      c.notes ? `Notizen: ${cap(c.notes, 2000)}` : null,
      links.length > 0
        ? `Verknüpfte Dokumente/Ordner: ${links.map((l) => `${l.path}${l.includeChildren ? "/*" : ""}`).join(", ")}`
        : null,
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  if (enabled.has("contacts_lookup")) {
    tools.push(
      tool(
        "contacts_lookup",
        "Findet einen Kontakt anhand einer E-Mail-Adresse.",
        { email: z.string().email() },
        async ({ email }) => {
          const [match] = await db
            .select()
            .from(contactEmails)
            .where(
              and(
                eq(contactEmails.userId, userId),
                eq(contactEmails.email, email.toLowerCase()),
              ),
            );
          if (!match) {
            return ok(
              `Kein Kontakt mit ${email} vorhanden. Du kannst über propose_decision (contact_upsert) vorschlagen, einen anzulegen.`,
            );
          }
          const text = await formatContact(match.contactId);
          return text ? ok(text) : fail("Kontakt nicht lesbar.");
        },
      ),
    );
  }
  if (enabled.has("contacts_get")) {
    tools.push(
      tool(
        "contacts_get",
        "Liest einen Kontakt mit allen Feldern und Dokument-Verknüpfungen.",
        { contactId: z.string().uuid() },
        async ({ contactId }) => {
          const text = await formatContact(contactId);
          return text ? ok(text) : fail("Kontakt nicht gefunden.");
        },
      ),
    );
  }
  if (enabled.has("contacts_read_linked_documents")) {
    tools.push(
      tool(
        "contacts_read_linked_documents",
        "Liest die mit einem Kontakt verknüpften Dokumente (Text-Formate, gekürzt).",
        { contactId: z.string().uuid() },
        async ({ contactId }) => {
          const [c] = await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)));
          if (!c) return fail("Kontakt nicht gefunden.");
          const links = await db
            .select()
            .from(contactDocLinks)
            .where(eq(contactDocLinks.contactId, contactId));
          if (links.length === 0) return ok("Keine Dokumente verknüpft.");

          const parts: string[] = [];
          let budget = DOC_CAP;
          for (const link of links) {
            // Ordner-Links: enthaltene Dateien aus dem Index auflösen.
            const files = link.includeChildren
              ? await db
                  .select()
                  .from(documentFiles)
                  .where(
                    and(
                      eq(documentFiles.storeId, link.storeId),
                      isNull(documentFiles.deletedAt),
                      eq(documentFiles.isDir, false),
                      sql`${documentFiles.path} LIKE ${`${link.path}/%`}`,
                    ),
                  )
                  .limit(10)
              : await db
                  .select()
                  .from(documentFiles)
                  .where(
                    and(
                      eq(documentFiles.storeId, link.storeId),
                      eq(documentFiles.path, link.path),
                      isNull(documentFiles.deletedAt),
                    ),
                  );
            for (const file of files) {
              if (budget <= 0 || file.isDir) continue;
              if (!/\.(md|txt|csv|json)$/i.test(file.name) && !(file.mime ?? "").startsWith("text/")) {
                parts.push(`--- ${file.path} (übersprungen: kein Text-Format) ---`);
                continue;
              }
              try {
                const cfg = await getWebdavStoreConfigById(file.storeId);
                assertInsideRoot(cfg.rootPath, file.path);
                const client = createWebdavClient(cfg);
                const content = (await client.getFileContents(file.path, {
                  format: "text",
                })) as string;
                const chunk = cap(content, Math.min(budget, 10_000));
                budget -= chunk.length;
                parts.push(`--- ${file.path} ---\n${chunk}`);
              } catch (err) {
                parts.push(`--- ${file.path} (Fehler: ${err instanceof Error ? err.message : "?"}) ---`);
              }
            }
          }
          return ok(parts.join("\n\n") || "Keine lesbaren Dokumente gefunden.");
        },
      ),
    );
  }

  // ---------- Skill & Memory ----------
  if (enabled.has("skill_read")) {
    tools.push(
      tool(
        "skill_read",
        "Liest deine eigene Skill-Anweisung (Markdown). Änderungen schlägst du über propose_decision (Typ skill_update) vor.",
        {},
        async () => {
          const [row] = await db
            .select({ skillMarkdown: agents.skillMarkdown })
            .from(agents)
            .where(eq(agents.id, agent.id));
          return ok(row?.skillMarkdown ?? "");
        },
      ),
    );
  }
  if (enabled.has("memory_read")) {
    tools.push(
      tool(
        "memory_read",
        "Liest deine dauerhaften Notizen (Gedächtnis über alle Läufe hinweg).",
        {},
        async () => {
          const [row] = await db
            .select()
            .from(agentMemories)
            .where(eq(agentMemories.agentId, agent.id));
          return ok(row?.content || "(Gedächtnis ist leer)");
        },
      ),
    );
  }
  if (enabled.has("memory_write")) {
    tools.push(
      tool(
        "memory_write",
        "Ersetzt deine dauerhaften Notizen vollständig. Notiere kompakt, was für künftige Läufe wichtig ist.",
        { content: z.string().max(20_000) },
        async ({ content }) => {
          await db
            .insert(agentMemories)
            .values({ agentId: agent.id, content, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: agentMemories.agentId,
              set: { content, updatedAt: new Date() },
            });
          return ok("Gedächtnis aktualisiert.");
        },
      ),
    );
  }

  // ---------- Abschluss-Tools (immer aktiv) ----------
  tools.push(
    tool(
      "propose_decision",
      `Legt dem Nutzer eine Entscheidung zur Freigabe vor. Du kannst selbst NICHTS ausführen — dies ist dein einziger Weg, eine Aktion anzustoßen. Typen: ${decisionTypes.join(", ")}. Der payload muss zum Typ passen (email_send: {accountId, to[], cc[], subject, bodyText, inReplyToMessageId?}, event_rsvp: {eventId, partstat: ACCEPTED|DECLINED|TENTATIVE, comment?}, document_write: {storeId, path, newContent, baseEtag?}, contact_upsert: {contactId? (nur zum Aktualisieren), fields:{displayName?, firstName?, lastName?, phone?, currentEmployer?, notes?}, emails:[{email, label?, isPrimary?}]} — Name/Telefon/Arbeitgeber gehören ZWINGEND unter "fields", nicht auf die oberste Ebene; skill_update: {agentId, newMarkdown, changeSummary}).`,
      {
        type: z.enum(decisionTypes),
        title: z.string().min(3).max(200).describe("Kurzer Titel, z. B. 'Antwort an Anna Weber'"),
        summary: z.string().max(2000).describe("Begründung/Zusammenfassung für den Nutzer"),
        payload: z.record(z.unknown()).describe("Typ-spezifischer Entwurf"),
      },
      async ({ type, title, summary, payload }) => {
        const schema = decisionPayloadSchemas[type as DecisionType];
        // Häufige Payload-Fehler des Modells reparieren (z. B. Kontaktfelder
        // auf oberster Ebene), dann Skill-Änderungen auf den eigenen Agenten
        // beziehen.
        const normalized = normalizeProposedPayload(type as DecisionType, payload);
        const effectivePayload =
          type === "skill_update" ? { ...normalized, agentId: agent.id } : normalized;
        const parsed = schema.safeParse(effectivePayload);
        if (!parsed.success) {
          return fail(
            `Payload passt nicht zum Typ ${type}: ${parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}`,
          );
        }

        // Referenzen auf fremde Ressourcen abfangen.
        if (type === "email_send") {
          const accountId = (parsed.data as { accountId: string }).accountId;
          const [acc] = await db
            .select({ id: mailAccounts.id })
            .from(mailAccounts)
            .innerJoin(dataSources, eq(mailAccounts.dataSourceId, dataSources.id))
            .where(and(eq(mailAccounts.id, accountId), eq(dataSources.userId, userId)));
          if (!acc) return fail("accountId gehört zu keinem verbundenen Mail-Konto.");
        }
        if (type === "event_rsvp") {
          const eventId = (parsed.data as { eventId: string }).eventId;
          const [ev] = await db
            .select({ id: calendarEvents.id })
            .from(calendarEvents)
            .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId)));
          if (!ev) return fail("eventId gehört zu keinem bekannten Termin.");
        }
        if (type === "document_write") {
          const storeId = (parsed.data as { storeId: string }).storeId;
          const [st] = await db
            .select({ id: webdavStores.id })
            .from(webdavStores)
            .innerJoin(dataSources, eq(webdavStores.dataSourceId, dataSources.id))
            .where(and(eq(webdavStores.id, storeId), eq(dataSources.userId, userId)));
          if (!st) return fail("storeId gehört zu keinem verbundenen Dokumenten-Speicher.");
        }

        const [decision] = await db
          .insert(decisions)
          .values({
            userId,
            agentId: agent.id,
            runId: ctx.runId,
            type: type as DecisionType,
            title,
            summary,
            payload: parsed.data as Record<string, unknown>,
            originalPayload: parsed.data as Record<string, unknown>,
          })
          .returning();
        if (!decision) return fail("Entscheidung konnte nicht angelegt werden.");

        await db.insert(decisionAudit).values({
          decisionId: decision.id,
          actor: "agent",
          action: "created",
          detail: { title },
        });
        await ctx.emit("decision_created", {
          decisionId: decision.id,
          type,
          title,
          summary,
        });
        await publishAppEvent(userId, {
          type: "decision.changed",
          decisionId: decision.id,
          status: "open",
        });
        return ok(
          `Entscheidung "${title}" wurde dem Nutzer vorgelegt (ID ${decision.id}). Der Nutzer kann sie anpassen, freigeben oder ablehnen.`,
        );
      },
    ),
    tool(
      "no_action_needed",
      "Schließt den Lauf ab, wenn keine Aktion nötig ist. Gib eine kurze Begründung an.",
      { reason: z.string().min(3).max(1000) },
      async ({ reason }) => ok(`Verstanden — keine Aktion nötig: ${reason}`),
    ),
  );

  const server = createSdkMcpServer({ name: "team", version: "1.0.0", tools });
  const allowedTools = tools.map((t) => `mcp__team__${(t as { name: string }).name}`);
  return { server, allowedTools };
}
