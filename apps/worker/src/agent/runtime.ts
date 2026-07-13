import { publishAppEvent } from "@agent-team/core";
import {
  agentMemories,
  agentRunEvents,
  agentRuns,
  agents,
  calendarEvents,
  db,
  documentFiles,
  mailMessageBodies,
  mailMessages,
  triggerEvents,
} from "@agent-team/db";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { and, eq, max, sql } from "drizzle-orm";
import { buildAgentToolServer, formatMailForAgent } from "./tools";
import { claudeConfigDir, ensureWorkspace } from "./workspace";

type AgentRow = typeof agents.$inferSelect;
type RunRow = typeof agentRuns.$inferSelect;

const RESULT_TEXT_CAP = 600;

function buildSystemPrompt(agent: AgentRow, memory: string): string {
  return [
    `Du bist "${agent.name}", ein Agent im System Agent Team von Christian.`,
    agent.description ? `Aufgabe: ${agent.description}` : null,
    "",
    "## Grundregeln",
    "- Du kannst KEINE Aktionen ausführen (keine E-Mail senden, nichts schreiben, nichts bestätigen).",
    "- Dein Ziel ist immer, dem Nutzer über das Tool `propose_decision` einen konkreten, gut begründeten Vorschlag zur Freigabe vorzulegen — oder den Lauf mit `no_action_needed` zu beenden.",
    "- Nutze deine Lese-Tools, um Kontext zu sammeln, bevor du entscheidest. Arbeite sparsam: nur so viele Tool-Aufrufe wie nötig.",
    "- Antworte auf Deutsch, formuliere Entwürfe im Stil des Nutzers (professionell, freundlich, knapp).",
    "- Aktualisiere dein Gedächtnis (`memory_write`), wenn du etwas Dauerhaftes über Kontakte, Projekte oder Vorlieben des Nutzers lernst.",
    "",
    "## Dein Skill (deine Arbeitsanweisung)",
    agent.skillMarkdown,
    memory
      ? `\n## Dein Gedächtnis (aus früheren Läufen)\n${memory}`
      : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

async function buildTriggerPrompt(triggerEventId: string): Promise<string> {
  const [event] = await db
    .select()
    .from(triggerEvents)
    .where(eq(triggerEvents.id, triggerEventId));
  if (!event) return "Ein Auslöser wurde erkannt, ist aber nicht mehr auffindbar.";

  if (event.kind === "mail.new" || event.kind === "mail.updated") {
    const messageId = String(event.payload.messageId ?? event.externalRef);
    const [msg] = await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, messageId));
    if (msg) {
      const [body] = await db
        .select()
        .from(mailMessageBodies)
        .where(eq(mailMessageBodies.messageId, messageId));
      return `Neue E-Mail eingegangen:\n\n${formatMailForAgent(msg, body?.textBody ?? null)}`;
    }
  }

  if (event.kind === "event.new" || event.kind === "event.updated") {
    const eventId = String(event.payload.eventId ?? event.externalRef);
    const [ev] = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, eventId));
    if (ev) {
      return [
        event.kind === "event.new" ? "Neuer Kalender-Termin erkannt:" : "Kalender-Termin wurde geändert:",
        "",
        `Event-ID (intern): ${ev.id}`,
        `Titel: ${ev.summary}`,
        `Beginn: ${ev.startsAt?.toISOString() ?? "?"}`,
        `Ende: ${ev.endsAt?.toISOString() ?? "?"}`,
        ev.location ? `Ort: ${ev.location}` : null,
        ev.organizer ? `Organisator: ${ev.organizer.name ?? ""} <${ev.organizer.email ?? "?"}>` : null,
        ev.attendees.length > 0
          ? `Teilnehmer: ${ev.attendees.map((a) => `${a.email}${a.self ? " (du/Nutzer)" : ""} [${a.partstat ?? "?"}]`).join(", ")}`
          : null,
        ev.description ? `Beschreibung: ${ev.description.slice(0, 2000)}` : null,
      ]
        .filter((l) => l !== null)
        .join("\n");
    }
  }

  if (event.kind === "file.new" || event.kind === "file.updated") {
    const fileId = String(event.payload.fileId ?? event.externalRef);
    const [file] = await db
      .select()
      .from(documentFiles)
      .where(eq(documentFiles.id, fileId));
    if (file) {
      return [
        event.kind === "file.new" ? "Neue Datei im Dokumenten-Speicher erkannt:" : "Datei wurde geändert:",
        "",
        `Pfad: ${file.path}`,
        `Name: ${file.name}`,
        `Typ: ${file.mime ?? "unbekannt"}`,
        `Größe: ${file.size ?? "?"} Bytes`,
        `Geändert: ${file.modifiedAt?.toISOString() ?? "?"}`,
        "",
        "Du kannst den Inhalt bei Bedarf mit docs_read_document lesen.",
      ].join("\n");
    }
  }

  return `Auslöser: ${event.kind} (${event.externalRef}). Details: ${JSON.stringify(event.payload)}`;
}

