import { requireUserId } from "@/lib/api-auth";
import {
  contactDocLinks,
  contacts,
  dataSources,
  db,
  webdavStores,
} from "@agent-team/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)));
  if (!contact) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = z
    .object({
      storeId: z.string().uuid(),
      path: z.string().min(1),
      includeChildren: z.boolean().default(false),
    })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  const [store] = await db
    .select({ id: webdavStores.id })
    .from(webdavStores)
    .innerJoin(dataSources, eq(webdavStores.dataSourceId, dataSources.id))
    .where(and(eq(webdavStores.id, parsed.data.storeId), eq(dataSources.userId, userId)));
  if (!store) {
    return NextResponse.json({ error: "Speicher nicht gefunden" }, { status: 404 });
  }

  const [link] = await db
    .insert(contactDocLinks)
    .values({
      contactId: contact.id,
      storeId: parsed.data.storeId,
      path: parsed.data.path,
      includeChildren: parsed.data.includeChildren,
    })
    .returning();

  return NextResponse.json(link, { status: 201 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)));
  if (!contact) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const url = new URL(req.url);
  const linkId = url.searchParams.get("linkId");
  if (!linkId) return NextResponse.json({ error: "linkId fehlt" }, { status: 400 });

  await db
    .delete(contactDocLinks)
    .where(and(eq(contactDocLinks.id, linkId), eq(contactDocLinks.contactId, contact.id)));
  return NextResponse.json({ ok: true });
}
