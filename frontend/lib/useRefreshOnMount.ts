import { useEffect, useRef } from "react";
import { ingredientsApi } from "./api";

/**
 * Fires a background price-refresh once on mount.
 * If ingredientIds is provided, only refreshes those specific ingredients.
 * Otherwise refreshes all stale/missing ingredients globally.
 * Errors are silently swallowed — this is a best-effort background job.
 */
export function useRefreshOnMount(ingredientIds?: number[]) {
  const triggered = useRef(false);

  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;
    const ids = ingredientIds && ingredientIds.length > 0 ? ingredientIds : undefined;
    ingredientsApi.refreshPrices(ids).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
