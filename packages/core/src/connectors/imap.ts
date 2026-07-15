import { ImapFlow } from "imapflow";
import type { ImapMailAccountConfig } from "../sources";

export function createImapClient(cfg: ImapMailAccountConfig): ImapFlow {
  const client = new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure: cfg.imapTls,
    auth: { user: cfg.imapUser, pass: cfg.imapPassword },
    logger: false,
    // Zügig scheitern statt hängen (gefilterte Ports, TLS-Mismatch).
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  });
  // ImapFlow meldet Socket-Fehler (z. B. Timeout) zusätzlich als 'error'-Event.
  // Ohne Listener tötet Node den Prozess ("Unhandled 'error' event") — die
  // laufenden Befehle sehen den Fehler ohnehin als abgelehnte Promises.
  client.on("error", (err: Error) => {
    console.warn(`[imap] Verbindungsfehler ${cfg.imapHost}: ${err.message}`);
  });
  return client;
}

/** Verbindungstest: Login + Mailbox-Liste. Wirft bei Fehler. */
export async function testImapConnection(cfg: ImapMailAccountConfig): Promise<void> {
  const client = createImapClient(cfg);
  try {
    await client.connect();
    await client.list();
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Macht imapflow-Fehler lesbar: "Command failed." allein sagt nichts —
 * die eigentliche Server-Antwort steckt in responseText/serverResponseCode.
 */
export function describeImapError(err: unknown): string {
  const e = err as {
    message?: string;
    responseText?: string;
    serverResponseCode?: string;
    authenticationFailed?: boolean;
    code?: string;
  };
  const parts: string[] = [];
  if (e.authenticationFailed) parts.push("Login abgelehnt");
  if (e.responseText) parts.push(`Server-Antwort: „${e.responseText}"`);
  else if (e.message && e.message !== "Command failed.") parts.push(e.message);
  if (e.serverResponseCode) parts.push(`Code: ${e.serverResponseCode}`);
  if (e.code === "ENOTFOUND") parts.push("Host nicht gefunden (Tippfehler im Hostnamen?)");
  if (e.code === "ETIMEDOUT" || e.code === "ECONNREFUSED") {
    parts.push("Server nicht erreichbar (Host/Port/Firewall prüfen)");
  }
  return parts.length > 0 ? parts.join(" — ") : (e.message ?? "Unbekannter Fehler");
}
