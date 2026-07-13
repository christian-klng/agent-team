import { createClient, type WebDAVClient } from "webdav";
import type { WebdavStoreConfig } from "../sources";

export function createWebdavClient(cfg: WebdavStoreConfig): WebDAVClient {
  return createClient(cfg.baseUrl, {
    username: cfg.username,
    password: cfg.password,
  });
}

/** Normalisiert einen Pfad relativ zum Root ("/" bleibt "/"). */
export function normalizeWebdavPath(p: string): string {
  let out = p.trim();
  if (!out.startsWith("/")) out = `/${out}`;
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

/** Verhindert Zugriffe außerhalb des konfigurierten Root-Pfads. */
export function assertInsideRoot(rootPath: string, path: string): void {
  const root = normalizeWebdavPath(rootPath);
  const target = normalizeWebdavPath(path);
  if (root === "/") return;
  if (target !== root && !target.startsWith(`${root}/`)) {
    throw new Error(`Pfad ${target} liegt außerhalb des erlaubten Bereichs ${root}`);
  }
}

/** Verbindungstest: Root-Verzeichnis lesen. Wirft bei Fehler. */
export async function testWebdavConnection(cfg: WebdavStoreConfig): Promise<number> {
  const client = createWebdavClient(cfg);
  const contents = await client.getDirectoryContents(
    normalizeWebdavPath(cfg.rootPath),
  );
  return Array.isArray(contents) ? contents.length : 0;
}
