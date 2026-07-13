/**
 * Läuft einmal beim Serverstart (Next.js Instrumentation).
 * Legt den Erst-Nutzer aus SEED_USER_EMAIL/SEED_USER_PASSWORD an, falls noch
 * kein Nutzer existiert — damit funktioniert das Onboarding auf Coolify ohne
 * manuelles Seed-Script. Wartet ggf. auf die Migrationen des Workers.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) return;
  if (password.length < 8) {
    console.warn("[web] SEED_USER_PASSWORD hat weniger als 8 Zeichen — Seed übersprungen.");
    return;
  }

  // Bewusst nicht awaiten: der Serverstart soll nicht auf die DB warten.
  void seedFirstUser(email, password).catch((err) =>
    console.error("[web] Erst-Nutzer-Seed fehlgeschlagen:", err),
  );
}

async function seedFirstUser(email: string, password: string): Promise<void> {
  const MAX_ATTEMPTS = 12;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { db, user } = await import("@agent-team/db");
      const existing = await db.select({ id: user.id }).from(user).limit(1);
      if (existing.length > 0) return; // es gibt schon einen Nutzer — nichts zu tun

      const { betterAuth } = await import("better-auth");
      const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
      const schema = await import("@agent-team/db/schema");
      const auth = betterAuth({
        database: drizzleAdapter(db, { provider: "pg", schema }),
        secret: process.env.BETTER_AUTH_SECRET,
        baseURL: process.env.BETTER_AUTH_URL,
        emailAndPassword: { enabled: true },
      });
      await auth.api.signUpEmail({
        body: { email, password, name: process.env.SEED_USER_NAME ?? "Admin" },
      });
      console.log(`[web] Erst-Nutzer ${email} angelegt (aus SEED_USER_*).`);
      return;
    } catch (err) {
      // Beim allerersten Deploy laufen die Migrationen im Worker evtl. noch.
      if (attempt === MAX_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}
