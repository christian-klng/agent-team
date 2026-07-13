import type { TriggerKind } from "@agent-team/shared";

export interface DetectedChange {
  kind: TriggerKind;
  /** Interne Referenz auf den Auslöser (Row-ID oder Pfad). */
  externalRef: string;
  /** Weltweit eindeutiger Schlüssel — verhindert doppelte Trigger-Events. */
  dedupKey: string;
  payload: Record<string, unknown>;
}
