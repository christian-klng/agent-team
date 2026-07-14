import {
  describeImapError,
  describeSmtpError,
  testImapConnection,
  testSmtpConnection,
  type MailAccountConfig,
} from "@agent-team/core";

const LEG_TIMEOUT_MS = 25_000;

function withTimeout(promise: Promise<void>): Promise<void> {
  return Promise.race([
    promise,
    new Promise<void>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "Zeitüberschreitung — der Server antwortet auf diesem Port nicht. Typische Ursachen: gefilterter Port (z. B. 25) oder SSL/STARTTLS-Mismatch (465 = SSL, 587 = STARTTLS).",
            ),
          ),
        LEG_TIMEOUT_MS,
      ),
    ),
  ]);
}

/** IMAP und SMTP getrennt testen, damit die Fehlerquelle erkennbar ist. */
export async function testMailLegs(
  cfg: MailAccountConfig,
): Promise<{ ok: boolean; message: string }> {
  const legs: string[] = [];
  let ok = true;
  try {
    await withTimeout(testImapConnection(cfg));
    legs.push("IMAP (Empfang): Login erfolgreich ✓");
  } catch (err) {
    ok = false;
    legs.push(`IMAP (Empfang) FEHLER: ${describeImapError(err)}`);
  }
  try {
    await withTimeout(testSmtpConnection(cfg));
    legs.push("SMTP (Versand): Login erfolgreich ✓");
  } catch (err) {
    ok = false;
    legs.push(`SMTP (Versand) FEHLER: ${describeSmtpError(err)}`);
  }
  return { ok, message: legs.join("\n") };
}
