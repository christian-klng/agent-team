import {
  describeImapError,
  describeSmtpError,
  testImapConnection,
  testSmtpConnection,
  type MailAccountConfig,
} from "@agent-team/core";

/** IMAP und SMTP getrennt testen, damit die Fehlerquelle erkennbar ist. */
export async function testMailLegs(
  cfg: MailAccountConfig,
): Promise<{ ok: boolean; message: string }> {
  const legs: string[] = [];
  let ok = true;
  try {
    await testImapConnection(cfg);
    legs.push("IMAP (Empfang): Login erfolgreich ✓");
  } catch (err) {
    ok = false;
    legs.push(`IMAP (Empfang) FEHLER: ${describeImapError(err)}`);
  }
  try {
    await testSmtpConnection(cfg);
    legs.push("SMTP (Versand): Login erfolgreich ✓");
  } catch (err) {
    ok = false;
    legs.push(`SMTP (Versand) FEHLER: ${describeSmtpError(err)}`);
  }
  return { ok, message: legs.join("\n") };
}
