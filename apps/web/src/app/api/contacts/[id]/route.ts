import { requireUserId } from "@/lib/api-auth";
import {
  contactDocLinks,
  contactEmails,
  contacts,
  db,
  mailMessages,
} from "@agent-team/db";
import { pastEmployerSchema } from "@agent-team/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const updateSchema = z.object({
  displayName: z.string().min(1).optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  currentEmployer: z.string().nullable().optional(),
  pastEmployers: z.array(pastEmployerSchema).optional(),
  notes: z.string().nullable().optional(),
  emails: z
    .array(
      z.object({
        email: z.string().email(),
        label: z.string().optional(),
        isPrimary: z.boolean().default(false),
      }),
    )
    .optional(),
});

async function getOwned(id: string, userId: string) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)));
  return contact;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const contact = await getOwned(id, userId);
  if (!contact) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const emails = await db
    .select()
    .from(contactEmails)
    .where(eq(contactEmails.contactId, contact.id));
  const docLinks = await db
    .select()
    .from(contactDocLinks)
    .where(eq(contactDocLinks.contactId, contact.id));

  const emailAddresses = emails.map((e) => e.email);
  const recentMails =
    emailAddresses.length > 0
      ? await db
          .select({
            id: mailMessages.id,
            subject: mailMessages.subject,
            sentAt: mailMessages.sentAt,
            fromEmail: mailMessages.fromEmail,
            snippet: mailMessages.snippet,
          })
          .from(mailMessages)
          .where(
            and(
              eq(mailMessages.userId, userId),
              inArray(mailMessages.fromEmail, emailAddresses),
            ),
          )
          .orderBy(desc(mailMessages.sentAt))
          .limit(10)
      : [];

  return NextResponse.json({ ...contact, emails, docLinks, recentMails });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const contact = await getOwned(id, userId);
  if (!contact) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  await db
    .update(contacts)
    .set({
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.currentEmployer !== undefined
        ? { currentEmployer: input.currentEmployer }
        : {}),
      ...(input.pastEmployers !== undefined
        ? { pastEmployers: input.pastEmployers }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, contact.id));

  if (input.emails !== undefined) {
    await db.delete(contactEmails).where(eq(contactEmails.contactId, contact.id));
    for (const email of input.emails) {
      await db
        .insert(contactEmails)
        .values({
          userId,
          contactId: contact.id,
          email: email.email.toLowerCase(),
          label: email.label ?? null,
          isPrimary: email.isPrimary,
        })
        .onConflictDoUpdate({
          target: [contactEmails.userId, contactEmails.email],
          set: { contactId: contact.id },
        });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const contact = await getOwned(id, userId);
  if (!contact) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.delete(contacts).where(eq(contacts.id, contact.id));
  return NextResponse.json({ ok: true });
}
