import { cn } from "@/lib/utils";

/**
 * Shared skeleton loader. Use via simple class-merge rather than building a
 * 50-variant API — most places need ``<Skeleton className="h-10 w-full" />``
 * and that's exactly what this gives.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-muted/60", className)}
      {...props}
    />
  );
}

/** Vertical stack of text-line placeholders. */
export function TextSkeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

/** 4:5 card skeleton — matches MiniRecipeCard / suggestion cards. */
export function RecipeCardSkeleton() {
  return (
    <div className="aspect-[4/5] rounded-2xl bg-muted/40 animate-pulse" />
  );
}
