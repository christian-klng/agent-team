import type { DataSourceType } from "./triggers";

export type ToolGroup = "mail" | "calendar" | "docs" | "contacts" | "skill" | "memory";

export interface ToolCatalogEntry {
  name: string;
  group: ToolGroup;
  label: string;
  description: string;
  /** Quelle, die der Agent verbunden haben muss, damit das Tool Sinn ergibt (null = immer verfügbar). */
  requiresSourceType: DataSourceType | null;
}

/**
 * Katalog aller aktivierbaren Read-Tools. `propose_decision` und
 * `no_action_needed` stehen jedem Agenten immer zur Verfügung und sind
 * bewusst nicht abschaltbar — sie sind der einzige Weg, einen Run sinnvoll
 * abzuschließen.
 */
export const toolCatalog: ToolCatalogEntry[] = [
  {
    name: "mail_get_message",
    group: "mail",
    label: "E-Mail lesen",
    description: "Liest eine einzelne E-Mail inklusive Text-Inhalt.",
    requiresSourceType: "email",
  },
  {
    name: "mail_search",
    group: "mail",
    label: "E-Mails durchsuchen",
    description: "Durchsucht E-Mails nach Stichwort, Absender, Ordner oder Zeitraum.",
    requiresSourceType: "email",
  },
  {
    name: "mail_list_from_sender",
    group: "mail",
    label: "E-Mails eines Absenders",
    description: "Listet die letzten E-Mails eines bestimmten Absenders.",
    requiresSourceType: "email",
  },
  {
    name: "mail_get_thread",
    group: "mail",
    label: "E-Mail-Verlauf lesen",
    description: "Liest den gesamten Thread zu einer E-Mail.",
    requiresSourceType: "email",
  },
  {
    name: "calendar_list_events",
    group: "calendar",
    label: "Termine auflisten",
    description: "Listet Termine in einem Zeitraum, optional je Kalender.",
    requiresSourceType: "caldav",
  },
  {
    name: "calendar_get_event",
    group: "calendar",
    label: "Termin lesen",
    description: "Liest einen einzelnen Termin mit allen Details.",
    requiresSourceType: "caldav",
  },
  {
    name: "calendar_check_availability",
    group: "calendar",
    label: "Verfügbarkeit prüfen",
    description: "Prüft, ob ein Zeitraum frei ist (über alle Kalender).",
    requiresSourceType: "caldav",
  },
  {
    name: "docs_list_folder",
    group: "docs",
    label: "Ordner auflisten",
    description: "Listet Dateien und Unterordner eines Ordners.",
    requiresSourceType: "webdav",
  },
  {
    name: "docs_read_document",
    group: "docs",
    label: "Dokument lesen",
    description: "Liest ein Text-/Markdown-/CSV-Dokument (max. 50 kB).",
    requiresSourceType: "webdav",
  },
  {
    name: "contacts_lookup",
    group: "contacts",
    label: "Kontakt per E-Mail finden",
    description: "Findet einen Kontakt anhand einer E-Mail-Adresse.",
    requiresSourceType: null,
  },
  {
    name: "contacts_get",
    group: "contacts",
    label: "Kontakt lesen",
    description: "Liest einen Kontakt mit allen Feldern und Verknüpfungen.",
    requiresSourceType: null,
  },
  {
    name: "contacts_read_linked_documents",
    group: "contacts",
    label: "Verknüpfte Dokumente lesen",
    description: "Liest die mit einem Kontakt verknüpften Dokumente.",
    requiresSourceType: null,
  },
  {
    name: "skill_read",
    group: "skill",
    label: "Eigenen Skill lesen",
    description: "Liest die eigene Skill-Anweisung (Markdown).",
    requiresSourceType: null,
  },
  {
    name: "memory_read",
    group: "memory",
    label: "Gedächtnis lesen",
    description: "Liest die eigenen dauerhaften Notizen.",
    requiresSourceType: null,
  },
  {
    name: "memory_write",
    group: "memory",
    label: "Gedächtnis schreiben",
    description: "Ersetzt die eigenen dauerhaften Notizen (Markdown).",
    requiresSourceType: null,
  },
];

export const toolGroupLabels: Record<ToolGroup, string> = {
  mail: "E-Mail",
  calendar: "Kalender",
  docs: "Dokumente",
  contacts: "Kontakte",
  skill: "Skill",
  memory: "Gedächtnis",
};

/** Tools, die jeder Run unabhängig von der Konfiguration bekommt. */
export const alwaysOnTools = ["propose_decision", "no_action_needed"] as const;

/** Deutsche Statuszeilen fürs RunPanel ("Werkzeug ausgeführt"-Anzeige). */
export const toolActionLabels: Record<string, string> = {
  mail_get_message: "E-Mail gelesen",
  mail_search: "E-Mails durchsucht",
  mail_list_from_sender: "E-Mails des Absenders gelesen",
  mail_get_thread: "E-Mail-Verlauf gelesen",
  calendar_list_events: "Termine gelesen",
  calendar_get_event: "Termin gelesen",
  calendar_check_availability: "Verfügbarkeit geprüft",
  docs_list_folder: "Ordner aufgelistet",
  docs_read_document: "Dokument gelesen",
  contacts_lookup: "Kontakt gesucht",
  contacts_get: "Kontakt gelesen",
  contacts_read_linked_documents: "Verknüpfte Dokumente gelesen",
  skill_read: "Skill gelesen",
  memory_read: "Gedächtnis gelesen",
  memory_write: "Gedächtnis aktualisiert",
  propose_decision: "Entscheidung vorgelegt",
  no_action_needed: "Keine Aktion nötig",
};
