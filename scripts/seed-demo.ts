/**
 * Legt Demo-Daten an (Mail-Konto, Kalender, Nachrichten, Termine), um die UI
 * ohne echte Konten zu testen. NUR für Entwicklung gedacht.
 *
 *   pnpm seed:demo
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

const {
  db,
  user,
  dataSources,
  mailAccounts,
  mailFolders,
  mailMessages,
  mailMessageBodies,
  caldavAccounts,
  calendars,
  calendarEvents,
} = await import("@agent-team/db");
const { encryptSecret } = await import("@agent-team/core");
const { eq } = await import("drizzle-orm");

const [firstUser] = await db.select().from(user).limit(1);
if (!firstUser) {
  console.error("Kein Nutzer vorhanden — erst pnpm seed:user ausführen.");
  process.exit(1);
}
const userId = firstUser.id;

const existing = await db
  .select()
  .from(dataSources)
  .where(eq(dataSources.name, "Demo Postfach"));
if (existing.length > 0) {
  console.log("Demo-Daten existieren bereits — nichts zu tun.");
  process.exit(0);
}

// ---- Mail-Konto ----
const [mailSource] = await db
  .insert(dataSources)
  .values({
    userId,
    type: "email",
    name: "Demo Postfach",
    color: "#3b82f6",
    enabled: false, // kein echter Sync
    baselineCompletedAt: new Date(),
  })
  .returning();

const [account] = await db
  .insert(mailAccounts)
  .values({
    dataSourceId: mailSource!.id,
    imapHost: "imap.example.com",
    imapUser: "demo@example.com",
    imapPasswordEnc: encryptSecret("demo"),
    smtpHost: "smtp.example.com",
    smtpUser: "demo@example.com",
    smtpPasswordEnc: encryptSecret("demo"),
    fromAddress: "demo@example.com",
    fromName: "Demo Nutzer",
  })
  .returning();

const [inbox] = await db
  .insert(mailFolders)
  .values({
    userId,
    accountId: account!.id,
    path: "INBOX",
    displayName: "Eingang",
    role: "inbox",
    syncEnabled: true,
  })
  .returning();
await db.insert(mailFolders).values({
  userId,
  accountId: account!.id,
  path: "Sent",
  displayName: "Gesendet",
  role: "sent",
  syncEnabled: true,
});

const now = Date.now();
const demoMails = [
  {
    subject: "Projektupdate Alpha — Meilenstein erreicht",
    fromName: "Anna Weber",
    fromEmail: "anna.weber@beispiel-gmbh.de",
    hoursAgo: 2,
    seen: false,
    text: "Hallo Christian,\n\nkurzes Update: Wir haben den Meilenstein M2 erreicht. Das Team ist im Plan, die Abnahme kann wie besprochen nächste Woche stattfinden.\n\nKannst du den Termin am Donnerstag bestätigen?\n\nViele Grüße\nAnna",
    html: `<p>Hallo Christian,</p><p>kurzes Update: Wir haben den <b>Meilenstein M2</b> erreicht. Das Team ist im Plan, die Abnahme kann wie besprochen nächste Woche stattfinden.</p><p>Kannst du den Termin am Donnerstag bestätigen?</p><p>Viele Grüße<br>Anna</p>`,
  },
  {
    subject: "Rechnung 2026-0713 — Hosting Juli",
    fromName: "Billing Team",
    fromEmail: "billing@cloudhost.example",
    hoursAgo: 6,
    seen: false,
    text: "Sehr geehrter Kunde,\n\nanbei finden Sie die Rechnung für Juli 2026 über 49,00 EUR.\n\nMit freundlichen Grüßen\nIhr Billing Team",
    html: null,
  },
  {
    subject: "Re: Angebot Website-Relaunch",
    fromName: "Max Schulte",
    fromEmail: "m.schulte@agentur-nord.de",
    hoursAgo: 26,
    seen: true,
    text: "Hi Christian,\n\ndanke für dein Angebot! Zwei Rückfragen:\n1. Ist das CMS im Preis enthalten?\n2. Wie lange dauert die Umsetzung?\n\nBeste Grüße\nMax",
    html: null,
  },
  {
    subject: "Einladung: Strategie-Workshop Q3",
    fromName: "Lisa Brandt",
    fromEmail: "lisa@xplrs.net",
    hoursAgo: 50,
    seen: true,
    text: "Hallo zusammen,\n\nich lade euch zum Q3-Strategie-Workshop ein. Agenda folgt.\n\nLisa",
    html: null,
  },
  {
    subject: "Newsletter: KI-Trends im Juli",
    fromName: "Tech Weekly",
    fromEmail: "newsletter@techweekly.example",
    hoursAgo: 75,
    seen: true,
    text: "Die wichtigsten KI-Trends im Juli 2026: Agenten-Plattformen, lokale Modelle und mehr.",
    html: `<h1 style="font-size:18px">KI-Trends im Juli</h1><p>Die wichtigsten Themen: <a href="https://example.com">Agenten-Plattformen</a>, lokale Modelle und mehr.</p><img src="https://example.com/tracking.gif" alt="" width="1" height="1">`,
  },
];

let uid = 1;
for (const mail of demoMails) {
  const [row] = await db
    .insert(mailMessages)
    .values({
      userId,
      accountId: account!.id,
      folderId: inbox!.id,
      uid: uid++,
      subject: mail.subject,
      fromName: mail.fromName,
      fromEmail: mail.fromEmail,
      toAddrs: [{ name: "Demo Nutzer", address: "demo@example.com" }],
      sentAt: new Date(now - mail.hoursAgo * 3600_000),
      seen: mail.seen,
      snippet: mail.text.replace(/\s+/g, " ").slice(0, 200),
      hasAttachments: false,
    })
    .returning();
  await db.insert(mailMessageBodies).values({
    messageId: row!.id,
    textBody: mail.text,
    htmlSanitized: mail.html,
  });
}

// ---- Kalender ----
const [calSource] = await db
  .insert(dataSources)
  .values({
    userId,
    type: "caldav",
    name: "Demo Kalender",
    color: "#22c55e",
    enabled: false,
    baselineCompletedAt: new Date(),
  })
  .returning();

const [calAccount] = await db
  .insert(caldavAccounts)
  .values({
    dataSourceId: calSource!.id,
    serverUrl: "https://caldav.example.com",
    username: "demo@example.com",
    passwordEnc: encryptSecret("demo"),
  })
  .returning();

const [calendar] = await db
  .insert(calendars)
  .values({
    userId,
    accountId: calAccount!.id,
    caldavUrl: "https://caldav.example.com/cal/privat",
    displayName: "Privat",
    color: "#22c55e",
  })
  .returning();
const [workCal] = await db
  .insert(calendars)
  .values({
    userId,
    accountId: calAccount!.id,
    caldavUrl: "https://caldav.example.com/cal/arbeit",
    displayName: "Arbeit",
    color: "#f97316",
  })
  .returning();

const day = 86400_000;
const at = (offsetDays: number, hour: number) => {
  const d = new Date(now + offsetDays * day);
  d.setHours(hour, 0, 0, 0);
  return d;
};

const demoEvents = [
  { cal: workCal!, summary: "Abnahme Projekt Alpha", offset: 3, hour: 10, durH: 1, location: "Zoom", attendees: [{ email: "anna.weber@beispiel-gmbh.de", name: "Anna Weber", partstat: "ACCEPTED" }, { email: "demo@example.com", name: "Demo Nutzer", partstat: "NEEDS-ACTION", self: true }] },
  { cal: workCal!, summary: "Strategie-Workshop Q3", offset: 7, hour: 9, durH: 6, location: "Büro Hamburg", attendees: [] },
  { cal: calendar!, summary: "Zahnarzt", offset: 1, hour: 8, durH: 1, location: null, attendees: [] },
  { cal: calendar!, summary: "Laufen mit Jonas", offset: 0, hour: 18, durH: 1, location: "Stadtpark", attendees: [] },
];

for (const [i, ev] of demoEvents.entries()) {
  await db.insert(calendarEvents).values({
    userId,
    calendarId: ev.cal.id,
    objectUrl: `https://caldav.example.com/obj/demo-${i}.ics`,
    icalUid: `demo-${i}@agent-team`,
    summary: ev.summary,
    location: ev.location,
    startsAt: at(ev.offset, ev.hour),
    endsAt: at(ev.offset, ev.hour + ev.durH),
    attendees: ev.attendees,
    organizer: ev.attendees[0] ? { email: ev.attendees[0].email, name: ev.attendees[0].name } : null,
  });
}

// Wöchentlicher Jour fixe (wiederkehrend)
await db.insert(calendarEvents).values({
  userId,
  calendarId: workCal!.id,
  objectUrl: "https://caldav.example.com/obj/jourfixe.ics",
  icalUid: "jourfixe@agent-team",
  summary: "Jour fixe Team",
  startsAt: at(-7, 11),
  endsAt: at(-7, 12),
  rrule: "FREQ=WEEKLY;BYDAY=MO",
});

console.log("Demo-Daten angelegt: 1 Postfach (5 Mails), 2 Kalender (5 Termine).");
process.exit(0);
