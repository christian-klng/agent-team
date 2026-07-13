"use client";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAppEvent } from "@/lib/use-app-events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  decisionStatusLabels,
  decisionTypeLabels,
  runStatusLabels,
  toolActionLabels,
  type DecisionStatus,
  type DecisionType,
  type RunStatus,
} from "@agent-team/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  CircleDollarSign,
  Loader2,
  Send,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DecisionCard } from "./decisions/decision-card";

interface RunEvent {
  id: string;
  seq: number;
  type: string;
  content: Record<string, unknown>;
  createdAt: string;
}

export interface RunDecision {
  id: string;
  type: DecisionType;
  status: DecisionStatus;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  originalPayload: Record<string, unknown>;
  error: string | null;
  executionResult: Record<string, unknown> | null;
}

interface RunDetail {
  id: string;
  agentId: string;
  agentName: string;
  agentColor: string;
  status: RunStatus;
  createdAt: string;
  costUsd: string;
  numTurns: number;
  sdkSessionId: string | null;
  events: RunEvent[];
  decisions: RunDecision[];
}

function TriggerCard({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 400;
  return (
    <div className="rounded-lg border bg-muted/50 p-3 text-xs">
      <p className="mb-1 flex items-center gap-1.5 font-medium text-muted-foreground">
        <Zap className="size-3" /> Auslöser
      </p>
      <pre className="font-sans whitespace-pre-wrap">
        {isLong && !expanded ? `${text.slice(0, 400)}…` : text}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
          {expanded ? "Weniger" : "Mehr anzeigen"}
        </button>
      )}
    </div>
  );
}

