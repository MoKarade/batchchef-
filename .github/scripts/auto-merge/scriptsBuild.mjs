// scriptsBuild.mjs — spécifique BatchChef (hors modèle de l'Atelier) : une PR qui change les scripts qui tournent au déploiement
// (vercel-build et ses sous-commandes dans web/package.json) ne s'arme pas. Un chemin ne peut pas viser une clé JSON : on lit le patch.
// Décision pure. Patch absent (gros diff) sur web/package.json = on ne sait pas = refus.
const CIBLE = "web/package.json";
const RE_SCRIPT_BUILD = /^[+-]\s*"(?:vercel-build|db:migrate|db:reparer-ingredients)"\s*:/;

/** @param {{path?: string, filename?: string, patch?: string}[]} fichiers  @returns {string|null} raison du refus, ou null */
export function scriptsBuildTouches(fichiers) {
  for (const f of fichiers) {
    if (!f || typeof f !== "object") continue;
    const chemin = String(f.path ?? f.filename ?? "").replaceAll("\\", "/").toLowerCase();
    if (chemin !== CIBLE) continue;
    if (typeof f.patch !== "string") return `${CIBLE} : diff illisible, les scripts de déploiement (vercel-build) ne peuvent pas être vérifiés`;
    if (f.patch.split("\n").some((l) => RE_SCRIPT_BUILD.test(l))) return `${CIBLE} : un script de déploiement (vercel-build, db:migrate) change, validation de Marc requise`;
  }
  return null;
}
