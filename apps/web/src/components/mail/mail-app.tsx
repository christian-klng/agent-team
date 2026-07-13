"use client";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Paperclip, MailOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FolderColumn } from "./folder-column";
import { MessageList, type MailFilters } from "./message-list";
import { Reader } from "./reader";
import type { MailAccount, MailScope } from "./types";

export function MailApp() {
  const router = useRouter();
  const [scope, setScope] = useState<MailScope>({ kind: "unified" });
  const [filters, setFilters] = useState<MailFilters>({
    unread: false,
    hasAttachments: false,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Mobile: list → reader Navigation
  const [mobilePane, setMobilePane] = useState<"folders" | "list" | "reader">("list");

  const { data: accounts = [] } = useQuery({
    queryKey: ["mail", "accounts"],
    queryFn: () => api.get<MailAccount[]>("/api/mail/accounts"),
  });

  function selectMessage(id: string) {
    setSelectedId(id);
    setMobilePane("reader");
  }

  function changeScope(next: MailScope) {
    setScope(next);
    setSelectedId(null);
    setMobilePane("list");
  }

  function createContact(email: string, name: string | null) {
    const params = new URLSearchParams({ email, ...(name ? { name } : {}) });
    router.push(`/kontakte?neu=1&${params.toString()}`);
  }

  return (
    <div className="flex h-full">
      {/* Ordner-Spalte */}
      <div
        className={cn(
          "w-full shrink-0 border-r bg-sidebar md:block md:w-56",
          mobilePane === "folders" ? "block" : "hidden",
        )}
      >
        <FolderColumn accounts={accounts} scope={scope} onScopeChange={changeScope} />
      </div>

      {/* Nachrichtenliste */}
      <div
        className={cn(
          "w-full min-w-0 shrink-0 flex-col border-r md:flex md:w-80 lg:w-96",
          mobilePane === "list" ? "flex" : "hidden md:flex",
        )}
      >
        <div className="flex shrink-0 items-center gap-1 border-b p-2">
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden"
            onClick={() => setMobilePane("folders")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Button
            variant={filters.unread ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilters((f) => ({ ...f, unread: !f.unread }))}
          >
            <MailOpen className="size-3.5" /> Ungelesen
          </Button>
          <Button
            variant={filters.hasAttachments ? "secondary" : "ghost"}
            size="sm"
            onClick={() =>
              setFilters((f) => ({ ...f, hasAttachments: !f.hasAttachments }))
            }
          >
            <Paperclip className="size-3.5" /> Anhang
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <MessageList
            scope={scope}
            filters={filters}
            accounts={accounts}
            selectedId={selectedId}
            onSelect={selectMessage}
          />
        </div>
      </div>

      {/* Reader */}
      <div
        className={cn(
          "min-w-0 flex-1 flex-col md:flex",
          mobilePane === "reader" ? "flex" : "hidden md:flex",
        )}
      >
        {mobilePane === "reader" && (
          <Button
            variant="ghost"
            size="sm"
            className="m-2 self-start md:hidden"
            onClick={() => setMobilePane("list")}
          >
            <ArrowLeft className="size-4" /> Zurück
          </Button>
        )}
        <div className="min-h-0 flex-1">
          <Reader
            messageId={selectedId}
            onCreateContact={createContact}
            onSendToAgent={() =>
              toast.info("Manuelle Agent-Zuweisung kommt mit den Agenten (M4).")
            }
          />
        </div>
      </div>
    </div>
  );
}
