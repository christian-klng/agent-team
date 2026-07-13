"use client";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DataSourceType } from "@agent-team/shared";
import { dataSourceTypeLabels } from "@agent-team/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlugZap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export interface SourceListItem {
  id: string;
  type: DataSourceType;
  name: string;
  color: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: "ok" | "error" | "running" | null;
  lastError: string | null;
  baselineCompletedAt: string | null;
  config: Record<string, unknown>;
}

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#64748b",
];

type FormState = Record<string, string | boolean>;

function initialForm(source?: SourceListItem): FormState {
  const c = source?.config ?? {};
  return {
    name: source?.name ?? "",
    color: source?.color ?? "#3b82f6",
    imapHost: String(c.imapHost ?? ""),
    imapPort: String(c.imapPort ?? "993"),
    imapTls: c.imapTls === undefined ? true : Boolean(c.imapTls),
    imapUser: String(c.imapUser ?? ""),
    imapPassword: "",
    smtpHost: String(c.smtpHost ?? ""),
    smtpPort: String(c.smtpPort ?? "465"),
    smtpUser: String(c.smtpUser ?? ""),
    smtpPassword: "",
    fromAddress: String(c.fromAddress ?? ""),
    fromName: String(c.fromName ?? ""),
    serverUrl: String(c.serverUrl ?? ""),
    username: String(c.username ?? ""),
    password: "",
    baseUrl: String(c.baseUrl ?? ""),
    rootPath: String(c.rootPath ?? "/"),
  };
}

