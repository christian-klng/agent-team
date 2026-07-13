import { z } from "zod";

export const decisionTypes = [
  "email_send",
  "event_rsvp",
  "document_write",
  "contact_upsert",
  "skill_update",
] as const;
export type DecisionType = (typeof decisionTypes)[number];

export const decisionStatuses = [
  "open",
  "approved",
  "executing",
  "executed",
  "rejected",
  "failed",
] as const;
export type DecisionStatus = (typeof decisionStatuses)[number];

export const emailSendPayloadSchema = z.object({
  accountId: z.string().uuid().describe("ID des Mail-Kontos, über das gesendet wird"),
  to: z.array(z.string().email()).min(1).describe("Empfänger"),
  cc: z.array(z.string().email()).default([]).describe("CC-Empfänger"),
  subject: z.string().min(1).describe("Betreff"),
  bodyText: z.string().min(1).describe("E-Mail-Text (Plaintext)"),
  inReplyToMessageId: z
    .string()
    .uuid()
    .optional()
    .describe("Interne ID der Mail, auf die geantwortet wird"),
});
export type EmailSendPayload = z.infer<typeof emailSendPayloadSchema>;

export const eventRsvpPayloadSchema = z.object({
  eventId: z.string().uuid().describe("Interne ID des Kalender-Termins"),
  partstat: z
    .enum(["ACCEPTED", "DECLINED", "TENTATIVE"])
    .describe("Antwort: Zusage, Absage oder Vorbehalt"),
  comment: z.string().optional().describe("Optionaler Kommentar an den Organisator"),
});
export type EventRsvpPayload = z.infer<typeof eventRsvpPayloadSchema>;

export const documentWritePayloadSchema = z.object({
  storeId: z.string().uuid().describe("ID des Dokumenten-Speichers"),
  path: z.string().min(1).describe("Pfad der Datei im Speicher"),
  newContent: z.string().describe("Vollständiger neuer Dateiinhalt"),
  baseEtag: z
    .string()
    .nullable()
    .optional()
    .describe("ETag der gelesenen Version (Konflikt-Schutz); null bei neuer Datei"),
});
export type DocumentWritePayload = z.infer<typeof documentWritePayloadSchema>;

export const pastEmployerSchema = z.object({
  name: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const contactUpsertPayloadSchema = z.object({
  contactId: z
    .string()
    .uuid()
    .optional()
    .describe("Bestehender Kontakt (leer = neuen Kontakt anlegen)"),
  fields: z.object({
    displayName: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    currentEmployer: z.string().optional(),
    pastEmployers: z.array(pastEmployerSchema).optional(),
    notes: z.string().optional(),
  }),
  emails: z
    .array(
      z.object({
        email: z.string().email(),
        label: z.string().optional(),
        isPrimary: z.boolean().default(false),
      }),
    )
    .default([]),
});
export type ContactUpsertPayload = z.infer<typeof contactUpsertPayloadSchema>;

export const skillUpdatePayloadSchema = z.object({
  agentId: z.string().uuid().describe("ID des Agenten, dessen Skill geändert wird"),
  newMarkdown: z.string().min(1).describe("Vollständiger neuer Skill-Inhalt (Markdown)"),
  changeSummary: z.string().min(1).describe("Kurzbeschreibung der Änderung"),
});
export type SkillUpdatePayload = z.infer<typeof skillUpdatePayloadSchema>;

export const decisionPayloadSchemas: Record<DecisionType, z.ZodTypeAny> = {
  email_send: emailSendPayloadSchema,
  event_rsvp: eventRsvpPayloadSchema,
  document_write: documentWritePayloadSchema,
  contact_upsert: contactUpsertPayloadSchema,
  skill_update: skillUpdatePayloadSchema,
};

export const decisionTypeLabels: Record<DecisionType, string> = {
  email_send: "E-Mail senden",
  event_rsvp: "Termineinladung beantworten",
  document_write: "Dokument schreiben",
  contact_upsert: "Kontakt aktualisieren",
  skill_update: "Skill anpassen",
};

export const decisionStatusLabels: Record<DecisionStatus, string> = {
  open: "Offen",
  approved: "Freigegeben",
  executing: "Wird ausgeführt",
  executed: "Ausgeführt",
  rejected: "Abgelehnt",
  failed: "Fehlgeschlagen",
};
