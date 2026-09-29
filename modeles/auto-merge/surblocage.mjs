// surblocage.mjs — la liste de chemins interdits (base + surcouche éventuelle + chemins_interdits de l'app) bloque-t-elle TROP de fichiers d'un dépôt ?
// LECTURE SEULE : applique la liste à `git ls-files` du dépôt et compte. Retour pole-architecture (FinanceAI#1073 : ~35 fichiers d'UI sur-bloqués).
//
// Usage : node modeles/auto-merge/surblocage.mjs <dossier-du-depot> [--max N] [--champ <nom>] [--historique N [--max-mois M]]
//   --champ <nom>      mesure la liste `<nom>` de .github/auto-merge.json SEULE (ex. chemins_validation_visuelle) au lieu de chemins_interdits ; --max porte alors sur TOUS les fichiers freinés
//   --historique N     ajoute la mesure qui compte pour un FREIN : sur les N dernières PR FUSIONNÉES (gh pr list --state merged), combien touchent la liste, soit un taux de PR freinées
//                      par mois. La photo du dépôt (fichiers qui existent) ne dit pas ça : un seul composant partagé très souvent modifié freine plus que 200 fichiers jamais touchés.
//                      Code 1 si le taux dépasse --max-mois (facultatif).
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
export function motifsDuDepot(racine, champ = "chemins_interdits") {
  const p = join(racine, ".github", "auto-merge.json");
  if (!existsSync(p)) return [];
  try {
    const liste = JSON.parse(readFileSync(p, "utf8"))[champ];
    return Array.isArray(liste) ? liste.filter((x) => typeof x === "string" && x.trim() !== "") : [];
  } catch { return []; }
}

const JOUR_MS = 86_400_000;

/**
 * Taux de PR freinées par une liste de motifs, mesuré sur des PR déjà FUSIONNÉES.
 * @param {{number: number, mergedAt: string, files?: {path: string}[]}[]} prs  sortie de `gh pr list --state merged --json number,mergedAt,files`
 * @param {string[]} motifs
 * @returns {{prs: number, concernees: number, jours: number, parMois: number, fichiers: [string, number][]}} `fichiers` : les chemins qui freinent le plus (au plus 10)
 */
export function tauxHistorique(prs, motifs) {
  const dates = prs.map((p) => Date.parse(p.mergedAt)).filter(Number.isFinite);
  const jours = dates.length > 1 ? Math.max(1, (Math.max(...dates) - Math.min(...dates)) / JOUR_MS) : 1;
  let concernees = 0;
  const compte = new Map();
  for (const pr of prs) {
    const touches = (Array.isArray(pr.files) ? pr.files : []).map((f) => normaliser(f && f.path)).filter((c) => c !== null && correspond(c, motifs));
    if (touches.length) concernees++;
    for (const c of new Set(touches)) compte.set(c, (compte.get(c) || 0) + 1);
  }
  const fichiers = [...compte].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  return { prs: prs.length, concernees, jours, parMois: Math.round((concernees / jours) * 30 * 10) / 10, fichiers };
}

