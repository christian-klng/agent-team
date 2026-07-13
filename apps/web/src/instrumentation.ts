/**
 * Next.js Instrumentation — läuft einmal beim Serverstart.
 * Der Import bleibt bewusst im nodejs-Zweig, damit der Edge-Bundle
 * keine Node-Abhängigkeiten (pg etc.) zieht.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { seedFirstUserIfMissing } = await import("./lib/seed-first-user");
    seedFirstUserIfMissing();
  }
}
