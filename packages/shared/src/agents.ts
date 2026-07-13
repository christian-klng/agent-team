import { z } from "zod";
import { triggerFilterSchema, triggerKinds } from "./triggers";

export const agentTriggerInputSchema = z.object({
  dataSourceId: z.string().uuid(),
  eventKinds: z.array(z.enum(triggerKinds)).default([]),
  filter: triggerFilterSchema.default({}),
});
export type AgentTriggerInput = z.infer<typeof agentTriggerInputSchema>;

export const agentInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#8b5cf6"),
  model: z.string().min(1).default("claude-sonnet-4-5"),
  maxTurns: z.coerce.number().int().min(1).max(50).default(15),
  skillMarkdown: z.string().min(1),
  enabledTools: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  triggers: z.array(agentTriggerInputSchema).default([]),
});
export type AgentInput = z.infer<typeof agentInputSchema>;

export const agentUpdateSchema = agentInputSchema.partial();
export type AgentUpdate = z.infer<typeof agentUpdateSchema>;

export const DEFAULT_SKILL_TEMPLATE = `# Aufgabe

Beschreibe hier, was dieser Agent tun soll, z. B.:

Wenn eine neue E-Mail eingeht, prüfe, ob eine Antwort nötig ist.
Falls ja, formuliere einen Antwortentwurf im Stil des Nutzers und lege
ihn als Entscheidung vor (email_send). Falls nein, beende den Lauf mit
no_action_needed.

## Stil
- Professionell, freundlich, knapp
- Anrede: "Hallo <Vorname>", Gruß: "Viele Grüße\\nChristian"

## Hinweise
- Nutze mail_list_from_sender, um frühere Korrespondenz zu verstehen.
- Aktualisiere dein Gedächtnis, wenn du Dauerhaftes lernst.
`;
