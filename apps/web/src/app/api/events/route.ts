import { requireUserId } from "@/lib/api-auth";
import { createEventSubscriber, userEventChannel } from "@agent-team/core";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** SSE-Endpoint: leitet Redis-PubSub-Events des Nutzers an den Browser weiter. */
export async function GET() {
  const authResult = await requireUserId();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const sub = createEventSubscriber();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      await sub.subscribe(userEventChannel(userId));
      sub.on("message", (_channel, message) => {
        safeEnqueue(`data: ${message}\n\n`);
      });
      safeEnqueue(`: connected\n\n`);
      heartbeat = setInterval(() => safeEnqueue(`: ping\n\n`), 25_000);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      sub.quit().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
