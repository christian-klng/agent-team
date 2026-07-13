"use client";

import { cn } from "@/lib/utils";
import { Inbox, Send, Archive, Trash2, FileEdit, AlertOctagon, Folder, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { MailAccount, MailScope } from "./types";

const roleIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  inbox: Inbox,
  sent: Send,
  archive: Archive,
  trash: Trash2,
  drafts: FileEdit,
  spam: AlertOctagon,
  other: Folder,
};

const roleOrder = ["inbox", "sent", "drafts", "archive", "spam", "trash", "other"];

export function FolderColumn({
  accounts,
  scope,
  onScopeChange,
}: {
  accounts: MailAccount[];
  scope: MailScope;
  onScopeChange: (scope: MailScope) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const totalUnread = accounts.reduce(
    (sum, a) =>
      sum + a.folders.filter((f) => f.role === "inbox").reduce((s, f) => s + f.unread, 0),
    0,
  );

  return (
    <div className="flex h-full flex-col gap-0.5 overflow-y-auto p-2">
      <button
        onClick={() => onScopeChange({ kind: "unified" })}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          scope.kind === "unified"
            ? "bg-accent font-medium"
            : "text-muted-foreground hover:bg-accent/50",
        )}
      >
        <Inbox className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">Alle Postfächer</span>
        {totalUnread > 0 && (
          <span className="rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
            {totalUnread}
          </span>
        )}
      </button>

      {accounts.map((account) => {
        const isOpen = expanded[account.accountId] ?? true;
        const accountUnread = account.folders
          .filter((f) => f.role === "inbox")
          .reduce((s, f) => s + f.unread, 0);
        const folders = [...account.folders]
          .filter((f) => f.syncEnabled || f.unread > 0 || f.role !== "other")
          .sort(
            (a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role),
          );

        return (
          <div key={account.accountId} className="mt-2">
            <div
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-sm",
                scope.kind === "account" && scope.accountId === account.accountId
                  ? "bg-accent font-medium"
                  : "hover:bg-accent/50",
              )}
            >
              <button
                onClick={() =>
                  setExpanded((e) => ({ ...e, [account.accountId]: !isOpen }))
                }
                aria-label={isOpen ? "Zuklappen" : "Aufklappen"}
                className="rounded p-0.5 hover:bg-accent"
              >
                <ChevronRight
                  className={cn("size-3.5 transition-transform", isOpen && "rotate-90")}
                />
              </button>
              <button
                onClick={() =>
                  onScopeChange({ kind: "account", accountId: account.accountId })
                }
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: account.color }}
                />
                <span className="truncate font-medium">{account.name}</span>
                {accountUnread > 0 && (
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {accountUnread}
                  </span>
                )}
              </button>
            </div>

            {isOpen &&
              folders.map((folder) => {
                const Icon = roleIcons[folder.role] ?? Folder;
                const active =
                  scope.kind === "folder" && scope.folderId === folder.id;
                return (
                  <button
                    key={folder.id}
                    onClick={() =>
                      onScopeChange({
                        kind: "folder",
                        accountId: account.accountId,
                        folderId: folder.id,
                      })
                    }
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md py-1 pr-2 pl-7 text-sm",
                      active
                        ? "bg-accent font-medium"
                        : "text-muted-foreground hover:bg-accent/50",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="flex-1 truncate text-left">{folder.displayName}</span>
                    {folder.unread > 0 && (
                      <span className="text-[11px]">{folder.unread}</span>
                    )}
                  </button>
                );
              })}
          </div>
        );
      })}

      {accounts.length === 0 && (
        <p className="p-3 text-xs text-muted-foreground">
          Kein Mail-Konto verbunden. Lege in den Einstellungen eine
          E-Mail-Datenquelle an.
        </p>
      )}
    </div>
  );
}
