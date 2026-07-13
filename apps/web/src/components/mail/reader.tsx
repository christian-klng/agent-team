"use client";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Download, ImageIcon, Mail, UserPlus, Bot } from "lucide-react";
import { useMemo, useState } from "react";
import type { MailDetail } from "./types";

function formatBytes(size: number | null): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} kB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Baut das srcdoc für den sandboxed Reader-iframe. Eine CSP-Meta blockiert
 * standardmäßig alle Remote-Inhalte; erst "Bilder laden" erlaubt https-Bilder.
 */
function buildSrcDoc(html: string, allowRemote: boolean): string {
  const imgSrc = allowRemote ? "img-src https: http: cid: data:;" : "img-src cid: data:;";
  return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${imgSrc} style-src 'unsafe-inline'; font-src data:;">
<style>
  body { font-family: -apple-system, system-ui, sans-serif; font-size: 14px; line-height: 1.5;
         color: #1a1a1a; margin: 0; padding: 16px; word-break: break-word; background: #fff; }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; }
  blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 12px; color: #555; }
  pre { white-space: pre-wrap; }
</style></head><body>${html}</body></html>`;
}

export function Reader({
  messageId,
  onCreateContact,
  onSendToAgent,
}: {
  messageId: string | null;
  onCreateContact?: (email: string, name: string | null) => void;
  onSendToAgent?: (messageId: string) => void;
}) {
  const [allowRemote, setAllowRemote] = useState(false);

  const { data: msg, isLoading } = useQuery({
    queryKey: ["mail", "message", messageId],
    queryFn: () => api.get<MailDetail>(`/api/mail/messages/${messageId}`),
    enabled: !!messageId,
  });

  const srcDoc = useMemo(() => {
    if (!msg?.htmlSanitized) return null;
    return buildSrcDoc(msg.htmlSanitized, allowRemote);
  }, [msg?.htmlSanitized, allowRemote]);

  const hasRemoteImages = !!msg?.htmlSanitized && /src=["']https?:/i.test(msg.htmlSanitized);

  if (!messageId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Mail className="size-8" />
        <p className="text-sm">Wähle eine E-Mail aus.</p>
      </div>
    );
  }
  if (isLoading || !msg) {
    return (
      <div className="grid gap-3 p-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b p-4">
        <h2 className="text-base font-semibold">{msg.subject || "(kein Betreff)"}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{msg.fromName || msg.fromEmail}</span>
          {msg.fromName && msg.fromEmail && (
            <span className="text-muted-foreground">&lt;{msg.fromEmail}&gt;</span>
          )}
          {msg.sentAt && (
            <span className="ml-auto text-xs text-muted-foreground">
              {format(new Date(msg.sentAt), "EEEE, d. MMMM yyyy 'um' HH:mm", { locale: de })}
            </span>
          )}
        </div>
        {msg.toAddrs?.length > 0 && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            An: {msg.toAddrs.map((a) => a.name || a.address).join(", ")}
            {msg.ccAddrs?.length > 0 &&
              ` · CC: ${msg.ccAddrs.map((a) => a.name || a.address).join(", ")}`}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {msg.fromEmail && onCreateContact && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCreateContact(msg.fromEmail!, msg.fromName)}
            >
              <UserPlus className="size-3.5" /> Als Kontakt anlegen
            </Button>
          )}
          {onSendToAgent && (
            <Button size="sm" variant="outline" onClick={() => onSendToAgent(msg.id)}>
              <Bot className="size-3.5" /> An Agent senden
            </Button>
          )}
          {hasRemoteImages && !allowRemote && (
            <Button size="sm" variant="outline" onClick={() => setAllowRemote(true)}>
              <ImageIcon className="size-3.5" /> Bilder laden
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {srcDoc ? (
          <iframe
            key={allowRemote ? "remote" : "blocked"}
            title="E-Mail-Inhalt"
            sandbox=""
            srcDoc={srcDoc}
            className="h-full w-full border-0 bg-white"
          />
        ) : msg.textBody ? (
          <pre className="h-full overflow-auto p-4 font-sans text-sm whitespace-pre-wrap">
            {msg.textBody}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {msg.bodyAvailable ? "Kein Inhalt." : "Inhalt konnte nicht geladen werden."}
          </div>
        )}
      </div>

      {msg.attachments.length > 0 && (
        <div className="shrink-0 border-t p-3">
          <div className="flex flex-wrap gap-2">
            {msg.attachments.map((att) => (
              <a
                key={att.id}
                href={`/api/mail/messages/${msg.id}/attachments/${att.id}`}
                className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent"
              >
                <Download className="size-3" />
                {att.filename ?? "Anhang"}
                <span className="text-muted-foreground">{formatBytes(att.size)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
