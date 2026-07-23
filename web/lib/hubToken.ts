// lib/hubToken.ts — comparaison à temps constant du jeton hub (fonction pure, testable).
// Le hash SHA-256 ramène les deux entrées à une longueur fixe : timingSafeEqual ne peut
// pas jeter sur des longueurs différentes et ne fuite pas la longueur du secret.

import { createHash, timingSafeEqual } from "node:crypto";

export function hubTokensMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false; // fail-closed : jamais « vide == vide »
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
