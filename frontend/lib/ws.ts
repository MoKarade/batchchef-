"use client";

import { useEffect, useRef, useCallback } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

export interface JobProgress {
  job_id: number;
  current: number;
  total: number;
  processed: number;
  errors: number;
  eta_seconds?: number;
  status?: string;
  current_item?: string;
}

export function useJobWebSocket(
  jobId: number | null,
  onMessage: (data: JobProgress) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (!jobId) return;
    const ws = new WebSocket(`${WS_URL}/ws/jobs/${jobId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as JobProgress;
        onMessage(data);
      } catch (e) {
        console.error("WebSocket message parse error:", e);
      }
    };

    ws.onclose = () => {
      // Reconnect after 2s if not a clean close
      setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.CLOSED) {
          connect();
        }
      }, 2000);
    };
  }, [jobId, onMessage]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);
}
