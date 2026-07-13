import { db } from "@agent-team/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import fs from "node:fs";
import path from "node:path";

/**
 * Führt ausstehende Migrationen beim Worker-Start aus (Release-Step).
 * Im Container zeigt MIGRATIONS_DIR auf die einkopierten Migrationsdateien,
 * in der Entwicklung auf packages/db/migrations.
 */
export async function migrateDb(): Promise<void> {
  const folder =
    process.env.MIGRATIONS_DIR ??
    path.resolve(process.cwd(), "../../packages/db/migrations");
  if (!fs.existsSync(folder)) {
    console.warn(`[worker] Kein Migrationsordner unter ${folder} — übersprungen.`);
    return;
  }
  console.log("[worker] Prüfe Datenbank-Migrationen …");
  await migrate(db, { migrationsFolder: folder });
  console.log("[worker] Migrationen aktuell.");
}
