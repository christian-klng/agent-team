"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  ArrowLeft,
  FileText,
  Loader2,
  Mail,
  Plus,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface ContactEmail {
  id: string;
  email: string;
  label: string | null;
  isPrimary: boolean;
}

interface ContactListItem {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  currentEmployer: string | null;
  pastEmployers: { name: string; from?: string; to?: string }[];
  notes: string | null;
  emails: ContactEmail[];
}

interface ContactDetail extends ContactListItem {
  docLinks: { id: string; storeId: string; path: string; includeChildren: boolean }[];
  recentMails: {
    id: string;
    subject: string;
    sentAt: string | null;
    fromEmail: string | null;
    snippet: string;
  }[];
}

interface Store {
  storeId: string;
  name: string;
}

function CreateContactDialog({
  open,
  onOpenChange,
  initialEmail,
  initialName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEmail?: string;
  initialName?: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName ?? "");
  const [email, setEmail] = useState(initialEmail ?? "");

  useEffect(() => {
    if (open) {
      setName(initialName ?? "");
      setEmail(initialEmail ?? "");
    }
  }, [open, initialEmail, initialName]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/api/contacts", {
        displayName: name,
        emails: email ? [{ email, isPrimary: true }] : [],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Kontakt angelegt.");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Neuer Kontakt</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Anna Weber" />
          </div>
          <div className="grid gap-1.5">
            <Label>E-Mail (optional)</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="anna@example.com" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactDetailPane({
  contactId,
  onBack,
  onDeleted,
}: {
  contactId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: contact, isLoading } = useQuery({
    queryKey: ["contacts", contactId],
    queryFn: () => api.get<ContactDetail>(`/api/contacts/${contactId}`),
  });
  const { data: stores = [] } = useQuery({
    queryKey: ["docs", "stores"],
    queryFn: () => api.get<Store[]>("/api/docs/stores"),
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const [emailsText, setEmailsText] = useState("");
  const [linkPath, setLinkPath] = useState("");
  const [linkStore, setLinkStore] = useState<string | null>(null);

  useEffect(() => {
    if (contact) {
      setForm({
        displayName: contact.displayName,
        firstName: contact.firstName ?? "",
        lastName: contact.lastName ?? "",
        phone: contact.phone ?? "",
        currentEmployer: contact.currentEmployer ?? "",
        notes: contact.notes ?? "",
      });
      setEmailsText(contact.emails.map((e) => e.email).join(", "));
    }
  }, [contact]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/contacts/${contactId}`, {
        displayName: form.displayName,
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        phone: form.phone || null,
        currentEmployer: form.currentEmployer || null,
        notes: form.notes || null,
        emails: emailsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((email, i) => ({ email, isPrimary: i === 0 })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Gespeichert.");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/contacts/${contactId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Kontakt gelöscht.");
      onDeleted();
    },
    onError: (err) => toast.error(err.message),
  });

  const addLinkMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/contacts/${contactId}/doc-links`, {
        storeId: linkStore,
        path: linkPath,
        includeChildren: linkPath.endsWith("/") || !linkPath.includes("."),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] });
      setLinkPath("");
      toast.success("Dokument verknüpft.");
    },
    onError: (err) => toast.error(err.message),
  });

  const removeLinkMutation = useMutation({
    mutationFn: (linkId: string) =>
      api.delete(`/api/contacts/${contactId}/doc-links?linkId=${linkId}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["contacts", contactId] }),
    onError: (err) => toast.error(err.message),
  });

  if (isLoading || !contact) {
    return (
      <div className="grid gap-3 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <Button variant="ghost" size="sm" className="mb-3 md:hidden" onClick={onBack}>
        <ArrowLeft className="size-4" /> Zurück
      </Button>

      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <User className="size-6" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {contact.displayName}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (window.confirm(`Kontakt „${contact.displayName}" löschen?`)) {
              deleteMutation.mutate();
            }
          }}
          aria-label="Löschen"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="grid max-w-lg gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Vorname</Label>
            <Input value={form.firstName ?? ""} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Nachname</Label>
            <Input value={form.lastName ?? ""} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Anzeigename</Label>
          <Input value={form.displayName ?? ""} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">E-Mail-Adressen (kommagetrennt, erste = primär)</Label>
          <Input value={emailsText} onChange={(e) => setEmailsText(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Telefon</Label>
            <Input value={form.phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Aktueller Arbeitgeber</Label>
            <Input value={form.currentEmployer ?? ""} onChange={(e) => setForm((f) => ({ ...f, currentEmployer: e.target.value }))} />
          </div>
        </div>
        {contact.pastEmployers.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Frühere Arbeitgeber: {contact.pastEmployers.map((p) => p.name).join(", ")}
          </p>
        )}
        <div className="grid gap-1.5">
          <Label className="text-xs">Notizen</Label>
          <Textarea rows={4} value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="text-sm" />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Speichern
          </Button>
        </div>

        {/* Dokument-Verknüpfungen */}
        <div className="mt-2 rounded-lg border p-3">
          <p className="mb-2 text-sm font-medium">Verknüpfte Dokumente</p>
          <p className="mb-2 text-xs text-muted-foreground">
            Agenten lesen diese Dokumente bei Bedarf, um bessere Vorschläge zu
            diesem Kontakt zu machen.
          </p>
          <div className="grid gap-1.5">
            {contact.docLinks.map((link) => (
              <div key={link.id} className="flex items-center gap-2 text-sm">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {link.path}
                  {link.includeChildren && (
                    <Badge variant="secondary" className="ml-1.5">
                      inkl. Unterordner
                    </Badge>
                  )}
                </span>
                <button
                  onClick={() => removeLinkMutation.mutate(link.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Verknüpfung entfernen"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {contact.docLinks.length === 0 && (
              <p className="text-xs text-muted-foreground">Noch keine Verknüpfungen.</p>
            )}
          </div>
          {stores.length > 0 && (
            <div className="mt-3 flex items-end gap-2">
              <div className="grid flex-1 gap-1.5">
                <Label className="text-xs">Pfad (Datei oder Ordner)</Label>
                <Input
                  value={linkPath}
                  onChange={(e) => setLinkPath(e.target.value)}
                  placeholder="/Projekte/kunde-x"
                />
              </div>
              <Select
                value={linkStore ?? stores[0]?.storeId ?? ""}
                onValueChange={(v) => setLinkStore(v)}
                items={stores.map((s) => ({ value: s.storeId, label: s.name }))}
              >
                <SelectTrigger className="h-8 w-36">
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
              <Button
                size="sm"
                variant="outline"
                disabled={!linkPath || addLinkMutation.isPending}
                onClick={() => {
                  if (!linkStore && stores[0]) setLinkStore(stores[0].storeId);
                  addLinkMutation.mutate();
                }}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Letzte Mails */}
        <div className="mt-2 rounded-lg border p-3">
          <p className="mb-2 text-sm font-medium">Letzte E-Mails</p>
          <div className="grid gap-1.5">
            {contact.recentMails.map((mail) => (
              <button
                key={mail.id}
                onClick={() => router.push("/mail")}
                className="flex items-start gap-2 rounded-md p-1.5 text-left hover:bg-accent/50"
              >
                <Mail className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{mail.subject || "(kein Betreff)"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {mail.sentAt && format(new Date(mail.sentAt), "d. MMM yyyy", { locale: de })} · {mail.snippet}
                  </span>
                </span>
              </button>
            ))}
            {contact.recentMails.length === 0 && (
              <p className="text-xs text-muted-foreground">Keine E-Mails gefunden.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ContactsApp({
  initialCreate,
  initialEmail,
  initialName,
}: {
  initialCreate?: boolean;
  initialEmail?: string;
  initialName?: string;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // "Als Kontakt anlegen" aus der Mail-Ansicht (?neu=1&email=...&name=...)
  const [createOpen, setCreateOpen] = useState(!!initialCreate);

  const { data: contacts, isLoading } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => api.get<ContactListItem[]>("/api/contacts"),
  });

  return (
    <div className="flex h-full">
      <div
        className={cn(
          "w-full flex-col border-r md:flex md:w-72",
          selectedId ? "hidden md:flex" : "flex",
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b p-3">
          <h1 className="text-sm font-semibold">Kontakte</h1>
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Neu
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && (
            <div className="grid gap-2 p-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          )}
          {contacts?.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Noch keine Kontakte. Lege Kontakte an — oder nutze „Als Kontakt
              anlegen" in der Mail-Ansicht.
            </p>
          )}
          {contacts?.map((contact) => (
            <button
              key={contact.id}
              onClick={() => setSelectedId(contact.id)}
              className={cn(
                "flex w-full items-center gap-3 border-b px-3 py-2.5 text-left",
                selectedId === contact.id ? "bg-accent" : "hover:bg-accent/40",
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <User className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {contact.displayName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {contact.emails[0]?.email ?? contact.currentEmployer ?? ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={cn("min-w-0 flex-1", selectedId ? "block" : "hidden md:block")}>
        {selectedId ? (
          <ContactDetailPane
            contactId={selectedId}
            onBack={() => setSelectedId(null)}
            onDeleted={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <User className="size-8" />
            <p className="text-sm">Wähle einen Kontakt aus.</p>
          </div>
        )}
      </div>

      <CreateContactDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open && initialCreate) router.replace("/kontakte");
        }}
        initialEmail={initialEmail}
        initialName={initialName}
      />
    </div>
  );
}

