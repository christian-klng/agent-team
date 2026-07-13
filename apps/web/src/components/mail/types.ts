export interface MailFolder {
  id: string;
  accountId: string;
  path: string;
  displayName: string;
  role: string;
  syncEnabled: boolean;
  unread: number;
}

export interface MailAccount {
  accountId: string;
  sourceId: string;
  name: string;
  color: string;
  enabled: boolean;
  fromAddress: string;
  folders: MailFolder[];
}

export interface MailListItem {
  id: string;
  accountId: string;
  folderId: string;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  sentAt: string | null;
  seen: boolean;
  answered: boolean;
  flagged: boolean;
  snippet: string;
  hasAttachments: boolean;
}

export interface MailDetail extends MailListItem {
  toAddrs: { name?: string; address: string }[];
  ccAddrs: { name?: string; address: string }[];
  textBody: string | null;
  htmlSanitized: string | null;
  bodyAvailable: boolean;
  attachments: {
    id: string;
    filename: string | null;
    mime: string | null;
    size: number | null;
  }[];
}

/** Auswahl in der Mail-Navigation. */
export type MailScope =
  | { kind: "unified" } // Posteingang über alle Konten
  | { kind: "account"; accountId: string }
  | { kind: "folder"; accountId: string; folderId: string };