const fichiersSuivis = (racine) => execFileSync("git", ["-C", racine, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\0").filter(Boolean);

/** Valeur de l'option `--nom` (argument suivant), ou undefined ; `null` si l'option est présente sans valeur. */
const option = (argv, nom) => { const i = argv.indexOf(nom); return i < 0 ? undefined : (argv[i + 1] === undefined || argv[i + 1].startsWith("--") ? null : argv[i + 1]); };

const ghReel = (args, cwd) => execFileSync("gh", args, { encoding: "utf8", cwd, timeout: 60000, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

export function main(argv, gh = ghReel) {
  const valeurs = ["--max", "--champ", "--historique", "--max-mois"].map((o) => option(argv, o));
  const [vMax, champ, vHisto, vMois] = valeurs;
  const max = vMax === undefined ? MAX_PAR_DEFAUT : Number(vMax);
  const usage = "usage : node surblocage.mjs <dossier-du-depot> [--max N] [--champ <nom>] [--historique N [--max-mois M]]";
  const consommes = new Set(["--max", "--champ", "--historique", "--max-mois"].flatMap((o) => (argv.includes(o) ? [argv.indexOf(o), argv.indexOf(o) + 1] : [])));
  const depot = argv.find((a, i) => !a.startsWith("--") && !consommes.has(i));
  const histo = vHisto === undefined ? null : Number(vHisto);
  const maxMois = vMois === undefined ? null : Number(vMois);
  if (!depot || !Number.isInteger(max) || max < 0 || valeurs.includes(null) || (champ !== undefined && !/^[a-z_]+$/.test(champ))
    || (histo !== null && (!Number.isInteger(histo) || histo < 1 || histo > 1000)) || (maxMois !== null && (!(maxMois >= 0) || histo === null))) { console.log(usage); return 2; }
  const racine = resolve(depot);
  let fichiers;
  try { fichiers = fichiersSuivis(racine); } catch { console.log(`dépôt illisible (git ls-files a échoué) : ${racine}`); return 2; }
  if (champ !== undefined) {
    // liste d'UN champ seul (ex. frein visuel) : pas la base des chemins interdits ; la mesure porte sur tous les fichiers freinés
    const motifs = motifsDuDepot(racine, champ);
    if (motifs.length === 0) { console.log(`.github/auto-merge.json : « ${champ} » absent ou vide : rien à mesurer.`); return 2; }
    const bloques = evaluer(fichiers, motifs).bloques;
    console.log(`${fichiers.length} fichiers suivis ; ${bloques.length} freinés par « ${champ} » (seuil ${max}).`);
    for (const f of bloques.slice(0, 50)) console.log(`  freiné : ${f}`);
    if (bloques.length > 50) console.log(`  … et ${bloques.length - 50} autres`);
    let code = bloques.length > max ? 1 : 0;
    if (code) console.log(`LISTE TROP LARGE : « ${champ} » freine ${bloques.length} fichiers (seuil ${max}).`);
    if (histo !== null) code = Math.max(code, historique(gh, racine, motifs, histo, maxMois));
    if (!code) console.log("Pas de sur-blocage.");
    return code;
  }
  const r = evaluer(fichiers, [...CHEMINS_INTERDITS, ...motifsDuDepot(racine)]);
  console.log(`${r.total} fichiers suivis ; ${r.bloques.length} bloqués (jamais auto-fusionnés), dont ${r.applicatifs.length} de code applicatif (seuil ${max}).`);
  for (const f of r.applicatifs.slice(0, 50)) console.log(`  code applicatif bloqué : ${f}`);
  if (r.applicatifs.length > 50) console.log(`  … et ${r.applicatifs.length - 50} autres`);
  const trop = r.applicatifs.length > max;
  if (trop) console.log("SUR-BLOCAGE : la liste est trop large pour ce dépôt (l'élargir est une décision de pole-securite ; la resserrer, de pole-architecture).");
  const codeHisto = histo === null ? 0 : historique(gh, racine, [...CHEMINS_INTERDITS, ...motifsDuDepot(racine)], histo, maxMois);   // la mesure sur l'historique se fait aussi quand la photo est trop large
  if (!trop && codeHisto === 0) console.log("Pas de sur-blocage.");
  return trop ? 1 : codeHisto;
}

/** Mesure sur l'historique réel des PR fusionnées (gh lancé dans le dépôt). Échec de lecture = code 2 (jamais « 0 PR freinée » déguisé). */
function historique(gh, racine, motifs, n, maxMois) {
  let prs;
  try { prs = JSON.parse(gh(["pr", "list", "--state", "merged", "--limit", String(n), "--json", "number,mergedAt,files"], racine)); }
  catch { console.log("historique illisible (gh pr list a échoué) : rien n'est mesuré."); return 2; }
  if (!Array.isArray(prs) || prs.length === 0) { console.log("historique vide : aucune PR fusionnée à mesurer."); return 2; }
  const t = tauxHistorique(prs, motifs);
  console.log(`Historique : ${t.prs} PR fusionnées sur ${t.jours.toFixed(1)} jours ; ${t.concernees} freinées (${Math.round((t.concernees / t.prs) * 100)} %), soit environ ${t.parMois} PR freinées par mois.`);
  for (const [f, k] of t.fichiers) console.log(`  ${k} PR : ${f}`);
  if (maxMois !== null && t.parMois > maxMois) { console.log(`TROP DE FREIN : ${t.parMois} PR par mois (plafond ${maxMois}).`); return 1; }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