interface StreamState {
  seq: number;
  toolNames: Map<string, string>;
  sessionId: string | null;
}

async function persistEvent(
  run: RunRow,
  state: StreamState,
  type: "trigger" | "assistant_text" | "tool_call" | "tool_result" | "user_message" | "decision_created" | "result" | "error",
  content: Record<string, unknown>,
): Promise<void> {
  const seq = state.seq++;
  await db.insert(agentRunEvents).values({ runId: run.id, seq, type, content });
  await publishAppEvent(run.userId, {
    type: "run.event",
    runId: run.id,
    agentId: run.agentId,
    seq,
    eventType: type,
    content,
  });
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join("");
  }
  return "";
}

async function handleSdkMessage(
  run: RunRow,
  state: StreamState,
  message: SDKMessage,
): Promise<{ costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; numTurns: number } | null> {
  if (message.type === "system" && message.subtype === "init") {
    state.sessionId = message.session_id;
    await db
      .update(agentRuns)
      .set({ sdkSessionId: message.session_id })
      .where(eq(agentRuns.id, run.id));
    return null;
  }

  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text" && block.text.trim()) {
        await persistEvent(run, state, "assistant_text", { text: block.text });
      } else if (block.type === "tool_use") {
        const name = block.name.replace(/^mcp__team__/, "");
        state.toolNames.set(block.id, name);
        await persistEvent(run, state, "tool_call", {
          toolUseId: block.id,
          name,
          input: block.input,
        });
      }
    }
    return null;
  }

  if (message.type === "user") {
    const content = message.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_result") {
          const name = state.toolNames.get(block.tool_use_id) ?? "tool";
          const text = extractText(block.content);
          await persistEvent(run, state, "tool_result", {
            toolUseId: block.tool_use_id,
            name,
            isError: block.is_error ?? false,
            output: text.length > RESULT_TEXT_CAP ? `${text.slice(0, RESULT_TEXT_CAP)}…` : text,
          });
        }
      }
    }
    return null;
  }

  if (message.type === "result") {
    const usage = "usage" in message ? message.usage : undefined;
    const costs = {
      costUsd: "total_cost_usd" in message ? message.total_cost_usd : 0,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      numTurns: "num_turns" in message ? message.num_turns : 0,
    };
    await persistEvent(run, state, "result", {
      subtype: message.subtype,
      costUsd: costs.costUsd,
      numTurns: costs.numTurns,
      resultText:
        message.subtype === "success"
          ? message.result.slice(0, RESULT_TEXT_CAP)
          : `Lauf endete mit: ${message.subtype}`,
    });
    return costs;
  }

  return null;
}

/** Baut die SDK-Query-Optionen (gemeinsam für Erst-Lauf und Follow-up). */
function buildQueryOptions(
  run: RunRow,
  agent: AgentRow,
  systemPrompt: string,
  allowedTools: string[],
  server: ReturnType<typeof buildAgentToolServer>["server"],
  resume?: string,
) {
  // Saubere Umgebung: Host-Session-Variablen (z. B. wenn der Worker selbst
  // innerhalb einer Claude-Code-Session gestartet wurde) dürfen nicht in die
  // SDK-Subprozesse durchsickern.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "CLAUDECODE" || key.startsWith("CLAUDE_") || key.startsWith("ANTHROPIC_")) {
      continue;
    }
    env[key] = value;
  }
  env.CLAUDE_CONFIG_DIR = claudeConfigDir();
  env.DISABLE_AUTOUPDATER = "1";
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";

  // LLM-Gateway (LiteLLM → OpenRouter/Cortecs); ohne Gateway direkte Anthropic-API.
  if (process.env.LITELLM_BASE_URL) {
    env.ANTHROPIC_BASE_URL = process.env.LITELLM_BASE_URL;
    if (process.env.LITELLM_MASTER_KEY) {
      env.ANTHROPIC_AUTH_TOKEN = process.env.LITELLM_MASTER_KEY;
    }
  } else if (process.env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }

  return {
    cwd: ensureWorkspace(agent.id),
    model: agent.model,
    maxTurns: agent.maxTurns,
    systemPrompt,
    mcpServers: { team: server },
    allowedTools,
    disallowedTools: [
      "Bash",
      "Edit",
      "Write",
      "Read",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch",
      "Task",
      "NotebookEdit",
      "TodoWrite",
    ],
    permissionMode: "dontAsk" as const,
    settingSources: [] as [],
    env,
    ...(resume ? { resume } : {}),
  };
}

