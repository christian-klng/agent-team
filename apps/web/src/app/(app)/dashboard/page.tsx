"use client";

import type { AgentListItem } from "@/components/agents/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import {
  decisionTypeLabels,
  type DecisionStatus,
  type DecisionType,
} from "@agent-team/shared";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import {
  Bot,
  Calendar,
  CircleDollarSign,
  FileText,
  Inbox,
  Mail,
  Sparkles,
  UserPlus,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

interface OpenDecision {
  id: string;
  runId: string;
  type: DecisionType;
  status: DecisionStatus;
  title: string;
  summary: string;
  createdAt: string;
  agentName: string;
  agentColor: string;
}

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  email_send: Mail,
  event_rsvp: Calendar,
  document_write: FileText,
  contact_upsert: UserPlus,
  skill_update: Wrench,
};

export default function DashboardPage() {
  const router = useRouter();
  const pathname = usePathname();

  const { data: decisions, isLoading: decisionsLoading } = useQuery({
    queryKey: ["decisions", "open"],
    queryFn: () => api.get<OpenDecision[]>("/api/decisions?status=open"),
  });
  const { data: agents, isLoading: agentsLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<AgentListItem[]>("/api/agents"),
  });

  const totalCost = agents?.reduce((sum, a) => sum + a.totalCost, 0) ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <h1 className="mb-1 text-xl font-semibold">Dashboard</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Offene Entscheidungen deiner Agenten — du gibst frei, die App führt aus.
        </p>

        {/* Offene Entscheidungen */}
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" />
            Offene Entscheidungen
            {decisions && decisions.length > 0 && (
              <Badge>{decisions.length}</Badge>
            )}
          </h2>
          {decisionsLoading && (
            <div className="grid gap-2">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          )}
          {decisions?.length === 0 && (
            <Card>
              <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
                <Inbox className="size-5" />
                Alles erledigt — keine offenen Entscheidungen.
              </CardContent>
            </Card>
          )}
          <div className="grid gap-2">
            {decisions?.map((decision) => {
              const Icon = typeIcons[decision.type] ?? Sparkles;
              return (
                <button
                  key={decision.id}
                  onClick={() => router.push(`${pathname}?run=${decision.runId}`)}
                  className="text-left"
                >
                  <Card className="transition-colors hover:bg-accent/40">
                    <CardContent className="flex items-center gap-3 py-3">
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white"
                        style={{ backgroundColor: decision.agentColor }}
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{decision.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {decision.agentName} · {decisionTypeLabels[decision.type]} ·{" "}
                          {formatDistanceToNow(new Date(decision.createdAt), {
                            addSuffix: true,
                            locale: de,
                          })}
                        </p>
                      </div>
                      <Badge>Offen</Badge>
                    </CardContent>
                  </Card>
                </button>
              );
            })}
          </div>
        </section>

        {/* Agenten-Grid */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Bot className="size-4" /> Agenten
            </h2>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CircleDollarSign className="size-3.5" />
              Gesamtkosten: {totalCost.toFixed(2)} $
            </span>
          </div>
          {agentsLoading && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
          )}
          {agents?.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Noch keine Agenten.{" "}
                <Link href="/agenten/neu" className="underline">
                  Lege den ersten an.
                </Link>
              </CardContent>
            </Card>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents?.map((agent) => (
              <Link key={agent.id} href={`/agenten/${agent.id}`}>
                <Card
                  className={`h-full transition-colors hover:bg-accent/40 ${
                    !agent.enabled ? "opacity-60" : ""
                  }`}
                >
                  <CardContent className="py-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white"
                        style={{ backgroundColor: agent.color }}
                      >
                        <Bot className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {agent.name}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                      <span>{agent.runCount} Läufe</span>
                      <span className="text-right font-medium text-foreground">
                        {agent.totalCost.toFixed(2)} $
                      </span>
                      <span className="col-span-2">
                        {agent.lastRunAt
                          ? `Zuletzt ${formatDistanceToNow(new Date(agent.lastRunAt), { addSuffix: true, locale: de })}`
                          : "Noch nie gelaufen"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
