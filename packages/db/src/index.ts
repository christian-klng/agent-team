import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export * as schema from "./schema";
export * from "./schema";

declare global {
  var __agentTeamPool: Pool | undefined;
}

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ist nicht gesetzt");
  return new Pool({ connectionString: url, max: 10 });
}

// In Next.js (Dev-HMR) darf der Pool nicht pro Reload neu entstehen.
const pool = globalThis.__agentTeamPool ?? createPool();
globalThis.__agentTeamPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export type Db = typeof db;
