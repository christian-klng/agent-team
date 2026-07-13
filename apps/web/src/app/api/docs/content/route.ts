import { requireUserId } from "@/lib/api-auth";
import {
  assertInsideRoot,
  createWebdavClient,
  getWebdavStoreConfigById,
} from "@agent-team/core";
import { db, documentFiles, webdavStores, dataSources } from "@agent-team/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const MAX_PREVIEW_BYTES = 500 * 1024;
const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/xml"];

function isTextLike(mime: string | null, name: string): boolean {
  if (mime && TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  return /\.(md|txt|csv|json|xml|yaml|yml|log|ini|conf)$/i.test(name);
}

/** Live-Inhalt einer Datei via WebDAV (nur Text-Formate, für die Vorschau). */
export async function GET(req: Request) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const url = new URL(req.url);
  const storeId = url.searchParams.get("storeId");
  const path = url.searchParams.get("path");
  if (!storeId || !path) {
    return NextResponse.json({ error: "storeId/path fehlt" }, { status: 400 });
  }

  // Ownership prüfen.
  const [store] = await db
    .select({ id: webdavStores.id })
    .from(webdavStores)
    .innerJoin(dataSources, eq(webdavStores.dataSourceId, dataSources.id))
    .where(and(eq(webdavStores.id, storeId), eq(dataSources.userId, userId)));
  if (!store) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const [file] = await db
    .select()
    .from(documentFiles)
    .where(and(eq(documentFiles.storeId, storeId), eq(documentFiles.path, path)));
  if (!file || file.isDir) {
    return NextResponse.json({ error: "Datei nicht gefunden" }, { status: 404 });
  }
  if (!isTextLike(file.mime, file.name)) {
    return NextResponse.json(
      { error: "Vorschau nur für Text-Formate verfügbar" },
      { status: 415 },
    );
  }
  if (file.size && file.size > MAX_PREVIEW_BYTES) {
    return NextResponse.json({ error: "Datei zu groß für Vorschau" }, { status: 413 });
  }

  const cfg = await getWebdavStoreConfigById(storeId);
  assertInsideRoot(cfg.rootPath, path);
  const client = createWebdavClient(cfg);
  const content = (await client.getFileContents(path, { format: "text" })) as string;

  return NextResponse.json({
    path,
    name: file.name,
    mime: file.mime,
    etag: file.etag,
    content: content.slice(0, MAX_PREVIEW_BYTES),
  });
}
