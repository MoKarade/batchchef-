// surblocage.mjs — la liste de chemins interdits (base + surcouche éventuelle + chemins_interdits de l'app) bloque-t-elle TROP de fichiers d'un dépôt ?
// LECTURE SEULE : applique la liste à `git ls-files` du dépôt et compte. Retour pole-architecture (FinanceAI#1073 : ~35 fichiers d'UI sur-bloqués).
//
// Usage : node modeles/auto-merge/surblocage.mjs <dossier-du-depot> [--max N]
//   Affiche : nombre de fichiers bloqués, dont le nombre de fichiers de CODE APPLICATIF (hors .github, hooks de scripts, settings, config, modèle).
//   Code de sortie 1 si les fichiers de code applicatif bloqués dépassent N (défaut 15) ; 2 si l'usage ou le dépôt est invalide.
// Un fichier de code applicatif bloqué n'est jamais auto-fusionné : au-delà de quelques fichiers, la liste est trop large pour ce dépôt.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CHEMINS_INTERDITS, correspond, normaliser } from "./autoMerge.mjs";

export const MAX_PAR_DEFAUT = 15;

/** Fichiers d'INFRASTRUCTURE (protection voulue, pas du code applicatif). Chemins normalisés (minuscules, séparateur /). */
const INFRA = [
  /^\.github\//, /^\.claude\//, /^\.husky\//, /^modeles\//, /(^|\/)scripts\/hooks\//, /(^|\/)hooks\/[^/]+\.(sh|ps1|mjs|cjs|bat|cmd)$/,
  /(^|\/)settings[^/]*\.json$/, /(^|\/)config\//, /(^|\/)codeowners$/, /(^|\/)auto-merge\.json$/, /(^|\/)chemins-interdits[^/]*\.json$/,
  /(^|\/)commit-gate/, /^\.gitattributes$/,
];
export const estInfrastructure = (cheminNormalise) => INFRA.some((re) => re.test(cheminNormalise));

/**
 * @param {string[]} fichiers chemins (git ls-files)
 * @param {string[]} motifs liste de chemins interdits
 * @returns {{total: number, bloques: string[], applicatifs: string[]}}
 */
export function evaluer(fichiers, motifs) {
  const bloques = [], applicatifs = [];
  for (const f of fichiers) {
    const n = normaliser(f);
    if (n === null || !correspond(n, motifs)) continue;
    bloques.push(f);
    if (!estInfrastructure(n)) applicatifs.push(f);
  }
  return { total: fichiers.length, bloques, applicatifs };
}

/** Chemins interdits propres au dépôt vérifié (.github/auto-merge.json → chemins_interdits), s'il y en a ; illisible = aucun. */
export function motifsDuDepot(racine) {
  const p = join(racine, ".github", "auto-merge.json");
  if (!existsSync(p)) return [];
  try {
    const liste = JSON.parse(readFileSync(p, "utf8")).chemins_interdits;
    return Array.isArray(liste) ? liste.filter((x) => typeof x === "string" && x.trim() !== "") : [];
  } catch { return []; }
}

const fichiersSuivis = (racine) => execFileSync("git", ["-C", racine, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\0").filter(Boolean);

function main(argv) {
  const iMax = argv.indexOf("--max");
  const max = iMax >= 0 ? Number(argv[iMax + 1]) : MAX_PAR_DEFAUT;
  const depot = argv.find((a, i) => !a.startsWith("--") && (iMax < 0 || i !== iMax + 1));
  if (!depot || !Number.isInteger(max) || max < 0) { console.log("usage : node surblocage.mjs <dossier-du-depot> [--max N]"); return 2; }
  const racine = resolve(depot);
  let fichiers;
  try { fichiers = fichiersSuivis(racine); } catch { console.log(`dépôt illisible (git ls-files a échoué) : ${racine}`); return 2; }
  const r = evaluer(fichiers, [...CHEMINS_INTERDITS, ...motifsDuDepot(racine)]);
  console.log(`${r.total} fichiers suivis ; ${r.bloques.length} bloqués (jamais auto-fusionnés), dont ${r.applicatifs.length} de code applicatif (seuil ${max}).`);
  for (const f of r.applicatifs.slice(0, 50)) console.log(`  code applicatif bloqué : ${f}`);
  if (r.applicatifs.length > 50) console.log(`  … et ${r.applicatifs.length - 50} autres`);
  if (r.applicatifs.length > max) { console.log("SUR-BLOCAGE : la liste est trop large pour ce dépôt (l'élargir est une décision de pole-securite ; la resserrer, de pole-architecture)."); return 1; }
  console.log("Pas de sur-blocage.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
