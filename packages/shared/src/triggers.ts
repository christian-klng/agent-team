import { z } from "zod";

export const dataSourceTypes = ["email", "caldav", "webdav"] as const;
export type DataSourceType = (typeof dataSourceTypes)[number];

export const dataSourceTypeLabels: Record<DataSourceType, string> = {
  email: "E-Mail",
  caldav: "Kalender",
  webdav: "Dokumente",
};

export const triggerKinds = [
  "mail.new",
  "mail.updated",
  "event.new",
  "event.updated",
  "file.new",
  "file.updated",
] as const;
export type TriggerKind = (typeof triggerKinds)[number];

export const triggerKindLabels: Record<TriggerKind, string> = {
  "mail.new": "Neue E-Mail",
  "mail.updated": "E-Mail geändert",
  "event.new": "Neuer Termin",
  "event.updated": "Termin geändert",
  "file.new": "Neue Datei",
  "file.updated": "Datei geändert",
};

export const triggerKindsBySourceType: Record<DataSourceType, TriggerKind[]> = {
  email: ["mail.new", "mail.updated"],
  caldav: ["event.new", "event.updated"],
  webdav: ["file.new", "file.updated"],
};

/** Optionale Einschränkungen, wann ein Trigger einen Agenten startet. */
export const triggerFilterSchema = z.object({
  folderIds: z.array(z.string().uuid()).optional(),
  calendarIds: z.array(z.string().uuid()).optional(),
  senderPattern: z.string().optional(),
  pathPrefix: z.string().optional(),
});
export type TriggerFilter = z.infer<typeof triggerFilterSchema>;
