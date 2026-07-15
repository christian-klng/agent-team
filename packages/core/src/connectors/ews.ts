/// <reference path="../types/ewsjs-ntlm-client.d.ts" />
import http from "node:http";
import https from "node:https";
// CommonJS-Paket: als Default importieren und zur Laufzeit destrukturieren.
// Named-Imports auf CJS schlagen unter nativem Node-ESM fehl (der Worker läuft
// als ESM), obwohl esbuild/tsx sie durchgehen lassen.
import ntlmClient from "@ewsjs/ntlm-client";
import { XMLParser } from "fast-xml-parser";

const { createType1Message, decodeType2Message, createType3Message } = ntlmClient;

/**
 * Minimaler EWS-SOAP-Client (Exchange Web Services) für On-Prem-Exchange.
 * Bewusst kein ews-javascript-api: unmaintained und schwergewichtig — wir
 * brauchen nur GetFolder, SyncFolderItems, GetItem und CreateItem.
 *
 * Auth: Basic und NTLM(v2). NTLM authentifiziert die TCP-Verbindung, nicht
 * die einzelne Anfrage — deshalb ein keepAlive-Agent mit maxSockets: 1.
 */

const CONNECT_TIMEOUT_MS = 15_000;
const RESPONSE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const WORKSTATION = "AGENTTEAM";

export interface EwsConnectionInput {
  ewsUrl: string;
  ewsUser: string;
  ewsPassword: string;
  ewsDomain: string | null;
}

export type EwsErrorKind = "network" | "http" | "auth" | "soap" | "toolarge" | "parse";

export class EwsError extends Error {
  kind: EwsErrorKind;
  status?: number;
  /** Vom Server angebotene Auth-Verfahren (aus dem 401). */
  schemes?: string[];
  /** EWS-ResponseCode, z. B. "ErrorItemNotFound". */
  responseCode?: string;
  location?: string;
  code?: string;

  constructor(
    message: string,
    opts: {
      kind: EwsErrorKind;
      status?: number;
      schemes?: string[];
      responseCode?: string;
      location?: string;
      code?: string;
    },
  ) {
    super(message);
    this.name = "EwsError";
    this.kind = opts.kind;
    this.status = opts.status;
    this.schemes = opts.schemes;
    this.responseCode = opts.responseCode;
    this.location = opts.location;
    this.code = opts.code;
  }
}

/** Ergänzt fehlenden Pfad zum Standard-Endpunkt /EWS/Exchange.asmx. */
export function normalizeEwsUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new EwsError("EWS-URL muss mit https:// beginnen.", { kind: "network" });
  }
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/EWS/Exchange.asmx";
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildEnvelope(inner: string): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>` +
      `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"` +
      ` xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"` +
      ` xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">` +
      `<soap:Header><t:RequestServerVersion Version="Exchange2013"/></soap:Header>` +
      `<soap:Body>${inner}</soap:Body></soap:Envelope>`,
    "utf8",
  );
}

const EMPTY_BODY = Buffer.alloc(0);

/* ---------- Parsing-Helfer (fast-xml-parser liefert je nach Anzahl Objekt oder Array) ---------- */

function toArr<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null || v === "") return [];
  return Array.isArray(v) ? v : [v];
}

type XmlNode = Record<string, unknown>;

function textOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in (v as XmlNode)) {
    const t = (v as XmlNode)["#text"];
    return typeof t === "string" ? t : null;
  }
  return null;
}

function attrOf(v: unknown, name: string): string | null {
  if (v && typeof v === "object") {
    const a = (v as XmlNode)[`@_${name}`];
    if (typeof a === "string") return a;
  }
  return null;
}

export interface EwsAddress {
  name?: string;
  address?: string;
}

export interface EwsItemSummary {
  itemId: string;
  changeKey: string | null;
  itemClass: string | null;
  subject: string;
  internetMessageId: string | null;
  from: EwsAddress | null;
  to: EwsAddress[];
  cc: EwsAddress[];
  sentAt: string | null;
  receivedAt: string | null;
  isRead: boolean;
  hasAttachments: boolean;
  size: number | null;
}