function ToolRow({
  name,
  done,
  isError,
  input,
  output,
}: {
  name: string;
  done: boolean;
  isError: boolean;
  input?: unknown;
  output?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = toolActionLabels[name] ?? name;
  return (
    <div className="rounded-md border bg-background px-2.5 py-1.5 text-xs">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 text-left"
      >
        {done ? (
          isError ? (
            <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
          ) : (
            <Check className="size-3.5 shrink-0 text-green-600" />
          )
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className={cn("flex-1", isError && "text-destructive")}>
          {done ? label : `${label} …`}
        </span>
        <ChevronDown
          className={cn("size-3 text-muted-foreground transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded && (
        <div className="mt-1.5 grid gap-1 border-t pt-1.5 text-[11px] text-muted-foreground">
          {input !== undefined && (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap">
              → {JSON.stringify(input, null, 1)?.slice(0, 600)}
            </pre>
          )}
          {output && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{output}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function RunTimeline({ run }: { run: RunDetail }) {
  const decisionsById = useMemo(
    () => new Map(run.decisions.map((d) => [d.id, d])),
    [run.decisions],
  );
  const resultsByToolUse = useMemo(() => {
    const map = new Map<string, RunEvent>();
    for (const e of run.events) {
      if (e.type === "tool_result" && e.content.toolUseId) {
        map.set(String(e.content.toolUseId), e);
      }
    }
    return map;
  }, [run.events]);

  return (
    <div className="grid gap-2.5">
      {run.events.map((event) => {
        switch (event.type) {
          case "trigger":
            return <TriggerCard key={event.id} text={String(event.content.text ?? "")} />;
          case "assistant_text":
            return (
              <div key={event.id} className="rounded-lg bg-accent/60 p-3 text-sm whitespace-pre-wrap">
                {String(event.content.text ?? "")}
              </div>
            );
          case "user_message":
            return (
              <div
                key={event.id}
                className="ml-8 rounded-lg bg-primary p-3 text-sm whitespace-pre-wrap text-primary-foreground"
              >
                {String(event.content.text ?? "")}
              </div>
            );
          case "tool_call": {
            const result = resultsByToolUse.get(String(event.content.toolUseId));
            return (
              <ToolRow
                key={event.id}
                name={String(event.content.name ?? "tool")}
                done={!!result}
                isError={!!result?.content.isError}
                input={event.content.input}
                output={result ? String(result.content.output ?? "") : undefined}
              />
            );
          }
          case "decision_created": {
            const decision = decisionsById.get(String(event.content.decisionId));
            if (!decision) {
              return (
                <div key={event.id} className="rounded-lg border-2 border-primary/40 p-3 text-sm">
                  <Sparkles className="mr-1 inline size-3.5" />
                  Entscheidung: {String(event.content.title ?? "")}
                </div>
              );
            }
            return <DecisionCard key={event.id} decision={decision} runId={run.id} />;
          }
          case "result":
            return (
              <p key={event.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CircleDollarSign className="size-3" />
                Abschnitt beendet · {String(event.content.numTurns ?? "?")} Turns ·{" "}
                {Number(event.content.costUsd ?? 0).toFixed(4)} $
              </p>
            );
          case "error":
            return (
              <div key={event.id} className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {String(event.content.message ?? "Unbekannter Fehler")}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function RunPanelInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const runId = searchParams.get("run");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");

  const { data: run, isLoading } = useQuery({
    queryKey: ["runs", "detail", runId],
    queryFn: () => api.get<RunDetail>(`/api/runs/${runId}`),
    enabled: !!runId,
  });

  // Live-Updates: Events dieses Runs direkt in den Cache mergen.
  useAppEvent((event) => {
    if (!runId) return;
    if (event.type === "run.event" && event.runId === runId) {
      queryClient.invalidateQueries({ queryKey: ["runs", "detail", runId] });
    }
    if (event.type === "run.status" && event.runId === runId) {
      queryClient.invalidateQueries({ queryKey: ["runs", "detail", runId] });
    }
    if (event.type === "decision.changed") {
      queryClient.invalidateQueries({ queryKey: ["runs", "detail", runId] });
    }
  });

  useEffect(() => {
    // Bei neuen Events ans Ende scrollen.
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run?.events.length]);

  const followupMutation = useMutation({
    mutationFn: (text: string) => api.post(`/api/runs/${runId}/messages`, { message: text }),
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["runs", "detail", runId] });
    },
    onError: (err) => toast.error(err.message),
  });

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("run");
    router.replace(`${pathname}${params.size > 0 ? `?${params}` : ""}`);
  }

  if (!runId) return null;

  const isActive = run?.status === "queued" || run?.status === "running";

  return (
    <>
      {/* Overlay auf Mobile */}
      <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={close} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-xl">
        <header className="flex shrink-0 items-center gap-2 border-b p-3">
          <span
            className="flex size-8 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: run?.agentColor ?? "#8b5cf6" }}
          >
            <Bot className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{run?.agentName ?? "Agent-Lauf"}</p>
            <p className="text-xs text-muted-foreground">
              {run &&
                `${format(new Date(run.createdAt), "d. MMM HH:mm", { locale: de })} · ${
                  runStatusLabels[run.status] ?? run.status
                } · ${Number(run.costUsd).toFixed(4)} $`}
            </p>
          </div>
          {isActive && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <Button variant="ghost" size="icon" onClick={close} aria-label="Schließen">
            <X className="size-4" />
          </Button>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
          {isLoading && (
            <div className="grid gap-2">
              <Skeleton className="h-20" />
              <Skeleton className="h-10" />
              <Skeleton className="h-32" />
            </div>
          )}
          {run && <RunTimeline run={run} />}
          {run && run.events.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {isActive ? "Der Lauf startet gleich …" : "Keine Ereignisse."}
            </p>
          )}
        </div>

        <footer className="shrink-0 border-t p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (message.trim()) followupMutation.mutate(message.trim());
            }}
            className="flex items-end gap-2"
          >
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                isActive
                  ? "Der Lauf ist noch aktiv …"
                  : run?.sdkSessionId
                    ? "Nachfrage an den Agenten …"
                    : "Für diesen Lauf ist keine Session verfügbar."
              }
              disabled={isActive || !run?.sdkSessionId || followupMutation.isPending}
              rows={2}
              className="min-h-0 resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (message.trim()) followupMutation.mutate(message.trim());
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              disabled={isActive || !message.trim() || followupMutation.isPending}
              aria-label="Senden"
            >
              {followupMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </form>
        </footer>
      </aside>
    </>
  );
}

export function RunPanel() {
  return (
    <Suspense fallback={null}>
      <RunPanelInner />
    </Suspense>
  );
}
