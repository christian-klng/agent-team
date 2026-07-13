import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import path from "node:path";

// drizzle-kit läuft aus packages/db — .env liegt im Monorepo-Root.
config({ path: path.resolve(process.cwd(), "../../.env") });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