export interface EwsSyncResult {
  syncState: string;
  includesLastItem: boolean;
  created: EwsItemSummary[];
  updated: EwsItemSummary[];
  deletedItemIds: string[];
  readFlagChanges: { itemId: string; isRead: boolean }[];
}

export type EwsWellKnownFolder =
  | "inbox"
  | "sentitems"
  | "drafts"
  | "deleteditems"
  | "junkemail"
  | "archive";

export const EWS_WELL_KNOWN_FOLDERS: EwsWellKnownFolder[] = [
  "inbox",
  "sentitems",
  "drafts",
  "deleteditems",
  "junkemail",
  "archive",
];

export interface EwsFolderInfo {
  wellKnown: EwsWellKnownFolder;
  folderId: string;
  displayName: string;
  unreadCount: number | null;
  totalCount: number | null;
}

export interface EwsCalendarItem {
  itemId: string;
  changeKey: string | null;
  subject: string;
  start: string | null;
  end: string | null;
  isAllDay: boolean;
  location: string | null;
  organizer: EwsAddress | null;
  /** Accept | Decline | Tentative | NoResponseReceived | Organizer | Unknown */
  myResponseType: string | null;
  uid: string | null;
  calendarItemType: string | null;
}

function mailboxToAddress(v: unknown): EwsAddress | null {
  if (!v || typeof v !== "object") return null;
  const node = v as XmlNode;
  const name = textOf(node.Name) ?? undefined;
  const address = textOf(node.EmailAddress) ?? undefined;
  if (!name && !address) return null;
  return { name, address };
}

function parseItemSummary(item: unknown): EwsItemSummary | null {
  if (!item || typeof item !== "object") return null;
  const node = item as XmlNode;
  const itemId = attrOf(node.ItemId, "Id");
  if (!itemId) return null;
  const from = mailboxToAddress((node.From as XmlNode | undefined)?.Mailbox);
  const to = toArr((node.ToRecipients as XmlNode | undefined)?.Mailbox)
    .map(mailboxToAddress)
    .filter((a): a is EwsAddress => a !== null);
  const cc = toArr((node.CcRecipients as XmlNode | undefined)?.Mailbox)
    .map(mailboxToAddress)
    .filter((a): a is EwsAddress => a !== null);
  const sizeText = textOf(node.Size);
  return {
    itemId,
    changeKey: attrOf(node.ItemId, "ChangeKey"),
    itemClass: textOf(node.ItemClass),
    subject: textOf(node.Subject) ?? "",
    internetMessageId: textOf(node.InternetMessageId),
    from,
    to,
    cc,
    sentAt: textOf(node.DateTimeSent),
    receivedAt: textOf(node.DateTimeReceived),
    isRead: textOf(node.IsRead) === "true",
    hasAttachments: textOf(node.HasAttachments) === "true",
    size: sizeText ? Number(sizeText) || null : null,
  };
}

/** Extrahiert aus einem Change-Eintrag das enthaltene Item (Message, MeetingRequest, …). */
function itemOfChange(change: unknown): unknown {
  if (!change || typeof change !== "object") return null;
  for (const [key, value] of Object.entries(change as XmlNode)) {
    if (key.startsWith("@_") || key === "#text" || key === "ItemId") continue;
    return value;
  }
  return null;
}

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function extractSchemes(header: string | undefined): string[] {
  if (!header) return [];
  const schemes: string[] = [];
  for (const m of header.matchAll(/(?:^|,)\s*(Negotiate|NTLM|Basic|Digest|Bearer)\b/gi)) {
    const s = m[1]!;
    const canonical =
      s.toLowerCase() === "ntlm" ? "NTLM" : s[0]!.toUpperCase() + s.slice(1).toLowerCase();
    if (!schemes.includes(canonical)) schemes.push(canonical);
  }
  return schemes;
}

/** Holt den Base64-Teil der NTLM-Challenge aus dem WWW-Authenticate-Header. */
function extractChallenge(header: string | undefined): string | null {
  if (!header) return null;
  const m = header.match(/(?:NTLM|Negotiate)\s+([A-Za-z0-9+/=]+)/);
  return m ? m[1]! : null;
}

