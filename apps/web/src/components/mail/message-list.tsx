"use client";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useInfiniteQuery } from "@tanstack/react-query";
import { format, isToday, isThisYear } from "date-fns";
import { de } from "date-fns/locale";
import { Paperclip, Star } from "lucide-react";
import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import type { MailAccount, MailListItem, MailScope } from "./types";

export interface MailFilters {
  unread: boolean;
  hasAttachments: boolean;
}

function formatMailDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isThisYear(d)) return format(d, "d. MMM", { locale: de });
  return format(d, "dd.MM.yy");
}

function buildQueryString(scope: MailScope, filters: MailFilters): string {
  const params = new URLSearchParams();
  if (scope.kind === "account") params.set("accountId", scope.accountId);
  if (scope.kind === "folder") params.set("folderId", scope.folderId);
  if (filters.unread) params.set("unread", "1");
  if (filters.hasAttachments) params.set("hasAttachments", "1");
  return params.toString();
}

export function MessageList({
  scope,
  filters,
  accounts,
  selectedId,
  onSelect,
}: {
  scope: MailScope;
  filters: MailFilters;
  accounts: MailAccount[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const colorByAccount = useMemo(
    () => new Map(accounts.map((a) => [a.accountId, a.color])),
    [accounts],
  );
  const qs = buildQueryString(scope, filters);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["mail", "messages", qs],
      queryFn: ({ pageParam }) =>
        api.get<{ messages: MailListItem[]; nextCursor: string | null }>(
          `/api/mail/messages?${qs}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        ),
      initialPageParam: "",
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    });

  const messages = useMemo(
    () => data?.pages.flatMap((p) => p.messages) ?? [],
    [data],
  );

  if (isLoading) {
    return (
      <div className="grid gap-2 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Keine E-Mails in dieser Ansicht.
      </div>
    );
  }

  return (
    <Virtuoso
      data={messages}
      endReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}
      itemContent={(_index, msg) => (
        <button
          onClick={() => onSelect(msg.id)}
          className={cn(
            "relative flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left transition-colors",
            selectedId === msg.id ? "bg-accent" : "hover:bg-accent/40",
          )}
        >
          <span
            className="absolute inset-y-1 left-0 w-1 rounded-r"
            style={{ backgroundColor: colorByAccount.get(msg.accountId) ?? "#999" }}
          />
          <div className="flex items-baseline gap-2 pl-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                msg.seen ? "text-muted-foreground" : "font-semibold",
              )}
            >
              {msg.fromName || msg.fromEmail || "Unbekannt"}
            </span>
            {msg.flagged && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
            {msg.hasAttachments && <Paperclip className="size-3 shrink-0 text-muted-foreground" />}
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {formatMailDate(msg.sentAt)}
            </span>
          </div>
          <span
            className={cn(
              "truncate pl-2 text-sm",
              msg.seen ? "text-muted-foreground" : "font-medium",
            )}
          >
            {msg.subject || "(kein Betreff)"}
          </span>
          <span className="truncate pl-2 text-xs text-muted-foreground">
            {msg.snippet}
          </span>
        </button>
      )}
    />
  );
}
