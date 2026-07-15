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

  /**
   * Das Paket ist CommonJS (`module.exports = { … }`) — unter nativem Node-ESM
   * ist nur der Default-Export (= module.exports) zuverlässig. Deshalb als
   * Default deklarieren und im Code destrukturieren.
   */
  interface NtlmClient {
    /** Liefert "NTLM <base64>" für den Handshake-Start. */
    createType1Message(workstation?: string, target?: string): string;
    /** Akzeptiert den WWW-Authenticate-Header (oder nur den Base64-Teil). */
    decodeType2Message(str: string): Type2Message;
    /** Liefert "NTLM <base64>" als Antwort auf die Server-Challenge. */
    createType3Message(
      type2Message: Type2Message,
      username: string,
      password: string,
      workstation?: string,
      target?: string,
    ): string;
  }

  const ntlmClient: NtlmClient;
  export default ntlmClient;
}