export class EwsClient {
  private url: URL;
  private agent: http.Agent | https.Agent;
  private cfg: EwsConnectionInput;
  private parser: XMLParser;
  private authMode: "basic" | "ntlm" | "none" | null = null;
  private ntlmScheme: "NTLM" | "Negotiate" = "NTLM";
  /** Vom Server im Probe-401 angebotene Verfahren. */
  offeredSchemes: string[] = [];

  constructor(cfg: EwsConnectionInput) {
    this.cfg = cfg;
    this.url = new URL(normalizeEwsUrl(cfg.ewsUrl));
    const AgentCtor = this.url.protocol === "https:" ? https.Agent : http.Agent;
    // maxSockets 1: NTLM authentifiziert die Verbindung — alle Requests
    // müssen über denselben Socket laufen.
    this.agent = new AgentCtor({ keepAlive: true, maxSockets: 1 });
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
    });
  }

  close(): void {
    this.agent.destroy();
  }

  /** Kurzbeschreibung des verwendeten Logins für Diagnose-Ausgaben. */
  authDescription(): string {
    const { user, domain } = this.splitUser();
    const login = domain ? `${domain}\\${user}` : user;
    if (this.authMode === "ntlm") return `${this.ntlmScheme} als ${login}`;
    if (this.authMode === "basic") return `Basic als ${login}`;
    return login;
  }

  private splitUser(): { user: string; domain: string } {
    const raw = this.cfg.ewsUser;
    if (this.cfg.ewsDomain) return { user: raw, domain: this.cfg.ewsDomain };
    const m = raw.match(/^([^\\]+)\\(.+)$/);
    if (m) return { domain: m[1]!, user: m[2]! };
    return { user: raw, domain: "" };
  }

  private rawRequest(
    headers: Record<string, string>,
    body: Buffer,
    maxBytes: number,
  ): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      const mod = this.url.protocol === "https:" ? https : http;
      const req = mod.request(
        this.url,
        {
          method: "POST",
          agent: this.agent,
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            "User-Agent": "AgentTeam/1.0",
            "Content-Length": String(body.length),
            ...headers,
          },
          timeout: CONNECT_TIMEOUT_MS,
        },
        (res) => {
          // Ab jetzt gilt das (längere) Antwort-Timeout.
          req.setTimeout(RESPONSE_TIMEOUT_MS);
          const chunks: Buffer[] = [];
          let total = 0;
          res.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
              req.destroy(
                new EwsError(`Antwort größer als ${Math.round(maxBytes / 1024 / 1024)} MB.`, {
                  kind: "toolarge",
                }),
              );
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
          res.on("error", (err) => reject(this.wrapNetworkError(err)));
        },
      );
      req.on("timeout", () => {
        req.destroy(
          new EwsError("Zeitüberschreitung — der Server antwortet nicht.", {
            kind: "network",
            code: "ETIMEDOUT",
          }),
        );
      });
      req.on("error", (err) => reject(this.wrapNetworkError(err)));
      req.end(body);
    });
  }

  private wrapNetworkError(err: unknown): EwsError {
    if (err instanceof EwsError) return err;
    const e = err as NodeJS.ErrnoException;
    return new EwsError(e.message ?? "Netzwerkfehler", {
      kind: "network",
      code: e.code,
    });
  }

  /** Ermittelt per unauthentifiziertem Request die angebotenen Auth-Verfahren. */
  async probe(): Promise<{ status: number; schemes: string[] }> {
    const res = await this.rawRequest({}, EMPTY_BODY, DEFAULT_MAX_RESPONSE_BYTES);
    const header = res.headers["www-authenticate"] as string | undefined;
    this.offeredSchemes = extractSchemes(header);

    if (res.status === 401) {
      const hasNtlm = this.offeredSchemes.includes("NTLM");
      const hasNegotiate = this.offeredSchemes.includes("Negotiate");
      const hasBasic = this.offeredSchemes.includes("Basic");
      if (hasBasic) {
        this.authMode = "basic";
      } else if (hasNtlm || hasNegotiate) {
        this.authMode = "ntlm";
        this.ntlmScheme = hasNtlm ? "NTLM" : "Negotiate";
      } else {
        throw new EwsError(
          `Keines der angebotenen Anmeldeverfahren wird unterstützt (${
            this.offeredSchemes.join(", ") || "keine genannt"
          }). Unterstützt sind Basic und NTLM.`,
          { kind: "auth", status: 401, schemes: this.offeredSchemes },
        );
      }
    } else if (res.status >= 300 && res.status < 400) {
      throw new EwsError(
        `Server leitet um (${res.status})${
          res.headers.location ? ` nach ${res.headers.location}` : ""
        } — EWS-URL prüfen.`,
        { kind: "http", status: res.status, location: res.headers.location },
      );
    } else if (res.status === 404) {
      throw new EwsError(
        "EWS-Endpunkt nicht gefunden (404) — üblich ist https://<owa-host>/EWS/Exchange.asmx.",
        { kind: "http", status: 404 },
      );
    } else {
      // Kein 401: Server verlangt offenbar keine Authentifizierung (untypisch).
      this.authMode = "none";
    }
    return { status: res.status, schemes: this.offeredSchemes };
  }

  private basicAuthHeader(): string {
    const { user, domain } = this.splitUser();
    const login = domain ? `${domain}\\${user}` : user;
    return `Basic ${Buffer.from(`${login}:${this.cfg.ewsPassword}`, "utf8").toString("base64")}`;
  }

  /** Ersetzt das "NTLM"-Präfix der Client-Messages durch das Serving-Schema. */
  private withScheme(message: string): string {
    return this.ntlmScheme === "NTLM" ? message : message.replace(/^NTLM /, "Negotiate ");
  }

  private async ntlmHandshakeAndSend(body: Buffer, maxBytes: number): Promise<HttpResult> {
    const { user, domain } = this.splitUser();
    const type1 = createType1Message(WORKSTATION, domain || undefined);
    const r1 = await this.rawRequest(
      { Authorization: this.withScheme(type1) },
      EMPTY_BODY,
      DEFAULT_MAX_RESPONSE_BYTES,
    );
    if (r1.status !== 401) return r1;
    const challenge = extractChallenge(r1.headers["www-authenticate"] as string | undefined);
    if (!challenge) {
      throw new EwsError(
        "Server hat keine NTLM-Challenge geliefert — NTLM ist offenbar deaktiviert.",
        { kind: "auth", status: 401, schemes: extractSchemes(r1.headers["www-authenticate"] as string | undefined) },
      );
    }
    const type2 = decodeType2Message(challenge);
    // NTLMv2 immer verwenden, sobald der Server Target-Info liefert — der
    // NTLMv1-Pfad der Bibliothek ist defekt und NTLMv1 ohnehin obsolet.
    if (type2.targetInfo) {
      type2.version = 2;
    } else if (type2.version !== 2) {
      throw new EwsError(
        "Server verlangt veraltetes NTLMv1 (ohne Target-Info) — wird nicht unterstützt.",
        { kind: "auth", status: 401 },
      );
    }
    const type3 = createType3Message(type2, user, this.cfg.ewsPassword, WORKSTATION, domain || undefined);
    return this.rawRequest({ Authorization: this.withScheme(type3) }, body, maxBytes);
  }

  /**
   * Führt einen SOAP-Call aus und liefert das geparste Body-Objekt
   * (Namespace-Präfixe entfernt).
   */
  async soap(inner: string, opts?: { maxBytes?: number }): Promise<XmlNode> {
    const body = buildEnvelope(inner);
    const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (this.authMode === null) await this.probe();

    let res: HttpResult;
    if (this.authMode === "basic") {
      res = await this.rawRequest({ Authorization: this.basicAuthHeader() }, body, maxBytes);
      // Basic angeboten, aber abgelehnt — auf NTLM ausweichen, falls möglich.
      if (
        res.status === 401 &&
        (this.offeredSchemes.includes("NTLM") || this.offeredSchemes.includes("Negotiate"))
      ) {
        this.authMode = "ntlm";
        this.ntlmScheme = this.offeredSchemes.includes("NTLM") ? "NTLM" : "Negotiate";
      }
    } else {
      res = { status: 401, headers: {}, body: EMPTY_BODY };
    }

    if (this.authMode === "ntlm") {
      // Socket kann noch authentifiziert sein — erst ohne Header versuchen.
      res = await this.rawRequest({}, body, maxBytes);
      if (res.status === 401) {
        res = await this.ntlmHandshakeAndSend(body, maxBytes);
      }
    } else if (this.authMode === "none") {
      res = await this.rawRequest({}, body, maxBytes);
    }

    if (res.status === 401) {
      throw new EwsError("Anmeldung abgelehnt (401).", {
        kind: "auth",
        status: 401,
        schemes: this.offeredSchemes,
      });
    }

    // EWS liefert SOAP-Faults als HTTP 500 mit XML-Body.
    const text = res.body.toString("utf8");
    if (res.status !== 200) {
      const fault = this.tryParseFault(text);
      if (fault) {
        throw new EwsError(fault.message, {
          kind: "soap",
          status: res.status,
          responseCode: fault.responseCode ?? undefined,
        });
      }
      throw new EwsError(`Server antwortete mit HTTP ${res.status}.`, {
        kind: "http",
        status: res.status,
      });
    }

    let parsed: XmlNode;
    try {
      parsed = this.parser.parse(text) as XmlNode;
    } catch {
      throw new EwsError("Antwort ist kein gültiges XML.", { kind: "parse" });
    }
    const envelope = parsed.Envelope as XmlNode | undefined;
    const soapBody = envelope?.Body as XmlNode | undefined;
    if (!soapBody) {
      throw new EwsError("Antwort enthält keinen SOAP-Body.", { kind: "parse" });
    }
    return soapBody;
  }

  private tryParseFault(text: string): { message: string; responseCode: string | null } | null {
    try {
      const parsed = this.parser.parse(text) as XmlNode;
      const bodyNode = (parsed.Envelope as XmlNode | undefined)?.Body as XmlNode | undefined;
      const fault = bodyNode?.Fault as XmlNode | undefined;
      if (!fault) return null;
      const responseCode =
        textOf((fault.detail as XmlNode | undefined)?.ResponseCode) ??
        textOf((fault.detail as XmlNode | undefined)?.ExceptionType);
      const message =
        textOf(fault.faultstring) ??
        textOf((fault.Reason as XmlNode | undefined)?.Text) ??
        "SOAP-Fehler";
      return { message: responseCode ? `${message} (${responseCode})` : message, responseCode };
    } catch {
      return null;
    }
  }

  /** Wirft bei ResponseClass=Error; liefert die erste ResponseMessage. */
  private firstResponseMessage(bodyNode: XmlNode, op: string): XmlNode {
    const container = (bodyNode[`${op}Response`] as XmlNode | undefined)?.ResponseMessages as
      | XmlNode
      | undefined;
    const msg = toArr(container?.[`${op}ResponseMessage`])[0] as XmlNode | undefined;
    if (!msg) {
      throw new EwsError(`Unerwartete ${op}-Antwort vom Server.`, { kind: "parse" });
    }
    if (attrOf(msg, "ResponseClass") === "Error") {
      const code = textOf(msg.ResponseCode);
      const messageText = textOf(msg.MessageText) ?? "EWS-Fehler";
      throw new EwsError(code ? `${messageText} (${code})` : messageText, {
        kind: "soap",
        responseCode: code ?? undefined,
      });
    }
    return msg;
  }

  /** Standard-Ordner (Posteingang, Gesendet, …) mit IDs und Zählern. */
  async getWellKnownFolders(): Promise<EwsFolderInfo[]> {
    const inner =
      `<m:GetFolder><m:FolderShape><t:BaseShape>Default</t:BaseShape></m:FolderShape><m:FolderIds>` +
      EWS_WELL_KNOWN_FOLDERS.map((id) => `<t:DistinguishedFolderId Id="${id}"/>`).join("") +
      `</m:FolderIds></m:GetFolder>`;
    const bodyNode = await this.soap(inner);
    const container = (bodyNode.GetFolderResponse as XmlNode | undefined)?.ResponseMessages as
      | XmlNode
      | undefined;
    const messages = toArr(container?.GetFolderResponseMessage) as XmlNode[];
    const result: EwsFolderInfo[] = [];
    messages.forEach((msg, i) => {
      const wellKnown = EWS_WELL_KNOWN_FOLDERS[i];
      // Einzelne Ordner dürfen fehlen (z. B. kein Archiv eingerichtet).
      if (!wellKnown || attrOf(msg, "ResponseClass") === "Error") return;
      const folder = (msg.Folders as XmlNode | undefined)?.Folder as XmlNode | undefined;
      const folderId = attrOf(folder?.FolderId, "Id");
      if (!folder || !folderId) return;
      const unread = textOf(folder.UnreadCount);
      const total = textOf(folder.TotalCount);
      result.push({
        wellKnown,
        folderId,
        displayName: textOf(folder.DisplayName) ?? wellKnown,
        unreadCount: unread !== null ? Number(unread) : null,
        totalCount: total !== null ? Number(total) : null,
      });
    });
    if (result.length === 0) {
      throw new EwsError("Keine Postfach-Ordner gefunden.", { kind: "parse" });
    }
    return result;
  }

  /** Inkrementeller Abgleich eines Ordners via SyncFolderItems. */
  async syncFolderItems(
    folderId: string,
    syncState: string | null,
    maxChanges = 256,
  ): Promise<EwsSyncResult> {
    const inner =
      `<m:SyncFolderItems><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>` +
      [
        "item:Subject",
        "item:DateTimeReceived",
        "item:DateTimeSent",
        "item:Size",
        "item:HasAttachments",
        "item:ItemClass",
        "message:IsRead",
        "message:From",
        "message:ToRecipients",
        "message:CcRecipients",
        "message:InternetMessageId",
      ]
        .map((f) => `<t:FieldURI FieldURI="${f}"/>`)
        .join("") +
      `</t:AdditionalProperties></m:ItemShape>` +
      `<m:SyncFolderId><t:FolderId Id="${escapeXml(folderId)}"/></m:SyncFolderId>` +
      (syncState ? `<m:SyncState>${escapeXml(syncState)}</m:SyncState>` : "") +
      `<m:MaxChangesReturned>${maxChanges}</m:MaxChangesReturned></m:SyncFolderItems>`;
    const bodyNode = await this.soap(inner);
    const msg = this.firstResponseMessage(bodyNode, "SyncFolderItems");

    const newState = textOf(msg.SyncState);
    if (!newState) {
      throw new EwsError("SyncFolderItems lieferte keinen SyncState.", { kind: "parse" });
    }
    const changes = (msg.Changes ?? {}) as XmlNode;
    const created = toArr(changes.Create)
      .map((c) => parseItemSummary(itemOfChange(c)))
      .filter((s): s is EwsItemSummary => s !== null);
    const updated = toArr(changes.Update)
      .map((c) => parseItemSummary(itemOfChange(c)))
      .filter((s): s is EwsItemSummary => s !== null);
    const deletedItemIds = toArr(changes.Delete)
      .map((d) => attrOf((d as XmlNode).ItemId, "Id"))
      .filter((id): id is string => id !== null);
    const readFlagChanges = toArr(changes.ReadFlagChange)
      .map((r) => ({
        itemId: attrOf((r as XmlNode).ItemId, "Id"),
        isRead: textOf((r as XmlNode).IsRead) === "true",
      }))
      .filter((r): r is { itemId: string; isRead: boolean } => r.itemId !== null);

    return {
      syncState: newState,
      includesLastItem: textOf(msg.IncludesLastItemInRange) === "true",
      created,
      updated,
      deletedItemIds,
      readFlagChanges,
    };
  }

  /** Holt den vollständigen MIME-Inhalt einer Nachricht. */
  async getItemMime(itemId: string, opts?: { maxBytes?: number }): Promise<Buffer> {
    const inner =
      `<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape>` +
      `<t:IncludeMimeContent>true</t:IncludeMimeContent></m:ItemShape>` +
      `<m:ItemIds><t:ItemId Id="${escapeXml(itemId)}"/></m:ItemIds></m:GetItem>`;
    const bodyNode = await this.soap(inner, { maxBytes: opts?.maxBytes });
    const msg = this.firstResponseMessage(bodyNode, "GetItem");
    const item = itemOfChange(msg.Items) as XmlNode | null;
    const mimeB64 = textOf(item?.MimeContent);
    if (!mimeB64) {
      throw new EwsError("Nachricht enthält keinen MIME-Inhalt.", { kind: "parse" });
    }
    return Buffer.from(mimeB64, "base64");
  }

  /**
   * Kalender-Einträge im Zeitfenster via FindItem + CalendarView.
   * Wiederkehrende Termine kommen als aufgelöste Einzelvorkommen zurück.
   */
  async findCalendarItems(startIso: string, endIso: string): Promise<EwsCalendarItem[]> {
    const inner =
      `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>` +
      [
        "item:Subject",
        "calendar:Start",
        "calendar:End",
        "calendar:IsAllDayEvent",
        "calendar:Location",
        "calendar:Organizer",
        "calendar:MyResponseType",
        "calendar:UID",
        "calendar:CalendarItemType",
      ]
        .map((f) => `<t:FieldURI FieldURI="${f}"/>`)
        .join("") +
      `</t:AdditionalProperties></m:ItemShape>` +
      `<m:CalendarView MaxEntriesReturned="1000" StartDate="${escapeXml(startIso)}" EndDate="${escapeXml(endIso)}"/>` +
      `<m:ParentFolderIds><t:DistinguishedFolderId Id="calendar"/></m:ParentFolderIds></m:FindItem>`;
    const bodyNode = await this.soap(inner);
    const msg = this.firstResponseMessage(bodyNode, "FindItem");
    const items = toArr(
      ((msg.RootFolder as XmlNode | undefined)?.Items as XmlNode | undefined)?.CalendarItem,
    ) as XmlNode[];
    const result: EwsCalendarItem[] = [];
    for (const item of items) {
      const itemId = attrOf(item.ItemId, "Id");
      if (!itemId) continue;
      result.push({
        itemId,
        changeKey: attrOf(item.ItemId, "ChangeKey"),
        subject: textOf(item.Subject) ?? "",
        start: textOf(item.Start),
        end: textOf(item.End),
        isAllDay: textOf(item.IsAllDayEvent) === "true",
        location: textOf(item.Location),
        organizer: mailboxToAddress((item.Organizer as XmlNode | undefined)?.Mailbox),
        myResponseType: textOf(item.MyResponseType),
        uid: textOf(item.UID),
        calendarItemType: textOf(item.CalendarItemType),
      });
    }
    return result;
  }

  /**
   * Beantwortet eine Termineinladung (Zusage/Absage/Vorbehalt). Exchange
   * aktualisiert den Kalender und benachrichtigt den Organisator selbst.
   */
  async respondToMeeting(
    itemId: string,
    partstat: "ACCEPTED" | "DECLINED" | "TENTATIVE",
    comment?: string,
  ): Promise<void> {
    const element =
      partstat === "ACCEPTED"
        ? "AcceptItem"
        : partstat === "DECLINED"
          ? "DeclineItem"
          : "TentativelyAcceptItem";
    const inner =
      `<m:CreateItem MessageDisposition="SendAndSaveCopy"><m:Items><t:${element}>` +
      (comment ? `<t:Body BodyType="Text">${escapeXml(comment)}</t:Body>` : "") +
      // Ohne ChangeKey: vermeidet Stale-Fehler, Id genügt für Response-Objekte.
      `<t:ReferenceItemId Id="${escapeXml(itemId)}"/>` +
      `</t:${element}></m:Items></m:CreateItem>`;
    const bodyNode = await this.soap(inner);
    this.firstResponseMessage(bodyNode, "CreateItem");
  }

  /**
   * Versendet eine fertige MIME-Nachricht über Exchange (SendItem-Pfad).
   * Exchange legt die Kopie selbst im Gesendet-Ordner ab.
   */
  async sendMailMime(raw: Buffer): Promise<void> {
    const inner =
      `<m:CreateItem MessageDisposition="SendAndSaveCopy">` +
      `<m:SavedItemFolderId><t:DistinguishedFolderId Id="sentitems"/></m:SavedItemFolderId>` +
      `<m:Items><t:Message><t:MimeContent CharacterSet="UTF-8">${raw.toString("base64")}</t:MimeContent></t:Message></m:Items>` +
      `</m:CreateItem>`;
    const bodyNode = await this.soap(inner);
    this.firstResponseMessage(bodyNode, "CreateItem");
  }
}

