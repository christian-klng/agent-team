import { createDAVClient } from "tsdav";
import type { CaldavAccountConfig } from "../sources";

export type DavClient = Awaited<ReturnType<typeof createDAVClient>>;

export async function createCaldavClient(cfg: CaldavAccountConfig): Promise<DavClient> {
  return createDAVClient({
    serverUrl: cfg.serverUrl,
    credentials: { username: cfg.username, password: cfg.password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

/** Verbindungstest: Login + Kalenderliste. Wirft bei Fehler. */
export async function testCaldavConnection(cfg: CaldavAccountConfig): Promise<number> {
  const client = await createCaldavClient(cfg);
  const calendars = await client.fetchCalendars();
  return calendars.length;
}
