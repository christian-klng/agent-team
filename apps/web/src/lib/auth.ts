import { db } from "@agent-team/db";
import * as schema from "@agent-team/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    // v1 ist eine Einzelnutzer-Instanz: Nutzer entstehen nur über scripts/seed-user.ts.
    disableSignUp: true,
  },
  session: {
    cookieCache: { enabled: true, maxAge: 300 },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
