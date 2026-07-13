"use client";

import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bot,
  Calendar,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Mail,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/mail", label: "Mail", icon: Mail },
  { href: "/kalender", label: "Kalender", icon: Calendar },
  { href: "/dokumente", label: "Dokumente", icon: FolderOpen },
  { href: "/agenten", label: "Agenten", icon: Bot },
  { href: "/kontakte", label: "Kontakte", icon: Users },
] as const;

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={href}
            aria-label={label}
            className={cn(
              "flex size-10 items-center justify-center rounded-lg transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-5" />
          </Link>
        }
      />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function IconRail() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <TooltipProvider>
      {/* Desktop: linke Icon-Rail */}
      <aside className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-3 md:flex">
        <Link
          href="/dashboard"
          aria-label="Agent Team"
          className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"
        >
          <Bot className="size-5" />
        </Link>
        {navItems.map((item) => (
          <NavLink
            key={item.href}
            {...item}
            active={pathname.startsWith(item.href)}
          />
        ))}
        <div className="mt-auto flex flex-col items-center gap-1">
          <NavLink
            href="/einstellungen"
            label="Einstellungen"
            icon={Settings}
            active={pathname.startsWith("/einstellungen")}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={logout}
                  aria-label="Abmelden"
                  className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <LogOut className="size-5" />
                </button>
              }
            />
            <TooltipContent side="right">Abmelden</TooltipContent>
          </Tooltip>
        </div>
      </aside>

      {/* Mobile: Bottom-Bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t bg-background/95 backdrop-blur md:hidden">
        {[...navItems, { href: "/einstellungen", label: "Einstellungen", icon: Settings }].map(
          (item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                className={cn(
                  "flex size-10 items-center justify-center rounded-lg",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" />
              </Link>
            );
          },
        )}
      </nav>
    </TooltipProvider>
  );
}
