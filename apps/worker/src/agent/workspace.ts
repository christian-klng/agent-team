import fs from "node:fs";
import path from "node:path";

/** Basisverzeichnis für persistente Worker-Daten (Volume in Produktion). */
export function agentDataDir(): string {
  return process.env.AGENT_DATA_DIR ?? "/data";
}

/** Verzeichnis für SDK-Sessions (CLAUDE_CONFIG_DIR). */
export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(agentDataDir(), "claude");
}

/**
 * Stellt den Workspace eines Agenten bereit (cwd der SDK-Session).
 * Bewusst leer gehalten — Skill und Memory kommen über System-Prompt/Tools.
 */
export function ensureWorkspace(agentId: string): string {
  const dir = path.join(agentDataDir(), "agents", agentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(claudeConfigDir(), { recursive: true });
  return dir;
}
