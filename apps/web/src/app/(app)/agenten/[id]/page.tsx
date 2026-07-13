"use client";

import type { AgentDetail, AgentTriggerRow, RunListItem } from "@/components/agents/types";
import type { SourceListItem } from "@/components/settings/source-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  dataSourceTypeLabels,
  runStatusLabels,
  toolCatalog,
  toolGroupLabels,
  triggerKindLabels,
  triggerKindsBySourceType,
  type DataSourceType,
  type RunStatus,
  type ToolGroup,
} from "@agent-team/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { ArrowLeft, Bot, Loader2, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";

function SaveButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <Button size="sm" onClick={onClick} disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />} Speichern
    </Button>
  );
}

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: agent, isLoading } = useQuery({
    queryKey: ["agents", id],
    queryFn: () => api.get<AgentDetail>(`/api/agents/${id}`),
  });
  const { data: sources = [] } = useQuery({
    queryKey: ["sources"],
    queryFn: () => api.get<SourceListItem[]>("/api/sources"),
  });
  const { data: runs = [] } = useQuery({
    queryKey: ["runs", "byAgent", id],
    queryFn: () => api.get<RunListItem[]>(`/api/runs?agentId=${id}`),
  });

  // Lokale Editier-Kopien
  const [config, setConfig] = useState({ name: "", description: "", model: "", maxTurns: 15 });
  const [skill, setSkill] = useState("");
  const [memory, setMemory] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [triggers, setTriggers] = useState<AgentTriggerRow[]>([]);

  useEffect(() => {
    if (agent) {
      setConfig({
        name: agent.name,
        description: agent.description ?? "",
        model: agent.model,
        maxTurns: agent.maxTurns,
      });
      setSkill(agent.skillMarkdown);
      setMemory(agent.memory);
      setTools(agent.enabledTools);
      setTriggers(agent.triggers);
    }
  }, [agent]);

  const patchMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/api/agents/${id}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast.success("Gespeichert.");
    },
    onError: (err) => toast.error(err.message),
  });

  const memoryMutation = useMutation({
    mutationFn: (content: string) => api.patch(`/api/agents/${id}/memory`, { content }),
    onSuccess: () => toast.success("Gedächtnis gespeichert."),
    onError: (err) => toast.error(err.message),
  });

  const testRunMutation = useMutation({
    mutationFn: () => api.post<{ runId: string }>(`/api/agents/${id}/test-run`, {}),
    onSuccess: ({ runId }) => router.push(`/agenten/${id}?run=${runId}`),
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/agents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      router.push("/agenten");
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading || !agent) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Skeleton className="mb-4 h-10 w-1/2" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const toolsByGroup = new Map<ToolGroup, typeof toolCatalog>();
  for (const t of toolCatalog) {
    const list = toolsByGroup.get(t.group) ?? [];
    list.push(t);
    toolsByGroup.set(t.group, list);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <Link
          href="/agenten"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Zurück zu Agenten
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <span
            className="flex size-11 items-center justify-center rounded-xl text-white"
            style={{ backgroundColor: agent.color }}
          >
            <Bot className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{agent.name}</h1>
            <p className="text-sm text-muted-foreground">
              {agent.runCount ?? 0} Läufe · {(agent.totalCost ?? 0).toFixed(2)} $ gesamt
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => testRunMutation.mutate()}
            disabled={testRunMutation.isPending}
          >
            {testRunMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            Testlauf
          </Button>
        </div>

        <Tabs defaultValue="konfiguration">
          <TabsList className="flex-wrap">
            <TabsTrigger value="konfiguration">Konfiguration</TabsTrigger>
            <TabsTrigger value="skill">Skill</TabsTrigger>
            <TabsTrigger value="trigger">Trigger</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="memory">Gedächtnis</TabsTrigger>
            <TabsTrigger value="runs">Läufe</TabsTrigger>
          </TabsList>

          {/* Konfiguration */}
          <TabsContent value="konfiguration" className="mt-4">
            <Card>
              <CardContent className="grid gap-4 py-4">
                <div className="grid gap-1.5">
                  <Label>Name</Label>
                  <Input
                    value={config.name}
                    onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Beschreibung</Label>
                  <Input
                    value={config.description}
                    onChange={(e) => setConfig((c) => ({ ...c, description: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Modell</Label>
                    <Input
                      value={config.model}
                      onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Max. Schritte (maxTurns)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={config.maxTurns}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, maxTurns: Number(e.target.value) }))
                      }
                    />
                  </div>
                </div>
                <div className="flex justify-between">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`Agent „${agent.name}" wirklich löschen? Alle Läufe und Entscheidungen gehen verloren.`)) {
                        deleteMutation.mutate();
                      }
                    }}
                  >
                    <Trash2 className="size-4" /> Löschen
                  </Button>
                  <SaveButton
                    pending={patchMutation.isPending}
                    onClick={() =>
                      patchMutation.mutate({
                        name: config.name,
                        description: config.description,
                        model: config.model,
                        maxTurns: config.maxTurns,
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Skill */}
          <TabsContent value="skill" className="mt-4">
            <Card>
              <CardContent className="grid gap-3 py-4">
                <p className="text-xs text-muted-foreground">
                  Die Arbeitsanweisung des Agenten (Markdown). Der Agent kann über
                  eine Entscheidung (skill_update) selbst Änderungen vorschlagen —
                  die du hier freigibst.
                </p>
                <Textarea
                  value={skill}
                  onChange={(e) => setSkill(e.target.value)}
                  rows={18}
                  className="font-mono text-xs"
                />
                <div className="flex justify-end">
                  <SaveButton
                    pending={patchMutation.isPending}
                    onClick={() => patchMutation.mutate({ skillMarkdown: skill })}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Trigger */}
          <TabsContent value="trigger" className="mt-4">
            <Card>
              <CardContent className="grid gap-4 py-4">
                <p className="text-xs text-muted-foreground">
                  Bei welchen neuen Einträgen soll dieser Agent starten? Ohne
                  ausgewählte Ereignis-Arten reagiert er auf alle Ereignisse der Quelle.
                </p>
                {triggers.map((trigger, i) => {
                  const source = sourceById.get(trigger.dataSourceId);
                  const kinds = source
                    ? triggerKindsBySourceType[source.type as DataSourceType]
                    : [];
                  return (
                    <div key={i} className="grid gap-3 rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <Select
                          value={trigger.dataSourceId}
                          onValueChange={(v) => {
                            if (!v) return;
                            setTriggers((ts) =>
                              ts.map((t, j) =>
                                j === i ? { ...t, dataSourceId: String(v), eventKinds: [] } : t,
                              ),
                            );
                          }}
                          items={sources.map((s) => ({
                            value: s.id,
                            label: `${s.name} (${dataSourceTypeLabels[s.type]})`,
                          }))}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {sources.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name} ({dataSourceTypeLabels[s.type]})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setTriggers((ts) => ts.filter((_, j) => j !== i))}
                          aria-label="Trigger entfernen"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {kinds.map((kind) => (
                          <label key={kind} className="flex items-center gap-1.5 text-sm">
                            <Checkbox
                              checked={trigger.eventKinds.includes(kind)}
                              onCheckedChange={(checked) =>
                                setTriggers((ts) =>
                                  ts.map((t, j) =>
                                    j === i
                                      ? {
                                          ...t,
                                          eventKinds: checked
                                            ? [...t.eventKinds, kind]
                                            : t.eventKinds.filter((k) => k !== kind),
                                        }
                                      : t,
                                  ),
                                )
                              }
                            />
                            {triggerKindLabels[kind]}
                          </label>
                        ))}
                      </div>
                      {source?.type === "email" && (
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Absender-Filter (Regex/Text, optional)</Label>
                          <Input
                            value={trigger.filter.senderPattern ?? ""}
                            placeholder="z. B. @beispiel-gmbh\\.de$"
                            onChange={(e) =>
                              setTriggers((ts) =>
                                ts.map((t, j) =>
                                  j === i
                                    ? { ...t, filter: { ...t.filter, senderPattern: e.target.value || undefined } }
                                    : t,
                                ),
                              )
                            }
                          />
                        </div>
                      )}
                      {source?.type === "webdav" && (
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Pfad-Präfix (optional)</Label>
                          <Input
                            value={trigger.filter.pathPrefix ?? ""}
                            placeholder="z. B. /Projekte"
                            onChange={(e) =>
                              setTriggers((ts) =>
                                ts.map((t, j) =>
                                  j === i
                                    ? { ...t, filter: { ...t.filter, pathPrefix: e.target.value || undefined } }
                                    : t,
                                ),
                              )
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sources.length === 0}
                    onClick={() =>
                      setTriggers((ts) => [
                        ...ts,
                        { dataSourceId: sources[0]!.id, eventKinds: [], filter: {} },
                      ])
                    }
                  >
                    <Plus className="size-4" /> Trigger hinzufügen
                  </Button>
                  <SaveButton
                    pending={patchMutation.isPending}
                    onClick={() => patchMutation.mutate({ triggers })}
                  />
                </div>
                {sources.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Lege zuerst in den Einstellungen eine Datenquelle an.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tools */}
          <TabsContent value="tools" className="mt-4">
            <Card>
              <CardContent className="grid gap-4 py-4">
                <p className="text-xs text-muted-foreground">
                  Lese-Tools, die dieser Agent nutzen darf. `propose_decision` und
                  `no_action_needed` sind immer aktiv — sie sind der einzige Weg,
                  etwas anzustoßen.
                </p>
                {[...toolsByGroup.entries()].map(([group, entries]) => (
                  <div key={group}>
                    <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                      {toolGroupLabels[group]}
                    </p>
                    <div className="grid gap-1.5">
                      {entries.map((entry) => (
                        <label key={entry.name} className="flex items-start gap-2 text-sm">
                          <Checkbox
                            className="mt-0.5"
                            checked={tools.includes(entry.name)}
                            onCheckedChange={(checked) =>
                              setTools((t) =>
                                checked ? [...t, entry.name] : t.filter((n) => n !== entry.name),
                              )
                            }
                          />
                          <span>
                            {entry.label}{" "}
                            <span className="text-xs text-muted-foreground">
                              — {entry.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex justify-end">
                  <SaveButton
                    pending={patchMutation.isPending}
                    onClick={() => patchMutation.mutate({ enabledTools: tools })}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Gedächtnis */}
          <TabsContent value="memory" className="mt-4">
            <Card>
              <CardContent className="grid gap-3 py-4">
                <p className="text-xs text-muted-foreground">
                  Dauerhafte Notizen des Agenten — er pflegt sie selbst über
                  `memory_write`, du kannst sie hier einsehen und korrigieren.
                </p>
                <Textarea
                  value={memory}
                  onChange={(e) => setMemory(e.target.value)}
                  rows={12}
                  className="font-mono text-xs"
                  placeholder="(noch leer)"
                />
                <div className="flex justify-end">
                  <SaveButton
                    pending={memoryMutation.isPending}
                    onClick={() => memoryMutation.mutate(memory)}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Läufe */}
          <TabsContent value="runs" className="mt-4">
            <Card>
              <CardContent className="py-2">
                {runs.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Noch keine Läufe. Starte einen Testlauf oder warte auf den
                    nächsten Trigger.
                  </p>
                )}
                <div className="divide-y">
                  {runs.map((run) => (
                    <button
                      key={run.id}
                      onClick={() => router.push(`/agenten/${id}?run=${run.id}`)}
                      className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:bg-accent/40"
                    >
                      <Badge
                        variant={
                          run.status === "failed"
                            ? "destructive"
                            : run.status === "completed"
                              ? "secondary"
                              : "default"
                        }
                      >
                        {runStatusLabels[run.status as RunStatus] ?? run.status}
                      </Badge>
                      <span className="flex-1 truncate text-muted-foreground">
                        {format(new Date(run.createdAt), "d. MMM yyyy HH:mm", { locale: de })}
                        {run.error && ` · ${run.error.slice(0, 60)}`}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {Number(run.costUsd).toFixed(4)} $
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
