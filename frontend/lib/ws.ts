"use client";

import { useEffect, useRef, useState } from "react";
import { importsApi } from "@/lib/api";

/**
 * Job progress live updates — WebSocket primary + polling fallback.
 *
 * Flow:
 *   1. Try WS at /ws/jobs/{id}. Open the socket and route messages to the
 *      caller's ``onMessage``.
 *   2. If the socket fails to open within 2.5s OR closes without a clean
 *      reason, drop into polling mode (GET /api/imports/{id} every 3s).
 *   3. Poll keeps running until the caller unmounts or ``jobId`` changes.
 *
 * Why the fallback: reverse proxies, CDNs, corporate VPNs and LAN Wi-Fi
 * sometimes drop WS upgrades. We'd rather show slightly-stale progress
 * than a frozen bar.
 */

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.hostname}:8000`
    : "ws://localhost:8000");

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

type Mode = "ws" | "poll" | "idle";

export function useJobWebSocket(
  jobId: number | null,
  onMessage: (data: JobProgress) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMessageRef = useRef(onMessage);
  const [, setMode] = useState<Mode>("idle");

  // Keep callback ref fresh without re-triggering the effect
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!jobId) {
      setMode("idle");
      return;
    }

    let cancelled = false;

    const stopPoll = () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };

    const startPoll = () => {
      if (cancelled) return;
      stopPoll();
      setMode("poll");
      // Fire immediately then every 3s
      const tick = async () => {
        try {
          const { data } = await importsApi.getJob(jobId);
          if (cancelled) return;
          onMessageRef.current({
            job_id: data.id,
            current: data.progress_current,
            total: data.progress_total,
            processed: data.progress_current,
            errors: 0,
            status: data.status,
            current_item: data.current_item ?? undefined,
          });
          // Stop polling once the job is terminal
          if (["completed", "failed", "cancelled"].includes(data.status)) {
            stopPoll();
          }
        } catch {
          // Polling errors are silent — next tick will retry. If the endpoint
          // returns 404 (job deleted), we just keep trying until unmount.
        }
      };
      tick();
      pollTimer.current = setInterval(tick, 3000);
    };

    const openWs = () => {
      try {
        const ws = new WebSocket(`${WS_URL}/ws/jobs/${jobId}`);
        wsRef.current = ws;

        // If WS doesn't open within 2.5s, assume proxies are blocking and
        // fall back to polling.
        wsOpenTimer.current = setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            ws.close();
            startPoll();
          }
        }, 2500);

        ws.onopen = () => {
          if (wsOpenTimer.current) clearTimeout(wsOpenTimer.current);
          stopPoll(); // switched back to WS — stop the backup poll
          setMode("ws");
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as JobProgress;
            onMessageRef.current(data);
          } catch (e) {
            console.error("WebSocket parse error:", e);
          }
        };
        ws.onerror = () => {
          // Error handler fires before close; fallback kicks in on close
        };
        ws.onclose = () => {
          if (cancelled) return;
          if (wsOpenTimer.current) clearTimeout(wsOpenTimer.current);
          // If we were connected then got disconnected, try reconnecting in
          // 2s. If we were never connected, go straight to polling.
          if (wsRef.current === ws) {
            wsRef.current = null;
            startPoll();
            setTimeout(() => {
              if (!cancelled && !wsRef.current) openWs();
            }, 2000);
          }
        };
      } catch {
        startPoll();
      }
    };

    openWs();

    return () => {
      cancelled = true;
      if (wsOpenTimer.current) clearTimeout(wsOpenTimer.current);
      stopPoll();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [jobId]);
}
