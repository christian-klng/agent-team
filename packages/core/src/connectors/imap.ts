import { ImapFlow } from "imapflow";
import type { MailAccountConfig } from "../sources";

export function createImapClient(cfg: MailAccountConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure: cfg.imapTls,
    auth: { user: cfg.imapUser, pass: cfg.imapPassword },
    logger: false,
    // Verbindungsaufbau soll in einem 5-Minuten-Sync nicht ewig hängen.
    socketTimeout: 60_000,
  });
}

/** Verbindungstest: Login + Mailbox-Liste. Wirft bei Fehler. */
export async function testImapConnection(cfg: MailAccountConfig): Promise<void> {
  const client = createImapClient(cfg);
  try {
    await client.connect();
    await client.list();
  } finally {
    await client.logout().catch(() => {});
  }
}
