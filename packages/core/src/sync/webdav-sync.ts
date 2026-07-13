import { db, documentFiles } from "@agent-team/db";
import { and, eq, isNull } from "drizzle-orm";
import type { FileStat } from "webdav";
import { createWebdavClient, normalizeWebdavPath } from "../connectors/webdav";
import type { SourceRow, WebdavStoreConfig } from "../sources";
import type { DetectedChange } from "./types";

const MAX_ENTRIES = 5000;
const MAX_DEPTH = 8;

async function listRecursive(
  client: ReturnType<typeof createWebdavClient>,
  rootPath: string,
): Promise<Map<string, FileStat>> {
  const result = new Map<string, FileStat>();
  const queue: { path: string; depth: number }[] = [{ path: rootPath, depth: 0 }];

  while (queue.length > 0 && result.size < MAX_ENTRIES) {
    const { path, depth } = queue.shift()!;
    let entries: FileStat[];
    try {
      entries = (await client.getDirectoryContents(path)) as FileStat[];
    } catch (err) {
      console.warn(`[sync:webdav] Verzeichnis ${path} nicht lesbar:`, err);
      continue;
    }
    for (const entry of entries) {
      const p = normalizeWebdavPath(entry.filename);
      if (result.has(p)) continue;
      result.set(p, entry);
      if (entry.type === "directory" && depth < MAX_DEPTH) {
        queue.push({ path: p, depth: depth + 1 });
      }
    }
  }
  if (result.size >= MAX_ENTRIES) {
    console.warn(`[sync:webdav] Cap von ${MAX_ENTRIES} Einträgen erreicht — Rest wird ignoriert.`);
  }
  return result;
}

export async function syncWebdavSource(
  cfg: WebdavStoreConfig,
  source: SourceRow,
): Promise<DetectedChange[]> {
  const changes: DetectedChange[] = [];
  const client = createWebdavClient(cfg);
  const root = normalizeWebdavPath(cfg.rootPath);
  const remote = await listRecursive(client, root);

  const existing = await db
    .select({
      id: documentFiles.id,
      path: documentFiles.path,
      etag: documentFiles.etag,
      modifiedAt: documentFiles.modifiedAt,
    })
    .from(documentFiles)
    .where(and(eq(documentFiles.storeId, cfg.storeId), isNull(documentFiles.deletedAt)));
  const existingByPath = new Map(existing.map((e) => [e.path, e]));

  for (const [path, stat] of remote) {
    const isDir = stat.type === "directory";
    const etag = stat.etag ?? null;
    const modifiedAt = stat.lastmod ? new Date(stat.lastmod) : null;
    const prev = existingByPath.get(path);

    if (!prev) {
      const [row] = await db
        .insert(documentFiles)
        .values({
          userId: source.userId,
          storeId: cfg.storeId,
          path,
          name: stat.basename,
          isDir,
          etag,
          size: stat.size ?? null,
          mime: stat.mime ?? null,
          modifiedAt,
        })
        .onConflictDoUpdate({
          target: [documentFiles.storeId, documentFiles.path],
          set: {
            etag,
            size: stat.size ?? null,
            mime: stat.mime ?? null,
            modifiedAt,
            deletedAt: null,
            updatedAt: new Date(),
          },
        })
        .returning({ id: documentFiles.id });
      if (row && !isDir) {
        changes.push({
          kind: "file.new",
          externalRef: row.id,
          dedupKey: `doc:${cfg.storeId}:${path}:${etag ?? modifiedAt?.getTime() ?? "new"}`,
          payload: { fileId: row.id, storeId: cfg.storeId, path, name: stat.basename, mime: stat.mime ?? null },
        });
      }
    } else {
      const changed =
        (etag !== null && prev.etag !== etag) ||
        (etag === null &&
          modifiedAt !== null &&
          prev.modifiedAt?.getTime() !== modifiedAt.getTime());
      if (changed) {
        await db
          .update(documentFiles)
          .set({
            etag,
            size: stat.size ?? null,
            mime: stat.mime ?? null,
            modifiedAt,
            updatedAt: new Date(),
          })
          .where(eq(documentFiles.id, prev.id));
        if (!isDir) {
          changes.push({
            kind: "file.updated",
            externalRef: prev.id,
            dedupKey: `doc:${cfg.storeId}:${path}:${etag ?? modifiedAt?.getTime() ?? "upd"}`,
            payload: { fileId: prev.id, storeId: cfg.storeId, path, name: stat.basename, mime: stat.mime ?? null },
          });
        }
      }
    }
  }

  // Verschwundene Pfade als gelöscht markieren.
  for (const e of existing) {
    if (!remote.has(e.path)) {
      await db
        .update(documentFiles)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(documentFiles.id, e.id));
    }
  }

  return changes;
}
