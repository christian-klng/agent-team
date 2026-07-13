# Agent Team

CRM, Agenten-Plattform und Mail-/Kalender-Aggregator in einer selbst gehosteten
Web-App. Datenquellen (E-Mail, Kalender, Dokumente) sind **Auslöser** für
KI-Agenten und zugleich **Ziele** ihrer Aktionen: Agenten beobachten neue
Einträge, sammeln mit Lese-Tools Kontext und legen dir **Entscheidungen** vor
(z. B. „Formuliere Antwort-E-Mail"). Erst nach deiner Freigabe führt
deterministischer Server-Code die Aktion aus.

**Sicherheitsmodell:** Agenten haben ausschließlich Lese-Tools plus
`propose_decision`. Es existiert kein Tool, mit dem ein Agent senden, schreiben
oder bestätigen könnte — die Freigabe durch dich ist technisch der einzige Weg
zur Ausführung (Executor in `packages/core/src/decisions/`).

## Architektur

- **apps/web** — Next.js 15 (App Router, deutsch, responsive). Drei-Spalten-Layout
  im Stil von Chatwoot, rechtes RunPanel (`?run=<id>`) mit Live-Transcript und
  Nachfrage-Chat.
- **apps/worker** — Node-Prozess mit BullMQ: 5-Minuten-Sync aller Quellen,
  Agent-Läufe (Claude Agent SDK), Decision-Ausführung. Führt beim Start
  DB-Migrationen aus.
- **packages/db** — Drizzle-Schema (PostgreSQL), **packages/core** — Konnektoren
  (IMAP/SMTP/CalDAV/WebDAV), Sync-Engine, Executors, **packages/shared** —
  Zod-Schemas & Typen für UI + Server.
- **LLM-Anbindung:** Claude Agent SDK → `ANTHROPIC_BASE_URL` → LiteLLM-Gateway →
  OpenRouter/Cortecs (Konfiguration in `scripts/litellm/config.yaml`).
  Alternativ direkte Anthropic-API (`ANTHROPIC_API_KEY` setzen,
  `LITELLM_BASE_URL` leer lassen).

## Lokale Entwicklung

Voraussetzungen: Node ≥ 22, pnpm ≥ 9. Postgres/Redis kommen wahlweise aus
Docker (`docker compose up postgres redis`) oder eingebettet ohne Docker:

```bash
pnpm install
cp .env.example .env          # Secrets erzeugen: openssl rand -hex 32
pnpm dev:services             # eingebettetes Postgres (54329) + Redis (63790)
pnpm db:migrate               # Schema anlegen
pnpm seed:user                # Login-Nutzer aus SEED_USER_* anlegen
pnpm seed:demo                # optional: Demo-Postfach/-Kalender für die UI
pnpm dev                      # Web (3000) + Worker parallel
```

Login: `http://localhost:3000` mit `SEED_USER_EMAIL` / `SEED_USER_PASSWORD`.

## Deployment auf Coolify

1. Repository nach GitHub/GitLab pushen und in Coolify als
   **Docker-Compose-Ressource** anlegen (nutzt `docker-compose.yml`).
2. Domain auf den `web`-Service (Port 3000) legen, HTTPS via Coolify/Traefik.
3. Env-Variablen in Coolify setzen (siehe Tabelle). `BETTER_AUTH_URL` =
   öffentliche URL der App.
4. Deploy starten — der Worker führt Migrationen automatisch aus.
5. Einmalig den Nutzer anlegen: im Worker-Container
   `node dist/index.js` läuft bereits; Nutzer-Seed per
   `docker exec` im **web**-Build geht nicht — stattdessen lokal
   `DATABASE_URL=<prod-url> pnpm seed:user` ausführen oder die Variablen
   `SEED_USER_EMAIL`/`SEED_USER_PASSWORD` setzen und das Seed-Skript einmal im
   Worker-Container ausführen:
   `docker exec -it <worker> node -e "import('./dist/index.js')"` — siehe
   `scripts/seed-user.ts`.

| Variable | Pflicht | Beschreibung |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | ✅ | Passwort der Postgres-Instanz im Compose-Stack |
| `BETTER_AUTH_SECRET` | ✅ | `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | ✅ | Öffentliche URL, z. B. `https://team.example.com` |
| `APP_ENCRYPTION_KEY` | ✅ | 64 Hex-Zeichen — verschlüsselt Datenquellen-Passwörter |
| `LITELLM_MASTER_KEY` | ✅ | Interner Key zwischen Worker und LiteLLM |
| `OPENROUTER_API_KEY` | ▫️ | Für OpenRouter-Modelle im Gateway |
| `CORTECS_API_KEY` | ▫️ | Für Cortecs-Modelle im Gateway |
| `ANTHROPIC_API_KEY` | ▫️ | Fallback: direkte Anthropic-API statt Gateway |
| `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | ▫️ | Erst-Login-Nutzer |

## Datenquellen einrichten

Unter **Einstellungen → Datenquellen**:

- **E-Mail:** IMAP/SMTP mit App-Passwörtern (iCloud: `imap.mail.me.com` /
  `smtp.mail.me.com`, Gmail: `imap.gmail.com` / `smtp.gmail.com`).
- **Kalender:** CalDAV (iCloud: `https://caldav.icloud.com`, Google:
  `https://apidata.googleusercontent.com/caldav/v2/<kalender-id>/user`).
- **Dokumente:** WebDAV, z. B. NextCloud
  (`https://cloud.example.com/remote.php/dav/files/<user>`), optional mit
  Root-Pfad zur Zugriffsbegrenzung.

Der erste Sync nimmt nur den Bestand auf (Baseline) — Agenten starten erst bei
danach neu eintreffenden Einträgen.

## Agenten

Unter **Agenten** anlegen: Skill (Markdown-Arbeitsanweisung), Modell,
Trigger (Quelle + Ereignisart + Filter) und Lese-Tools. Jeder Lauf erscheint
live im RunPanel; dort kannst du Entscheidungen anpassen/freigeben und dem
Agenten Nachfragen stellen (Session-Resume). Agenten pflegen ein eigenes
Gedächtnis und können Änderungen an ihrem Skill vorschlagen — auch das ist
eine Entscheidung, die du freigibst.
