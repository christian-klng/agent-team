import nodemailer from "nodemailer";
import type { ImapMailAccountConfig } from "../sources";

export function createSmtpTransport(cfg: ImapMailAccountConfig) {
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    // Auf 587 STARTTLS erzwingen — sonst lehnen viele Server AUTH ab.
    ...(cfg.smtpPort === 587 ? { requireTLS: true } : {}),
    auth: { user: cfg.smtpUser, pass: cfg.smtpPassword },
    // Zügig scheitern statt hängen (gefilterte Ports, TLS-Mismatch).
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  });
}

export async function testSmtpConnection(cfg: ImapMailAccountConfig): Promise<void> {
  const transport = createSmtpTransport(cfg);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

/** Macht nodemailer-Fehler lesbar (volle Server-Antwort + Hinweise). */
export function describeSmtpError(err: unknown): string {
  const e = err as {
    message?: string;
    response?: string;
    responseCode?: number;
    code?: string;
  };
  const parts: string[] = [];
  if (e.response) parts.push(`Server-Antwort: „${e.response}"`);
  else if (e.message) parts.push(e.message);
  if (e.code === "EAUTH") {
    parts.push(
      "Hinweise: Benutzername ist oft die VOLLE E-Mail-Adresse; viele Anbieter verlangen ein App-Passwort; manche Server akzeptieren Logins nur auf Port 587 (STARTTLS) statt 465",
    );
  }
  if (e.code === "ENOTFOUND") parts.push("Host nicht gefunden (Tippfehler im Hostnamen?)");
  if (e.code === "ETIMEDOUT" || e.code === "ECONNECTION") {
    parts.push("Server nicht erreichbar — Port prüfen (465 = SSL, 587 = STARTTLS)");
  }
  return parts.length > 0 ? parts.join(" — ") : "Unbekannter Fehler";
}
