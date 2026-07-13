"use client";

import type { AppEvent } from "@agent-team/shared";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef } from "react";

type Listener = (event: AppEvent) => void;

const listenersContext = createContext<Set<Listener> | null>(null);

/**
 * Öffnet genau eine SSE-Verbindung pro Tab und invalidiert Query-Caches
 * gezielt. Komponenten können sich zusätzlich mit useAppEvent() einhängen
 * (z. B. das RunPanel für Live-Transcript-Updates).
 */
export function AppEventsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const listenersRef = useRef<Set<Listener>>(new Set());

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (ev) => {
      let event: AppEvent;
      try {
        event = JSON.parse(ev.data) as AppEvent;
      } catch {
        return;
      }
      switch (event.type) {
        case "sync.status":
          queryClient.invalidateQueries({ queryKey: ["sources"] });
          break;
        case "decision.changed":
          queryClient.invalidateQueries({ queryKey: ["decisions"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          break;
        case "run.status":
          queryClient.invalidateQueries({ queryKey: ["runs"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          break;
        case "run.event":
          // Gezielte Updates übernimmt das RunPanel über den Listener.
          break;
        case "mail.new":
          queryClient.invalidateQueries({ queryKey: ["mail"] });
          break;
      }
      for (const listener of listenersRef.current) listener(event);
    };
    return () => es.close();
  }, [queryClient]);

  return (
    <listenersContext.Provider value={listenersRef.current}>
      {children}
    </listenersContext.Provider>
  );
}

export function useAppEvent(listener: Listener) {
  const listeners = useContext(listenersContext);
  const stable = useRef(listener);
  stable.current = listener;

  useEffect(() => {
    if (!listeners) return;
    const wrapped: Listener = (e) => stable.current(e);
    listeners.add(wrapped);
    return () => {
      listeners.delete(wrapped);
    };
  }, [listeners]);
}
