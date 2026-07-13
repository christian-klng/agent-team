"use client";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { ChevronRight, File, FileText, Folder, HardDrive, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface Store {
  storeId: string;
  name: string;
  color: string;
  rootPath: string;
}

interface DocFile {
  id: string;
  path: string;
  name: string;
  isDir: boolean;
  size: number | null;
  mime: string | null;
  modifiedAt: string | null;
}

function formatBytes(size: number | null): string {
  if (size === null) return "–";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} kB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function DocsApp() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [path, setPath] = useState("/");
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const { data: stores = [] } = useQuery({
    queryKey: ["docs", "stores"],
    queryFn: () => api.get<Store[]>("/api/docs/stores"),
  });

  useEffect(() => {
    if (!storeId && stores.length > 0) {
      setStoreId(stores[0]!.storeId);
      setPath(stores[0]!.rootPath || "/");
    }
  }, [stores, storeId]);

  const activeStore = stores.find((s) => s.storeId === storeId);
  const rootPath = activeStore?.rootPath || "/";

  const { data: files = [], isLoading } = useQuery({
    queryKey: ["docs", "files", storeId, path],
    queryFn: () =>
      api.get<DocFile[]>(
        `/api/docs/files?storeId=${storeId}&path=${encodeURIComponent(path)}`,
      ),
    enabled: !!storeId,
  });

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ["docs", "content", storeId, previewPath],
    queryFn: () =>
      api.get<{ name: string; content: string }>(
        `/api/docs/content?storeId=${storeId}&path=${encodeURIComponent(previewPath!)}`,
      ),
    enabled: !!storeId && !!previewPath,
    retry: false,
  });

  const breadcrumbs = useMemo(() => {
    const crumbs: { label: string; path: string }[] = [
      { label: activeStore?.name ?? "Speicher", path: rootPath },
    ];
    if (path !== rootPath) {
      const rel = path.startsWith(rootPath === "/" ? "/" : `${rootPath}/`)
        ? path.slice(rootPath === "/" ? 1 : rootPath.length + 1)
        : path.slice(1);
      let acc = rootPath === "/" ? "" : rootPath;
      for (const part of rel.split("/")) {
        acc = `${acc}/${part}`;
        crumbs.push({ label: part, path: acc });
      }
    }
    return crumbs;
  }, [path, rootPath, activeStore?.name]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
        <HardDrive className="ml-1 size-4 text-muted-foreground" />
        <Select
          value={storeId ?? ""}
          onValueChange={(v) => {
            setStoreId(v);
            const store = stores.find((s) => s.storeId === v);
            setPath(store?.rootPath || "/");
            setPreviewPath(null);
          }}
          items={stores.map((s) => ({ value: s.storeId, label: s.name }))}
        >
          <SelectTrigger className="h-8 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {stores.map((s) => (
              <SelectItem key={s.storeId} value={s.storeId}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex shrink-0 items-center gap-0.5">
              {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground" />}
              <button
                onClick={() => {
                  setPath(crumb.path);
                  setPreviewPath(null);
                }}
                className={cn(
                  "rounded px-1.5 py-0.5 hover:bg-accent",
                  i === breadcrumbs.length - 1
                    ? "font-medium"
                    : "text-muted-foreground",
                )}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn("min-w-0 flex-1 overflow-y-auto", previewPath && "hidden md:block")}>
          {isLoading ? (
            <div className="grid gap-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {stores.length === 0
                ? "Kein Dokumenten-Speicher verbunden. Lege in den Einstellungen eine WebDAV-Datenquelle an."
                : "Dieser Ordner ist leer."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="p-2 pl-4 font-medium">Name</th>
                  <th className="w-24 p-2 font-medium">Größe</th>
                  <th className="hidden w-40 p-2 font-medium sm:table-cell">Geändert</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr
                    key={file.id}
                    className="cursor-pointer border-b hover:bg-accent/40"
                    onClick={() => {
                      if (file.isDir) {
                        setPath(file.path);
                        setPreviewPath(null);
                      } else {
                        setPreviewPath(file.path);
                      }
                    }}
                  >
                    <td className="flex items-center gap-2 p-2 pl-4">
                      {file.isDir ? (
                        <Folder className="size-4 shrink-0 text-blue-500" />
                      ) : /\.(md|txt|csv)$/i.test(file.name) ? (
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <File className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{file.name}</span>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {file.isDir ? "–" : formatBytes(file.size)}
                    </td>
                    <td className="hidden p-2 text-xs text-muted-foreground sm:table-cell">
                      {file.modifiedAt
                        ? format(new Date(file.modifiedAt), "d. MMM yyyy HH:mm", { locale: de })
                        : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {previewPath && (
          <div className="flex w-full min-w-0 flex-col border-l md:w-1/2">
            <div className="flex shrink-0 items-center justify-between border-b p-2">
              <p className="ml-2 truncate text-sm font-medium">
                {preview?.name ?? previewPath.split("/").pop()}
              </p>
              <Button variant="ghost" size="icon" onClick={() => setPreviewPath(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {previewLoading ? (
                <Skeleton className="h-40" />
              ) : preview ? (
                <pre className="font-mono text-xs whitespace-pre-wrap">{preview.content}</pre>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Keine Vorschau für dieses Format verfügbar.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
