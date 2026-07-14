/** Minimale Typen für @ewsjs/ntlm-client (Paket liefert keine eigenen). */
declare module "@ewsjs/ntlm-client" {
  /** Opakes, dekodiertes Type-2-Message-Objekt. */
  export interface Type2Message {
    version: 1 | 2;
    flags: number;
    encoding: "ascii" | "ucs2";
    challenge: Buffer;
    targetName: string;
    /** Nur gesetzt, wenn der Server einen Target-Info-Block liefert (NTLMv2). */
    targetInfo?: { buffer: Buffer; parsed: Record<string, unknown> };
  }
  /** Liefert "NTLM <base64>" für den Handshake-Start. */
  export function createType1Message(workstation?: string, target?: string): string;
  /** Akzeptiert den WWW-Authenticate-Header (oder nur den Base64-Teil). */
  export function decodeType2Message(str: string): Type2Message;
  /** Liefert "NTLM <base64>" als Antwort auf die Server-Challenge. */
  export function createType3Message(
    type2Message: Type2Message,
    username: string,
    password: string,
    workstation?: string,
    target?: string,
  ): string;
}
