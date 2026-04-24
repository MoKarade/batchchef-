"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight CSS tooltip — no Radix/Popover dependency, just a span with
 * absolute positioning. Shows on hover + keyboard focus so it works for
 * accessibility. Use instead of native ``title=`` on icon-only buttons.
 *
 * Example:
 *   <Tooltip label="Annuler">
 *     <button><X /></button>
 *   </Tooltip>
 */
export function Tooltip({
  label,
  side = "top",
  children,
  className,
}: {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 400);  // 400ms delay — standard
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  const sideCls = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
    left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
    right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
  }[side];

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-foreground text-background text-[10px] font-medium px-2 py-1 shadow-lg",
            sideCls,
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
