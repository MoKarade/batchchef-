"use client";

/**
 * Front-end "draft batch" — recipes staged for the next batch before it's
 * formally generated via the /api/batches/generate endpoint.
 *
 * Stored in localStorage so it survives reloads, but NOT synced with the
 * server. When the user clicks "Finaliser" in /batch, the CartPage POSTs
 * to /api/batches/generate with the draft's recipe_ids + target_portions,
 * then clears the cart.
 */

import { useEffect, useSyncExternalStore } from "react";

export interface CartItem {
  recipe_id: number;
  title: string;
  image_url?: string | null;
  portions: number;
  cost_per_portion?: number | null;
  health_score?: number | null;
  meal_type?: string | null;
  added_at: number;
}

const STORAGE_KEY = "batchchef.cart.v1";
const EVT = "batchchef:cart-changed";

// ---- Storage helpers ------------------------------------------------------

function read(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: CartItem[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  // Notify every useCart subscriber in the current tab
  window.dispatchEvent(new CustomEvent(EVT));
}

// ---- Public API (mutations) ----------------------------------------------

export function addToCart(item: Omit<CartItem, "added_at" | "portions"> & { portions?: number }): void {
  const current = read();
  const existingIdx = current.findIndex((x) => x.recipe_id === item.recipe_id);
  if (existingIdx >= 0) {
    // Already in cart — bump portions by 2 (default "one more serving")
    current[existingIdx] = {
      ...current[existingIdx],
      portions: current[existingIdx].portions + 2,
    };
  } else {
    current.push({
      ...item,
      portions: item.portions ?? 4,
      added_at: Date.now(),
    });
  }
  write(current);
}

export function removeFromCart(recipe_id: number): void {
  write(read().filter((x) => x.recipe_id !== recipe_id));
}

export function setPortions(recipe_id: number, portions: number): void {
  const clamped = Math.max(1, Math.min(50, Math.round(portions)));
  write(read().map((x) => (x.recipe_id === recipe_id ? { ...x, portions: clamped } : x)));
}

export function clearCart(): void {
  write([]);
}

export function isInCart(recipe_id: number): boolean {
  return read().some((x) => x.recipe_id === recipe_id);
}

// ---- React hook ----------------------------------------------------------

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVT, callback);
  // Also listen to cross-tab storage events
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(EVT, callback);
    window.removeEventListener("storage", storageHandler);
  };
}

export function useCart(): {
  items: CartItem[];
  count: number;
  totalPortions: number;
  totalCost: number | null;
} {
  const items = useSyncExternalStore(subscribe, read, () => []);

  // Force a re-read once after mount (SSR returns []; client has real data)
  useEffect(() => {
    // Trigger an event so components re-render with hydrated localStorage
    window.dispatchEvent(new CustomEvent(EVT));
  }, []);

  let totalCost: number | null = 0;
  let hasMissing = false;
  for (const it of items) {
    if (it.cost_per_portion == null) {
      hasMissing = true;
    } else {
      totalCost! += it.cost_per_portion * it.portions;
    }
  }
  if (hasMissing && items.length > 0) totalCost = null;

  const totalPortions = items.reduce((s, i) => s + i.portions, 0);
  return { items, count: items.length, totalPortions, totalCost };
}