async function loadRunContext(runId: string) {
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!run) throw new Error(`Run ${runId} nicht gefunden`);
  const [agent] = await db.select().from(agents).where(eq(agents.id, run.agentId));
  if (!agent) throw new Error(`Agent ${run.agentId} nicht gefunden`);
  const [memory] = await db
    .select()
    .from(agentMemories)
    .where(eq(agentMemories.agentId, agent.id));

  const [seqRow] = await db
    .select({ maxSeq: max(agentRunEvents.seq) })
    .from(agentRunEvents)
    .where(eq(agentRunEvents.runId, runId));

  const state: StreamState = {
    seq: (seqRow?.maxSeq ?? -1) + 1,
    toolNames: new Map(),
    sessionId: run.sdkSessionId,
  };

  const { server, allowedTools } = buildAgentToolServer({
    runId: run.id,
    agent,
    userId: run.userId,
    emit: (type, content) => persistEvent(run, state, type, content),
  });

  return { run, agent, memory: memory?.content ?? "", state, server, allowedTools };
}

async function applyCosts(
  runId: string,
  costs: { costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; numTurns: number },
): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      costUsd: sql`${agentRuns.costUsd} + ${costs.costUsd}`,
      inputTokens: sql`${agentRuns.inputTokens} + ${costs.inputTokens}`,
      outputTokens: sql`${agentRuns.outputTokens} + ${costs.outputTokens}`,
      cacheReadTokens: sql`${agentRuns.cacheReadTokens} + ${costs.cacheReadTokens}`,
      numTurns: sql`${agentRuns.numTurns} + ${costs.numTurns}`,
    })
    .where(eq(agentRuns.id, runId));
}

async function setRunStatus(
  run: RunRow,
  status: "running" | "completed" | "failed",
  error?: string,
): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      status,
      ...(status === "running" ? { startedAt: new Date() } : {}),
      ...(status !== "running" ? { finishedAt: new Date() } : {}),
      ...(error ? { error } : {}),
    })
    .where(eq(agentRuns.id, run.id));
  await publishAppEvent(run.userId, {
    type: "run.status",
    runId: run.id,
    agentId: run.agentId,
    status,
  });
}

/** Führt einen Agent-Lauf aus (Trigger- oder Test-Lauf). */
export async function executeRun(runId: string, manualPrompt?: string): Promise<void> {
  const { run, agent, memory, state, server, allowedTools } = await loadRunContext(runId);
  if (run.status !== "queued") {
    console.log(`[agent] Run ${runId} ist ${run.status}, übersprungen.`);
    return;
  }

  await setRunStatus(run, "running");
  try {
    const prompt = run.triggerEventId
      ? await buildTriggerPrompt(run.triggerEventId)
      : (manualPrompt ?? "Manueller Testlauf. Prüfe deine Datenlage und schlage bei Bedarf eine Entscheidung vor.");
    await persistEvent(run, state, "trigger", { text: prompt });

    const systemPrompt = buildSystemPrompt(agent, memory);
    const options = buildQueryOptions(run, agent, systemPrompt, allowedTools, server);

    let costs = null;
    for await (const message of query({ prompt, options })) {
      const result = await handleSdkMessage(run, state, message);
      if (result) costs = result;
    }
    if (costs) await applyCosts(run.id, costs);
    await setRunStatus(run, "completed");
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Run ${runId} fehlgeschlagen:`, messageText);
    await persistEvent(run, state, "error", { message: messageText });
    await setRunStatus(run, "failed", messageText);
  }
}

/** Setzt eine bestehende Session mit einer Nutzer-Nachfrage fort. */
export async function executeFollowup(runId: string, userMessage: string): Promise<void> {
  const { run, agent, memory, state, server, allowedTools } = await loadRunContext(runId);
  if (!run.sdkSessionId) {
    await persistEvent(run, state, "error", {
      message: "Keine SDK-Session vorhanden — Nachfragen sind für diesen Lauf nicht möglich.",
    });
    return;
  }

  await persistEvent(run, state, "user_message", { text: userMessage });
  await publishAppEvent(run.userId, {
    type: "run.status",
    runId: run.id,
    agentId: run.agentId,
    status: "running",
  });

  try {
    const systemPrompt = buildSystemPrompt(agent, memory);
    const options = buildQueryOptions(
      run,
      agent,
      systemPrompt,
      allowedTools,
      server,
      run.sdkSessionId,
    );

    let costs = null;
    for await (const message of query({ prompt: userMessage, options })) {
      const result = await handleSdkMessage(run, state, message);
      if (result) costs = result;
    }
    if (costs) await applyCosts(run.id, costs);
    await publishAppEvent(run.userId, {
      type: "run.status",
      runId: run.id,
      agentId: run.agentId,
      status: run.status,
    });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Follow-up für ${runId} fehlgeschlagen:`, messageText);
    await persistEvent(run, state, "error", { message: messageText });
    await publishAppEvent(run.userId, {
      type: "run.status",
      runId: run.id,
      agentId: run.agentId,
      status: run.status,
    });
  }
}
