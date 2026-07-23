// lib/authorized.ts — filtre d'accès : UNE SEULE adresse admise (AUTHORIZED_EMAIL).
// Fonction pure (testable), même pattern que le hub perso.

export function isAuthorizedEmail(
  email: string | null | undefined,
  authorized: string | null | undefined,
): boolean {
  const normalize = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase();
  const candidate = normalize(email);
  const allowed = normalize(authorized);
  if (!candidate || !allowed) return false;
  return candidate === allowed;
}
