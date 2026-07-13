import { requireUserId } from "@/lib/api-auth";
import { contactEmails, contacts, db } from "@agent-team/db";
import { pastEmployerSchema } from "@agent-team/shared";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const contactInputSchema = z.object({
  displayName: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  currentEmployer: z.string().optional(),
  pastEmployers: z.array(pastEmployerSchema).default([]),
  notes: z.string().optional(),
  emails: z
    .array(
      z.object({
        email: z.string().email(),
        label: z.string().optional(),
        isPrimary: z.boolean().default(false),
      }),
    )
    .default([]),
});

export async function GET() {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId))
    .orderBy(asc(contacts.displayName));
  const emails = await db
    .select()
    .from(contactEmails)
    .where(eq(contactEmails.userId, userId));
  const emailsByContact = new Map<string, typeof emails>();
  for (const e of emails) {
    const list = emailsByContact.get(e.contactId) ?? [];
    list.push(e);
    emailsByContact.set(e.contactId, list);
  }

  return NextResponse.json(
    rows.map((c) => ({ ...c, emails: emailsByContact.get(c.id) ?? [] })),
  );
}

export async function POST(req: Request) {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const body = await req.json().catch(() => null);
  const parsed = contactInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const [contact] = await db
    .insert(contacts)
    .values({
      userId,
      displayName: input.displayName,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      phone: input.phone ?? null,
      currentEmployer: input.currentEmployer ?? null,
      pastEmployers: input.pastEmployers,
      notes: input.notes ?? null,
    })
    .returning();
  if (!contact) {
    return NextResponse.json({ error: "Anlegen fehlgeschlagen" }, { status: 500 });
  }

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

  return NextResponse.json(contact, { status: 201 });
}