/** Macht EWS-Fehler lesbar (deutsche Diagnose mit konkreten Hinweisen). */
export function describeEwsError(err: unknown): string {
  if (err instanceof EwsError) {
    const parts: string[] = [err.message];
    switch (err.kind) {
      case "network":
        if (err.code === "ENOTFOUND") {
          parts.push("Host nicht gefunden (Tippfehler im Hostnamen?)");
        } else if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
          parts.push("Server nicht erreichbar (Host, Firewall oder VPN prüfen)");
        } else if (err.code?.startsWith("ERR_TLS") || err.code === "CERT_HAS_EXPIRED" || err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || err.code === "SELF_SIGNED_CERT_IN_CHAIN" || err.code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
          parts.push("TLS-Zertifikat wird nicht akzeptiert (internes/abgelaufenes Zertifikat?)");
        }
        break;
      case "auth":
        if (err.schemes && err.schemes.length > 0) {
          parts.push(`Angebotene Verfahren: ${err.schemes.join(", ")}`);
        }
        parts.push(
          "Hinweise: Benutzername ggf. als Kurzform (klang), DOMÄNE\\benutzer oder benutzer@domäne probieren; Domänen-Feld setzen; Passwort prüfen",
        );
        break;
      case "soap":
        if (err.responseCode === "ErrorAccessDenied") {
          parts.push("Zugriff verweigert — EWS ist für dieses Konto evtl. gesperrt (EwsEnabled=false)");
        }
        break;
      default:
        break;
    }
    return parts.join(" — ");
  }
  const e = err as NodeJS.ErrnoException;
  if (e?.code === "ENOTFOUND") return `${e.message} — Host nicht gefunden (Tippfehler im Hostnamen?)`;
  return e?.message ?? "Unbekannter Fehler";
}

