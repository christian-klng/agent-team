"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { DEFAULT_SKILL_TEMPLATE, toolCatalog } from "@agent-team/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#64748b",
];

export default function NeuerAgentPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#8b5cf6");
  const [model, setModel] = useState("claude-sonnet-4-5");
  const [skill, setSkill] = useState(DEFAULT_SKILL_TEMPLATE);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/api/agents", {
        name,
        description: description || undefined,
        color,
        model,
        skillMarkdown: skill,
        // Sinnvoller Start: alle Lese-Tools an, Feintuning im Detail.
        enabledTools: toolCatalog.map((t) => t.name),
      }),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast.success("Agent angelegt. Verbinde jetzt Trigger und prüfe die Tools.");
      router.push(`/agenten/${agent.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl p-4 md:p-8">
        <Link
          href="/agenten"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Zurück zu Agenten
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Neuer Agent</CardTitle>
            <CardDescription>
              Name, Modell und Skill festlegen — Trigger und Tools konfigurierst du
              anschließend im Detail.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="z. B. E-Mail-Assistent"
                />
              </div>
              <div className="flex gap-1 pb-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Farbe ${c}`}
                    className="size-5 rounded-full border-2"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? "var(--foreground)" : "transparent",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Beschreibung (optional)</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Was macht dieser Agent?"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Modell</Label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                list="model-suggestions"
              />
              <datalist id="model-suggestions">
                <option value="claude-sonnet-4-5" />
                <option value="claude-haiku-4-5" />
                <option value="claude-opus-4-8" />
              </datalist>
              <p className="text-xs text-muted-foreground">
                Der Modellname wird über das LiteLLM-Gateway aufgelöst (OpenRouter/Cortecs).
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label>Skill (Arbeitsanweisung, Markdown)</Label>
              <Textarea
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
                rows={14}
                className="font-mono text-xs"
              />
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!name || !skill || createMutation.isPending}
            >
              {createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Agent anlegen
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
