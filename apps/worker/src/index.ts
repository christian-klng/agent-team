import { config } from "dotenv";
import path from "node:path";

// Zentrale .env im Monorepo-Root (im Container kommen Env-Vars direkt).
config({ path: path.resolve(process.cwd(), "../../.env") });

async function main() {
  console.log("[worker] Agent Team Worker startet …");
  const { migrateDb } = await import("./migrate");
  await migrateDb();
  const { startWorker } = await import("./bootstrap");
  await startWorker();
}

main().catch((err) => {
  console.error("[worker] Fataler Fehler beim Start:", err);
  process.exit(1);
});