const TEST_TIMEOUT_MS = 45_000;

/**
 * Mehrstufiger Verbindungstest mit lesbarer Diagnose:
 * Endpunkt → Erreichbarkeit + angebotene Auth-Verfahren → Login → Postfach.
 */
export async function testEwsConnection(
  cfg: EwsConnectionInput,
): Promise<{ ok: boolean; message: string }> {
  const lines: string[] = [];

  let normalized: string;
  try {
    normalized = normalizeEwsUrl(cfg.ewsUrl);
  } catch (err) {
    return {
      ok: false,
      message: `EWS-URL ungültig: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  lines.push(`Endpunkt: ${normalized}`);

  const client = new EwsClient(cfg);
  const run = async (): Promise<{ ok: boolean; message: string }> => {
    try {
      const probe = await client.probe();
      lines.push(
        probe.schemes.length > 0
          ? `Server erreichbar ✓ — angebotene Anmeldeverfahren: ${probe.schemes.join(", ")}`
          : `Server erreichbar ✓ (HTTP ${probe.status}, keine Anmeldung verlangt)`,
      );
      const folders = await client.getWellKnownFolders();
      lines.push(`Anmeldung (${client.authDescription()}): erfolgreich ✓`);
      const inbox = folders.find((f) => f.wellKnown === "inbox");
      if (inbox) {
        lines.push(
          `Postfach-Zugriff: „${inbox.displayName}" — ${inbox.unreadCount ?? "?"} ungelesen von ${inbox.totalCount ?? "?"} E-Mails ✓`,
        );
      } else {
        lines.push("Warnung: Posteingang wurde nicht gefunden.");
      }
      return { ok: true, message: lines.join("\n") };
    } catch (err) {
      lines.push(`FEHLER: ${describeEwsError(err)}`);
      return { ok: false, message: lines.join("\n") };
    }
  };

  const timeout = new Promise<{ ok: boolean; message: string }>((resolve) =>
    setTimeout(() => {
      lines.push(
        "FEHLER: Zeitüberschreitung beim Verbindungstest — der Server antwortet nicht rechtzeitig (Firewall/VPN prüfen).",
      );
      resolve({ ok: false, message: lines.join("\n") });
    }, TEST_TIMEOUT_MS),
  );

  try {
    return await Promise.race([run(), timeout]);
  } finally {
    client.close();
  }
}
