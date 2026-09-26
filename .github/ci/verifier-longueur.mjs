// verifier-longueur.mjs — un CLAUDE.md reste COURT : chaque ligne coûte des jetons à chaque session.
// (source : modeles/claude-md/ de l'Atelier ; dans une app la COPIE vit sous .github/ci/verifier-longueur.mjs : chemin sensible, une PR ne peut pas la réécrire sans attestation.)
// Usage : node .github/ci/verifier-longueur.mjs [<fichier>...]   (défaut : CLAUDE.md du dossier courant)
// Code de sortie : 0 = dans les limites, 1 = trop long ou illisible, 2 = usage.
// Sans dépendance. Limites : 60 lignes ET 10 Ko (10 240 octets), les deux vérifiées.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MAX_LIGNES = 60;
export const MAX_OCTETS = 10 * 1024;

/** Compte lignes et octets d'un texte. Une fin de ligne finale ne crée pas de ligne en plus ; CRLF compte pour une ligne. */
export function mesurer(texte) {
  const brut = String(texte);
  const sansFinale = brut.endsWith("\n") ? brut.slice(0, -1) : brut;
  const lignes = brut === "" ? 0 : sansFinale.split("\n").length;
  return { lignes, octets: Buffer.byteLength(brut, "utf8") };
}

/** Liste des dépassements (vide = conforme). */
export function verifier(texte, { maxLignes = MAX_LIGNES, maxOctets = MAX_OCTETS } = {}) {
  const { lignes, octets } = mesurer(texte);
  const problemes = [];
  if (lignes > maxLignes) problemes.push(`${lignes} lignes (maximum ${maxLignes})`);
  if (octets > maxOctets) problemes.push(`${octets} octets (maximum ${maxOctets})`);
  return { lignes, octets, problemes };
}

export function main(argv, lire = (f) => readFileSync(f, "utf8")) {
  const fichiers = argv.length ? argv : ["CLAUDE.md"];
  let code = 0;
  for (const f of fichiers) {
    let texte;
    try { texte = lire(f); } catch { console.log(`ILLISIBLE  ${f}`); code = 1; continue; }
    const r = verifier(texte);
    if (r.problemes.length) { console.log(`TROP LONG  ${f} : ${r.problemes.join(" ; ")}. Déplacer le détail dans docs/.`); code = 1; }
    else console.log(`OK         ${f} : ${r.lignes} lignes, ${r.octets} octets`);
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
