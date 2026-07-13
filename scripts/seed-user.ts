/**
 * Legt den (einzigen) Nutzer an. Die App selbst hat Registrierung deaktiviert —
 * dieses Script nutzt eine better-auth-Instanz MIT aktivierter Registrierung,
 * gleiche DB, gleiches Secret.
 *
 *   SEED_USER_EMAIL=... SEED_USER_PASSWORD=... pnpm seed:user
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

const { db, user } = await import("@agent-team/db");
const { betterAuth } = await import("better-auth");
const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
const schema = await import("@agent-team/db/schema");
const { eq } = await import("drizzle-orm");

const email = process.env.SEED_USER_EMAIL;
const password = process.env.SEED_USER_PASSWORD;
const name = process.env.SEED_USER_NAME ?? "Admin";

if (!email || !password) {
  console.error("SEED_USER_EMAIL und SEED_USER_PASSWORD müssen gesetzt sein.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("SEED_USER_PASSWORD muss mindestens 8 Zeichen haben.");
  process.exit(1);
}

const existing = await db.select().from(user).where(eq(user.email, email));
if (existing.length > 0) {
  console.log(`Nutzer ${email} existiert bereits — nichts zu tun.`);
  process.exit(0);
}

const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true },
});

await auth.api.signUpEmail({ body: { email, password, name } });
console.log(`Nutzer ${email} angelegt. Login unter ${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/login`);
process.exit(0);
