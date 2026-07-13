import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export * as schema from "./schema";
export * from "./schema";

type Db = NodePgDatabase<typeof schema>;

declare global {
  var __agentTeamDb: Db | undefined;
}

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ist nicht gesetzt");
  const pool = new Pool({ connectionString: url, max: 10 });
  return drizzle(pool, { schema, casing: "snake_case" });
}

/**
 * Lazy-Initialisierung: `next build` importiert Route-Module ohne laufende
 * Datenbank — der Client darf deshalb erst beim ersten Zugriff entstehen.
 * Der globalThis-Cache verhindert Pool-Leaks durch Next-Dev-HMR.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    if (!globalThis.__agentTeamDb) {
      globalThis.__agentTeamDb = createDb();
    }
    const value = Reflect.get(globalThis.__agentTeamDb, prop, globalThis.__agentTeamDb);
    return typeof value === "function"
      ? value.bind(globalThis.__agentTeamDb)
      : value;
  },
});

export type { Db };
