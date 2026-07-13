import { SourcesPanel } from "@/components/settings/sources-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function EinstellungenPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <h1 className="mb-6 text-xl font-semibold">Einstellungen</h1>
        <Tabs defaultValue="quellen">
          <TabsList>
            <TabsTrigger value="quellen">Datenquellen</TabsTrigger>
            <TabsTrigger value="konto">Konto</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>
          <TabsContent value="quellen" className="mt-4">
            <SourcesPanel />
          </TabsContent>
          <TabsContent value="konto" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Konto</CardTitle>
                <CardDescription>
                  Einzelnutzer-Instanz. Passwort-Änderung erfolgt über das
                  Seed-Script auf dem Server (scripts/seed-user.ts).
                </CardDescription>
              </CardHeader>
            </Card>
          </TabsContent>
          <TabsContent value="system" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">System</CardTitle>
                <CardDescription>
                  LLM-Anbindung über LiteLLM-Gateway (OpenRouter/Cortecs) — konfiguriert
                  per Umgebungsvariablen. Details siehe README.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <ul className="list-disc pl-4">
                  <li>Sync-Intervall: 5 Minuten</li>
                  <li>Agent-Sessions und Workspaces liegen im Worker-Volume</li>
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