function buildConfig(type: DataSourceType, f: FormState, forUpdate: boolean) {
  if (type === "email") {
    const cfg: Record<string, unknown> = {
      imapHost: f.imapHost,
      imapPort: Number(f.imapPort),
      imapTls: Boolean(f.imapTls),
      imapUser: f.imapUser,
      smtpHost: f.smtpHost,
      smtpPort: Number(f.smtpPort),
      smtpUser: f.smtpUser,
      fromAddress: f.fromAddress,
      fromName: f.fromName || undefined,
    };
    if (!forUpdate || f.imapPassword) cfg.imapPassword = f.imapPassword;
    if (!forUpdate || f.smtpPassword) cfg.smtpPassword = f.smtpPassword;
    return cfg;
  }
  if (type === "caldav") {
    const cfg: Record<string, unknown> = { serverUrl: f.serverUrl, username: f.username };
    if (!forUpdate || f.password) cfg.password = f.password;
    return cfg;
  }
  const cfg: Record<string, unknown> = {
    baseUrl: f.baseUrl,
    username: f.username,
    rootPath: f.rootPath || "/",
  };
  if (!forUpdate || f.password) cfg.password = f.password;
  return cfg;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export function SourceFormDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: SourceListItem;
}) {
  const isEdit = !!source;
  const queryClient = useQueryClient();
  const [type, setType] = useState<DataSourceType>(source?.type ?? "email");
  const [form, setForm] = useState<FormState>(() => initialForm(source));
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (open) {
      setType(source?.type ?? "email");
      setForm(initialForm(source));
      setTestResult(null);
    }
  }, [open, source]);

  const set = (key: string) => (value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        await api.patch(`/api/sources/${source.id}`, {
          name: form.name,
          color: form.color,
          config: buildConfig(type, form, true),
        });
      } else {
        await api.post("/api/sources", {
          type,
          name: form.name,
          color: form.color,
          config: buildConfig(type, form, false),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success(isEdit ? "Datenquelle aktualisiert." : "Datenquelle angelegt.");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (isEdit && !hasNewCredentials()) {
        return api.post<{ ok: boolean; message: string }>(`/api/sources/${source.id}/test`);
      }
      return api.post<{ ok: boolean; message: string }>("/api/sources/test", {
        type,
        name: form.name || "Test",
        color: form.color,
        config: buildConfig(type, form, false),
      });
    },
    onSuccess: (res) => setTestResult(res),
    onError: (err) => setTestResult({ ok: false, message: err.message }),
  });

  function hasNewCredentials() {
    return type === "email"
      ? !!(form.imapPassword || form.smtpPassword)
      : !!form.password;
  }

  const pwPlaceholder = isEdit ? "•••••• (unverändert)" : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Datenquelle bearbeiten" : "Neue Datenquelle"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Zugangsdaten leer lassen, um sie unverändert zu übernehmen."
              : "Die Quelle wird alle 5 Minuten auf neue Einträge geprüft."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!isEdit && (
            <Field label="Typ">
              <Select
                value={type}
                onValueChange={(v) => setType(v as DataSourceType)}
                items={[
                  { value: "email", label: `${dataSourceTypeLabels.email} (IMAP/SMTP)` },
                  { value: "caldav", label: `${dataSourceTypeLabels.caldav} (CalDAV)` },
                  { value: "webdav", label: `${dataSourceTypeLabels.webdav} (WebDAV/NextCloud)` },
                ]}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">{dataSourceTypeLabels.email} (IMAP/SMTP)</SelectItem>
                  <SelectItem value="caldav">{dataSourceTypeLabels.caldav} (CalDAV)</SelectItem>
                  <SelectItem value="webdav">{dataSourceTypeLabels.webdav} (WebDAV/NextCloud)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <Field label="Name">
              <Input
                value={String(form.name)}
                onChange={(e) => set("name")(e.target.value)}
                placeholder={type === "email" ? "z. B. iCloud Privat" : "z. B. Firmen-Kalender"}
              />
            </Field>
            <div className="flex gap-1 pb-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Farbe ${c}`}
                  onClick={() => set("color")(c)}
                  className="size-5 rounded-full border-2"
                  style={{
                    backgroundColor: c,
                    borderColor: form.color === c ? "var(--foreground)" : "transparent",
                  }}
                />
              ))}
            </div>
          </div>

          {type === "email" && (
            <>
              <p className="text-xs font-medium text-muted-foreground">IMAP (Empfang)</p>
              <div className="grid grid-cols-[1fr_90px] gap-3">
                <Field label="Host">
                  <Input value={String(form.imapHost)} onChange={(e) => set("imapHost")(e.target.value)} placeholder="imap.mail.me.com" />
                </Field>
                <Field label="Port">
                  <Input value={String(form.imapPort)} onChange={(e) => set("imapPort")(e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Benutzer">
                  <Input value={String(form.imapUser)} onChange={(e) => set("imapUser")(e.target.value)} />
                </Field>
                <Field label="Passwort (App-Passwort)">
                  <Input type="password" value={String(form.imapPassword)} onChange={(e) => set("imapPassword")(e.target.value)} placeholder={pwPlaceholder} />
                </Field>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={Boolean(form.imapTls)} onCheckedChange={set("imapTls")} />
                <Label className="text-xs">TLS/SSL</Label>
              </div>

              <p className="text-xs font-medium text-muted-foreground">SMTP (Versand)</p>
              <div className="grid grid-cols-[1fr_90px] gap-3">
                <Field label="Host">
                  <Input value={String(form.smtpHost)} onChange={(e) => set("smtpHost")(e.target.value)} placeholder="smtp.mail.me.com" />
                </Field>
                <Field label="Port">
                  <Input value={String(form.smtpPort)} onChange={(e) => set("smtpPort")(e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Benutzer">
                  <Input value={String(form.smtpUser)} onChange={(e) => set("smtpUser")(e.target.value)} />
                </Field>
                <Field label="Passwort">
                  <Input type="password" value={String(form.smtpPassword)} onChange={(e) => set("smtpPassword")(e.target.value)} placeholder={pwPlaceholder} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Absender-Adresse">
                  <Input value={String(form.fromAddress)} onChange={(e) => set("fromAddress")(e.target.value)} placeholder="ich@example.com" />
                </Field>
                <Field label="Absender-Name (optional)">
                  <Input value={String(form.fromName)} onChange={(e) => set("fromName")(e.target.value)} />
                </Field>
              </div>
            </>
          )}

          {type === "caldav" && (
            <>
              <Field label="Server-URL">
                <Input value={String(form.serverUrl)} onChange={(e) => set("serverUrl")(e.target.value)} placeholder="https://caldav.icloud.com" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Benutzer">
                  <Input value={String(form.username)} onChange={(e) => set("username")(e.target.value)} />
                </Field>
                <Field label="Passwort (App-Passwort)">
                  <Input type="password" value={String(form.password)} onChange={(e) => set("password")(e.target.value)} placeholder={pwPlaceholder} />
                </Field>
              </div>
            </>
          )}

          {type === "webdav" && (
            <>
              <Field label="WebDAV-URL">
                <Input value={String(form.baseUrl)} onChange={(e) => set("baseUrl")(e.target.value)} placeholder="https://cloud.example.com/remote.php/dav/files/user" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Benutzer">
                  <Input value={String(form.username)} onChange={(e) => set("username")(e.target.value)} />
                </Field>
                <Field label="Passwort (App-Passwort)">
                  <Input type="password" value={String(form.password)} onChange={(e) => set("password")(e.target.value)} placeholder={pwPlaceholder} />
                </Field>
              </div>
              <Field label="Root-Pfad (begrenzt den Zugriff)">
                <Input value={String(form.rootPath)} onChange={(e) => set("rootPath")(e.target.value)} placeholder="/Projekte" />
              </Field>
            </>
          )}

          {testResult && (
            <p
              className={`rounded-md border px-3 py-2 text-xs ${
                testResult.ok
                  ? "border-green-300 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              {testResult.message}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlugZap className="size-4" />
            )}
            Verbindung testen
          </Button>
          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.name}
          >
            {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
