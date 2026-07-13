import nodemailer from "nodemailer";
import type { MailAccountConfig } from "../sources";

export function createSmtpTransport(cfg: MailAccountConfig) {
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPassword },
  });
}

export async function testSmtpConnection(cfg: MailAccountConfig): Promise<void> {
  const transport = createSmtpTransport(cfg);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}
