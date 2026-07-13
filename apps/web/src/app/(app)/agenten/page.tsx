"use client";

import type { AgentListItem } from "@/components/agents/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { Bot, Plus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

export default function AgentenPage() {
  const queryClient = useQueryClient();
  const { data: agents, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<AgentListItem[]>("/api/agents"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/agents/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Agenten</h1>
            <p className="text-sm text-muted-foreground">
              Agenten beobachten deine Datenquellen und legen dir Entscheidungen vor.
            </p>
          </div>
          <Link href="/agenten/neu" className="shrink-0">
            <Button>
              <Plus className="size-4" /> Neuer Agent
            </Button>
          </Link>
        </div>

        {isLoading && (
          <div className="grid gap-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        )}

        {agents?.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Noch keine Agenten. Lege deinen ersten Agenten an — z. B. einen
              E-Mail-Assistenten, der Antwortentwürfe vorschlägt.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {agents?.map((agent) => (
            <Card key={agent.id} className={!agent.enabled ? "opacity-60" : undefined}>
              <CardContent className="flex items-center gap-4 py-4">
                <Link
                  href={`/agenten/${agent.id}`}
                  className="flex min-w-0 flex-1 items-center gap-4"
                >
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ backgroundColor: agent.color }}
                  >
                    <Bot className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{agent.name}</span>
                      <Badge variant="secondary">{agent.model}</Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {agent.description || "Keine Beschreibung"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {agent.runCount} Läufe · {agent.totalCost.toFixed(2)} $ ·{" "}
                      {agent.lastRunAt
                        ? `zuletzt ${formatDistanceToNow(new Date(agent.lastRunAt), { addSuffix: true, locale: de })}`
                        : "noch nie gelaufen"}
                    </p>
                  </div>
                </Link>
                <Switch
                  checked={agent.enabled}
                  onCheckedChange={(enabled) =>
                    toggleMutation.mutate({ id: agent.id, enabled })
                  }
                />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
