"use client";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { dataSourceTypeLabels } from "@agent-team/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import {
  AlertTriangle,
  Calendar,
  FolderOpen,
  Loader2,
  Mail,
  MoreVertical,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SourceFormDialog, type SourceListItem } from "./source-form-dialog";

const typeIcons = { email: Mail, caldav: Calendar, webdav: FolderOpen };

function StatusLine({ source }: { source: SourceListItem }) {
  if (source.lastSyncStatus === "running") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Synchronisiert …
      </span>
    );
  }
  if (source.lastSyncStatus === "error") {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive" title={source.lastError ?? undefined}>
        <AlertTriangle className="size-3" />
        Fehler: {source.lastError?.slice(0, 80) ?? "unbekannt"}
      </span>
    );
  }
  if (source.lastSyncAt) {
    return (
      <span className="text-xs text-muted-foreground">
        Zuletzt synchronisiert{" "}
        {formatDistanceToNow(new Date(source.lastSyncAt), { addSuffix: true, locale: de })}
        {!source.baselineCompletedAt && " · Baseline läuft"}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Noch nie synchronisiert</span>;
}

export function SourcesPanel() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editSource, setEditSource] = useState<SourceListItem | undefined>();

  const { data: sources, isLoading } = useQuery({
    queryKey: ["sources"],
    queryFn: () => api.get<SourceListItem[]>("/api/sources"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/sources/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources"] }),
    onError: (err) => toast.error(err.message),
  });

  const syncNowMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/sources/${id}/sync-now`),
    onSuccess: () => toast.success("Synchronisation angestoßen."),
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/sources/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success("Datenquelle gelöscht.");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Alle Quellen werden alle 5 Minuten auf neue Einträge geprüft.
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditSource(undefined);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" /> Datenquelle
        </Button>
      </div>

      {isLoading && (
        <div className="grid gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      )}

      {sources?.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Noch keine Datenquellen. Lege ein Postfach, einen Kalender oder einen
            Dokumenten-Speicher an.
          </CardContent>
        </Card>
      )}

      {sources?.map((source) => {
        const Icon = typeIcons[source.type];
        return (
          <Card key={source.id}>
            <CardContent className="flex items-center gap-4 py-4">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white"
                style={{ backgroundColor: source.color }}
              >
                <Icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{source.name}</span>
                  <Badge variant="secondary">
                    {dataSourceTypeLabels[source.type]}
                    {source.config.protocol === "ews" ? " · Exchange" : ""}
                  </Badge>
                </div>
                <StatusLine source={source} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                title="Jetzt synchronisieren"
                onClick={() => syncNowMutation.mutate(source.id)}
              >
                <RefreshCw className="size-4" />
              </Button>
              <Switch
                checked={source.enabled}
                onCheckedChange={(enabled) =>
                  toggleMutation.mutate({ id: source.id, enabled })
                }
                title={source.enabled ? "Aktiv" : "Pausiert"}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditSource(source);
                      setDialogOpen(true);
                    }}
                  >
                    Bearbeiten
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      if (
                        window.confirm(
                          `„${source.name}" wirklich löschen? Alle synchronisierten Daten dieser Quelle werden entfernt.`,
                        )
                      ) {
                        deleteMutation.mutate(source.id);
                      }
                    }}
                  >
                    Löschen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardContent>
          </Card>
        );
      })}

      <SourceFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        source={editSource}
      />
    </div>
  );
}
