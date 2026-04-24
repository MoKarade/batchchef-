import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Consistent empty-state component. Use on every list page that can be
 * empty (no batches, no recipes matching filter, no inventory items…).
 *
 * Keeps the visual language aligned across the app:
 *   - dashed border card
 *   - optional emoji or icon
 *   - title + message + CTA
 */
export function EmptyState({
  emoji,
  icon: Icon,
  title,
  message,
  ctaLabel,
  ctaHref,
  ctaOnClick,
  className,
}: {
  emoji?: string;
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  message?: string;
  ctaLabel?: string;
  ctaHref?: string;
  ctaOnClick?: () => void;
  className?: string;
}) {
  const content = (
    <div
      className={`rounded-2xl border border-dashed bg-card/40 py-10 px-6 text-center ${className ?? ""}`}
    >
      {(emoji || Icon) && (
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
          {emoji ? (
            <span className="text-2xl">{emoji}</span>
          ) : Icon ? (
            <Icon className="h-5 w-5" />
          ) : null}
        </div>
      )}
      <h3 className="title-serif font-bold">{title}</h3>
      {message && (
        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
          {message}
        </p>
      )}
      {(ctaHref || ctaOnClick) && ctaLabel && (
        <div className="mt-4">
          {ctaHref ? (
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              {ctaLabel} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <button
              onClick={ctaOnClick}
              className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              {ctaLabel} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );

  return content;
}
