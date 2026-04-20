import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price?: number | null): string {
  if (price == null) return "—";
  return new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(price);
}

export function formatDuration(minutes?: number | null): string {
  if (!minutes) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

export function healthColor(score?: number | null): string {
  if (!score) return "text-muted-foreground";
  if (score >= 7) return "text-green-600";
  if (score >= 4) return "text-yellow-600";
  return "text-red-500";
}

export function mealTypeLabel(type?: string | null): string {
  const map: Record<string, string> = {
    entree: "Entrée", plat: "Plat", dessert: "Dessert", snack: "Snack",
  };
  return type ? (map[type] ?? type) : "—";
}

const CATEGORY_EMOJI: Record<string, string> = {
  fruit: "🍎",
  legume: "🥕",
  viande: "🥩",
  poisson: "🐟",
  laitier: "🧀",
  epice: "🌶️",
  feculent: "🌾",
  conserve: "🥫",
  noix: "🌰",
  oeuf: "🥚",
  boisson: "🧃",
  huile: "🫒",
  pain: "🍞",
  sucre: "🍯",
  herbe: "🌿",
};

export function categoryEmoji(category?: string | null): string {
  if (!category) return "🍽️";
  return CATEGORY_EMOJI[category.toLowerCase()] ?? "🥣";
}

export function categoryLabel(category?: string | null): string {
  if (!category) return "Non classé";
  const map: Record<string, string> = {
    fruit: "Fruits", legume: "Légumes", viande: "Viandes", poisson: "Poissons",
    laitier: "Laitiers", epice: "Épices", feculent: "Féculents", conserve: "Conserves",
    noix: "Noix & graines", oeuf: "Œufs", boisson: "Boissons", huile: "Huiles",
    pain: "Pains", sucre: "Sucres", herbe: "Herbes",
  };
  return map[category.toLowerCase()] ?? category;
}
