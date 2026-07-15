"use client";

import type { RunDecision } from "@/components/run-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  decisionStatusLabels,
  decisionTypeLabels,
} from "@agent-team/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "default",
  approved: "secondary",
  executing: "secondary",
  executed: "outline",
  rejected: "destructive",
  failed: "destructive",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Typ-spezifisches Formular für den editierbaren Entwurf. */
function PayloadEditor({
  type,
  payload,
  onChange,
  readonly,
}: {
  type: string;
  payload: Record<string, unknown>;
  onChange: (payload: Record<string, unknown>) => void;
  readonly: boolean;
}) {
  const set = (key: string, value: unknown) => onChange({ ...payload, [key]: value });
  const str = (key: string) => String(payload[key] ?? "");

  if (type === "email_send") {
    const to = Array.isArray(payload.to) ? (payload.to as string[]) : [];
    const cc = Array.isArray(payload.cc) ? (payload.cc as string[]) : [];
    return (
      <div className="grid gap-2">
        <Field label="An">
          <Input
            value={to.join(", ")}
            disabled={readonly}
            onChange={(e) =>
              set("to", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
            }
          />
        </Field>
        <Field label="CC (optional)">
          <Input
            value={cc.join(", ")}
            disabled={readonly}
            onChange={(e) =>
              set("cc", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
            }
          />
        </Field>
        <Field label="Betreff">
          <Input value={str("subject")} disabled={readonly} onChange={(e) => set("subject", e.target.value)} />
        </Field>
        <Field label="Nachricht">
          <Textarea
            value={str("bodyText")}
            disabled={readonly}
            rows={8}
            onChange={(e) => set("bodyText", e.target.value)}
            className="text-sm"
          />
        </Field>
      </div>
    );
  }

  if (type === "event_rsvp") {
    return (
      <div className="grid gap-2">
        <Field label="Antwort">
          <Select
            value={str("partstat")}
            onValueChange={(v) => v && set("partstat", v)}
            items={[
              { value: "ACCEPTED", label: "Zusagen" },
              { value: "DECLINED", label: "Absagen" },
              { value: "TENTATIVE", label: "Vorbehalt" },
            ]}
            disabled={readonly}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACCEPTED">Zusagen</SelectItem>
              <SelectItem value="DECLINED">Absagen</SelectItem>
              <SelectItem value="TENTATIVE">Vorbehalt</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Kommentar an den Organisator (optional)">
          <Input value={str("comment")} disabled={readonly} onChange={(e) => set("comment", e.target.value)} />
        </Field>
      </div>
    );
  }

  if (type === "document_write") {
    return (
      <div className="grid gap-2">
        <Field label="Datei">
          <Input value={str("path")} disabled readOnly />
        </Field>
        <Field label="Neuer Inhalt">
          <Textarea
            value={str("newContent")}
            disabled={readonly}
            rows={10}
            onChange={(e) => set("newContent", e.target.value)}
            className="font-mono text-xs"
          />
        </Field>
      </div>
    );
  }

  if (type === "contact_upsert") {
    const fields = (payload.fields ?? {}) as Record<string, unknown>;
    const setField = (key: string, value: string) =>
      onChange({ ...payload, fields: { ...fields, [key]: value || undefined } });
    const emails = Array.isArray(payload.emails)
      ? (payload.emails as { email: string }[])
      : [];
    return (
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Vorname">
            <Input value={String(fields.firstName ?? "")} disabled={readonly} onChange={(e) => setField("firstName", e.target.value)} />
          </Field>
          <Field label="Nachname">
            <Input value={String(fields.lastName ?? "")} disabled={readonly} onChange={(e) => setField("lastName", e.target.value)} />
          </Field>
        </div>
        <Field label="Anzeigename">
          <Input value={String(fields.displayName ?? "")} disabled={readonly} onChange={(e) => setField("displayName", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Telefon">
            <Input value={String(fields.phone ?? "")} disabled={readonly} onChange={(e) => setField("phone", e.target.value)} />
          </Field>
          <Field label="Arbeitgeber">
            <Input value={String(fields.currentEmployer ?? "")} disabled={readonly} onChange={(e) => setField("currentEmployer", e.target.value)} />
          </Field>
        </div>
        <Field label="Notizen">
          <Textarea value={String(fields.notes ?? "")} disabled={readonly} rows={3} onChange={(e) => setField("notes", e.target.value)} className="text-sm" />
        </Field>
        {emails.length > 0 && (
          <p className="text-xs text-muted-foreground">
            E-Mail-Adressen: {emails.map((e) => e.email).join(", ")}
          </p>
        )}
      </div>
    );
  }

  if (type === "skill_update") {
    return (
      <div className="grid gap-2">
        <Field label="Begründung der Änderung">
          <Input value={str("changeSummary")} disabled={readonly} onChange={(e) => set("changeSummary", e.target.value)} />
        </Field>
        <Field label="Neuer Skill (Markdown)">
          <Textarea
            value={str("newMarkdown")}
            disabled={readonly}
            rows={12}
            onChange={(e) => set("newMarkdown", e.target.value)}
            className="font-mono text-xs"
          />
        </Field>
      </div>
    );
  }

  return (
    <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

export function DecisionCard({ decision }: { decision: RunDecision; runId: string }) {
  const queryClient = useQueryClient();
  const [payload, setPayload] = useState(decision.payload);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setPayload(decision.payload);
  }, [decision.payload, dirty]);

  const isOpen = decision.status === "open";

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (dirty) {
        await api.patch(`/api/decisions/${decision.id}`, { payload });
      }
      await api.post(`/api/decisions/${decision.id}/approve`);
    },
    onSuccess: () => {
      // Neutraler Hinweis — kein grünes „Erfolg", weil die Ausführung erst
      // asynchron läuft. Das Endergebnis (Ausgeführt/Fehlgeschlagen) zeigt die
      // Karte live über ihren Status.
      toast("Freigegeben — die Ausführung läuft.");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["decisions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/api/decisions/${decision.id}/reject`),
    onSuccess: () => {
      toast.success("Abgelehnt.");
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["decisions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{decision.title}</p>
        <Badge variant={statusVariant[decision.status] ?? "outline"}>
          {decisionStatusLabels[decision.status] ?? decision.status}
        </Badge>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {decisionTypeLabels[decision.type] ?? decision.type}
      </p>
      {decision.summary && <p className="mt-2 text-sm">{decision.summary}</p>}

      <div className="mt-3">
        <PayloadEditor
          type={decision.type}
          payload={payload}
          readonly={!isOpen}
          onChange={(p) => {
            setPayload(p);
            setDirty(true);
          }}
        />
      </div>

      {isOpen && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending || rejectMutation.isPending}
          >
            {approveMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Freigeben{dirty ? " (mit Änderungen)" : ""}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => rejectMutation.mutate()}
            disabled={approveMutation.isPending || rejectMutation.isPending}
          >
            <X className="size-4" /> Ablehnen
          </Button>
        </div>
      )}

      {decision.status === "executed" && decision.executionResult && (
        <p className="mt-3 rounded-md border border-green-300 bg-green-50 p-2 text-xs text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          Erfolgreich ausgeführt.
        </p>
      )}
      {decision.status === "failed" && decision.error && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          Ausführung fehlgeschlagen: {decision.error}
        </p>
      )}
    </div>
  );
}
