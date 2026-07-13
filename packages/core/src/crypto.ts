import crypto from "node:crypto";

/**
 * AES-256-GCM für Zugangsdaten der Datenquellen. Schlüssel kommt aus
 * APP_ENCRYPTION_KEY (64 Hex-Zeichen = 32 Bytes). Format des Ciphertexts:
 * `v1:<iv>:<authTag>:<ciphertext>` (jeweils base64).
 */
function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY ist nicht gesetzt");
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY muss 64 Hex-Zeichen (32 Bytes) sein");
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(encoded: string): string {
  const [version, ivB64, tagB64, ctB64] = encoded.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Unbekanntes Secret-Format");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
