import { IconRail } from "@/components/icon-rail";
import { Providers } from "@/components/providers";
import { RunPanel } from "@/components/run-panel";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <Providers>
      <div className="flex h-dvh overflow-hidden">
        <IconRail />
        <main className="min-w-0 flex-1 overflow-hidden pb-14 md:pb-0">{children}</main>
        <RunPanel />
      </div>
    </Providers>
  );
}
