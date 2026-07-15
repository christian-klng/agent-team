# CLAUDE.md

Leitfaden für KI-Agenten (und Menschen), die an diesem Repo arbeiten. Ergänzt
die README (Nutzer-Sicht) um das, was man vor dem ersten Edit wissen muss.

## Was das ist

Selbst gehostete Web-App: CRM + Agenten-Plattform + Mail-/Kalender-/Dokumenten-
Aggregator. Datenquellen sind **Auslöser** für KI-Agenten und **Ziele** ihrer
Aktionen. pnpm-Monorepo: `apps/web` (Next 15), `apps/worker` (BullMQ),
`packages/db` (Drizzle/Postgres), `packages/core` (Konnektoren/Sync/Executors),
`packages/shared` (Zod-Schemas/Typen).

## Sicherheitsmodell — NICHT aufweichen

Agenten haben **ausschließlich Lese-Tools + `propose_decision`**. Es gibt kein
Tool, mit dem ein Agent senden, schreiben oder bestätigen kann. Jeder
Seiteneffekt läuft deterministisch über die Executors in
`packages/core/src/decisions/` — und nur nach expliziter Nutzer-Freigabe.
**Niemals** neue Schreib-/Sende-Tools an Agenten hängen; neue Aktionen immer als
`DecisionType` + Executor + UI-Freigabe modellieren.

## Lokale Entwicklung

```bash
pnpm install
pnpm dev:services      # eingebettetes Postgres (54329) + Redis (63790), kein Docker nötig
pnpm db:migrate        # Schema anlegen
pnpm seed:user         # Login-Nutzer aus SEED_USER_* (.env)
pnpm dev               # web (3000) + worker parallel
pnpm typecheck         # vor jedem Commit
```

Login lokal: `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` aus `.env`.

## Vor dem Pushen — Pflicht

- `pnpm typecheck` grün (alle Pakete).
- Beide Prod-Builds grün: `pnpm --filter web build`, `pnpm --filter worker build`.
- **Worker zusätzlich wirklich booten** (`node apps/worker/dist/index.js`): der
  tsup-Prod-Build ist natives ESM und deckt Fehler auf, die `tsx`/esbuild
  verschlucken (siehe CJS-Interop unten). Typecheck + Build allein reichen nicht.
- Committen/Pushen nur nach Freigabe des Nutzers (Christian).

## Deployment (Coolify auf Hetzner)

Flow: **push → GitHub Actions baut Images → Coolify Redeploy**. Der Server baut
**nicht** selbst (zu wenig RAM → OOM). Hart erkaufte Stolperfallen:

- **Builds nur in Actions** (`.github/workflows/docker-build.yml` → ghcr.io
  `agent-team-web|-worker:latest`). `docker-compose.yml` referenziert nur Images.
- **`pull_policy: always`** bei web+worker im Compose ist zwingend: Coolify macht
  nur `docker compose up -d` (kein `pull`) und würde sonst ewig das lokal
  gecachte alte `:latest` weiterstarten.
- **LiteLLM zwingend eigene DB** (`litellm`, nicht die App-DB `agentteam`):
  LiteLLMs Startup-Migration hat auf einer geteilten DB per `prisma migrate
  diff` alle App-Tabellen gelöscht (Datenverlust 15.07.2026). DB einmalig per
  `CREATE DATABASE litellm` anlegen.
- GHCR-Packages müssen public sein (oder Registry-Creds in Coolify).

## Code-Konventionen & Fallstricke

- **CJS-Pakete als Default importieren**, nicht per Named-Import: Der Worker läuft
  als natives ESM; `import { x } from "cjs-paket"` crasht dort (SyntaxError),
  obwohl tsx/esbuild es durchgehen lassen. Muster: `import pkg from "…"; const
  { x } = pkg;` (+ `.d.ts` mit `export default`). Siehe
  `packages/core/src/connectors/ews.ts`.
- **Worker-Runtime-Deps** müssen in `apps/worker/package.json` stehen, sonst
  bündelt tsup CJS-Pakete falsch. `noExternal` in `tsup.config.ts` nur für die
  Workspace-Pakete.
- **`@agent-team/core/sync`** ist ein eigener Subpath-Export (nicht im Barrel):
  hält `node-ical`/Sync-Code aus dem Next-Bundle heraus. Web importiert nur
  `@agent-team/core`.
- **BullMQ-Job-IDs** dürfen kein `:` enthalten.
- **DB-Client** in `packages/db` ist ein lazy Proxy (Next baut Route-Module ohne
  `DATABASE_URL`). Migrationen mit `pnpm db:generate` erzeugen, nie von Hand.
- **Base UI** (nicht Radix): Select braucht `items`-Prop fürs Label; render-Prop
  statt `asChild`.

## Datenquellen-Architektur (Kurzriss)

- Mail: `mail_accounts.protocol` = `imap` | `ews`. Beide landen in denselben
  Tabellen (`mail_folders`/`mail_messages`/`mail_message_bodies`) → Unified
  Inbox, Agenten-Tools, Kontakt-Zuordnung protokoll-unabhängig.
- Sync-Adapter folgen dem `SyncAdapter`-Muster mit **Baseline-Gate** (erster Lauf
  nimmt nur Bestand auf, ohne Trigger) und `dedupKey`. Bodies werden on-demand
  geholt, nicht beim Sync. Backfill/Baseline ist zeitlich/mengenmäßig begrenzt
  (IMAP: letzte 1000/Ordner; EWS: 180-Tage-Fenster; Kalender: −90/+400 Tage).
- EWS: eigener schlanker SOAP-Client (`connectors/ews.ts`, kein
  `ews-javascript-api`), NTLM authentifiziert die **Verbindung** →
  keepAlive-Agent mit `maxSockets: 1`.
- **Verbindungstest** (`apps/web/src/lib/test-mail.ts`): IMAP und SMTP getrennt
  prüfen, mit Timeout-Deckel (`withTimeout`) und wörtlicher Server-Antwort
  (`describeImapError`/`describeSmtpError`) — nie zu einem generischen „Command
  failed" zusammenfassen (imapflow verschluckt den Grund sonst). Im
  Bearbeiten-Dialog testet `/api/sources/[id]/test` die gespeicherte Config
  **plus Formular-Overrides** (leeres Feld = gespeicherter Wert), damit man
  geänderte Hosts/Ports/Passwörter vor dem Speichern prüfen kann — diese
  Override-Logik nicht entfernen, sonst testet der Edit-Dialog den alten Host.
