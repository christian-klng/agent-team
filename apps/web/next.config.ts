import { config } from "dotenv";
import type { NextConfig } from "next";
import path from "node:path";

// Zentrale .env im Monorepo-Root laden (Next lädt sonst nur apps/web/.env*).
config({ path: path.resolve(process.cwd(), "../../.env") });

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../../"),
  transpilePackages: ["@agent-team/db", "@agent-team/core", "@agent-team/shared"],
  serverExternalPackages: [
    "pg",
    "ioredis",
    "bullmq",
    "imapflow",
    "mailparser",
    "nodemailer",
    "tsdav",
    "webdav",
    "sanitize-html",
    "node-ical",
    "rrule",
  ],
};

export default nextConfig;
