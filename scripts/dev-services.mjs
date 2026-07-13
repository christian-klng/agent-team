/**
 * Lokale Dev-Services ohne Docker: eingebettetes PostgreSQL + Redis.
 * Ports entsprechen den Defaults in .env.example (54329 / 63790).
 * Für Produktion gilt docker-compose.yml.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".dev");
fs.mkdirSync(dataDir, { recursive: true });

const PG_PORT = 54329;
const REDIS_PORT = 63790;

async function main() {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const { RedisMemoryServer } = await import("redis-memory-server");

  const pg = new EmbeddedPostgres({
    databaseDir: path.join(dataDir, "pg"),
    user: "agentteam",
    password: "agentteam",
    port: PG_PORT,
    persistent: true,
  });

  const pgDataExists = fs.existsSync(path.join(dataDir, "pg", "PG_VERSION"));
  if (!pgDataExists) {
    console.log("[dev-services] Initialisiere PostgreSQL-Datenverzeichnis …");
    await pg.initialise();
  }
  await pg.start();
  if (!pgDataExists) {
    await pg.createDatabase("agentteam");
  }
  console.log(
    `[dev-services] PostgreSQL läuft: postgres://agentteam:agentteam@localhost:${PG_PORT}/agentteam`,
  );

  const redis = new RedisMemoryServer({
    instance: { port: REDIS_PORT },
  });
  await redis.start();
  console.log(`[dev-services] Redis läuft: redis://localhost:${REDIS_PORT}`);
  console.log("[dev-services] Bereit. Strg+C zum Beenden.");

  const shutdown = async () => {
    console.log("\n[dev-services] Fahre herunter …");
    try {
      await redis.stop();
    } catch {}
    try {
      await pg.stop();
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[dev-services] Fehler:", err);
  process.exit(1);
});
