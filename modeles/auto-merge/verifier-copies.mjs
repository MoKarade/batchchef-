// verifier-copies.mjs — un dépôt d'app a-t-il des copies FIDÈLES des fichiers du modèle ? Compare au manifeste de référence (modeles/manifeste.json),
// qui donne le hachage SHA-256 de chaque fichier copiable. LECTURE SEULE sur le dépôt vérifié.
//
// Usage :
//   node modeles/auto-merge/verifier-copies.mjs <dossier-du-depot> [--manifeste <chemin>]     compare (code 1 si une copie diffère, manque ou n'a rien à faire là)
//   node modeles/auto-merge/verifier-copies.mjs --ecrire-copies <dossier-du-depot>            écrit COPIES.md (tableau chemin | SHA-256 LF | version du modèle) à la racine du dépôt cible,
//                                                                                          seulement si ses copies sont fidèles ; à lancer par le lot de CHAQUE dépôt, jamais dans l'Atelier
//   La comparaison lit aussi le COPIES.md du dépôt : absent, périmé (version) ou qui ne correspond plus aux fichiers → code 1.
//   node modeles/auto-merge/verifier-copies.mjs --ecrire [<dossier-de-l-atelier>]            régénère modeles/manifeste.json (Atelier seulement : la SEULE écriture)
//
// Hachage sur le contenu normalisé : fins de ligne CRLF ramenées à LF (un checkout Windows donne les mêmes empreintes qu'un checkout Linux).
// Un fichier de la surcouche de l'Atelier (chemins-interdits-atelier.json) ne doit JAMAIS se trouver dans une app : signalé « à ne pas copier ».
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Fichiers copiables : source (relative à la racine de l'Atelier) -> destination (relative à la racine de l'app) et rôle. */
export const COPIABLES = Object.freeze([
  { source: "modeles/auto-merge/autoMerge.mjs", destination: "modeles/auto-merge/autoMerge.mjs", role: "module" },
  { source: "modeles/auto-merge/autoMerge.d.mts", destination: "modeles/auto-merge/autoMerge.d.mts", role: "types" },
  { source: "modeles/auto-merge/chemins-interdits-base.json", destination: "modeles/auto-merge/chemins-interdits-base.json", role: "liste" },
  { source: "modeles/auto-merge/fusionner.mjs", destination: "modeles/auto-merge/fusionner.mjs", role: "executeur" },
  { source: "modeles/auto-merge/armer.mjs", destination: "modeles/auto-merge/armer.mjs", role: "executeur" },
  { source: "modeles/auto-merge/codes-raison.mjs", destination: "modeles/auto-merge/codes-raison.mjs", role: "liste" },
  { source: "modeles/auto-merge/verifier-copies.mjs", destination: "modeles/auto-merge/verifier-copies.mjs", role: "outil" },
  { source: "modeles/auto-merge/surblocage.mjs", destination: "modeles/auto-merge/surblocage.mjs", role: "outil" },
  { source: "modeles/qualite/commit-gate.mjs", destination: "scripts/hooks/commit-gate.mjs", role: "hook" },
  { source: "modeles/qualite/lib/analyseCommande.mjs", destination: "scripts/hooks/lib/analyseCommande.mjs", role: "hook" },
  { source: "modeles/auto-merge/gabarit-armement.yml", destination: ".github/workflows/armement-auto-merge.yml", role: "gabarit" },
  { source: "modeles/auto-merge/LISEZMOI.md", destination: "modeles/auto-merge/LISEZMOI.md", role: "doc" },
  // CI réutilisable et ses contrôles : sous .github/** (chemin sensible : toute modification demande l'attestation de pole-securite), car ils tournent DANS le
  // contexte de la PR — une PR qui réécrirait voie-rapide.mjs pour toujours sortir « rapide » (ou un contrôle de documentation pour toujours passer) doit être arrêtée.
  { source: "modeles/ci/ci-reutilisable.yml", destination: ".github/workflows/ci-reutilisable.yml", role: "workflow" },
  { source: "modeles/ci/voie-rapide.mjs", destination: ".github/ci/voie-rapide.mjs", role: "garde" },
  { source: "modeles/claude-md/verifier-longueur.mjs", destination: ".github/ci/verifier-longueur.mjs", role: "garde" },
  { source: "modeles/docs/generer-index.mjs", destination: ".github/ci/generer-index.mjs", role: "garde" },
]);
/** Exemples à ADAPTER par dépôt (jamais comparés) et fichiers qui ne doivent JAMAIS être copiés dans une app. */
export const EXEMPLES = Object.freeze([{ source: "modeles/auto-merge/auto-merge.json", destination: ".github/auto-merge.json" },
  { source: "modeles/qualite/commit-gate.json", destination: "scripts/hooks/commit-gate.json" }]);
export const NON_COPIES = Object.freeze(["modeles/auto-merge/chemins-interdits-atelier.json"]);
/** Gabarits de la structure commune (étape 2) : à ADAPTER puis copier par dépôt, jamais comparés octet pour octet (donc absents de `fichiers`) ; leurs empreintes
 *  servent à détecter qu'un gabarit a changé (un test échoue si le manifeste n'est pas régénéré). */
export const GABARITS = Object.freeze([
  { source: "modeles/claude-md/CLAUDE.md", role: "canevas" },
  { source: "modeles/ci/gabarit-appelant.yml", role: "workflow" },
  { source: "modeles/auto-merge/gabarit-auto-merge-evenementiel.yml", role: "workflow" },
  { source: "modeles/vercel/ignore-command.mjs", role: "outil" },
  { source: "modeles/couts/couts.md", role: "canevas" },
  { source: "modeles/couts/compter-runs.mjs", role: "outil" },
  { source: "modeles/docs/correspondance.md", role: "canevas" },
]);
/** Version du canevas CLAUDE.md (modeles/claude-md/CLAUDE.md) : à incrémenter à chaque changement du canevas ; les CLAUDE.md d'apps peuvent y faire référence. */
export const VERSION_CANEVAS_CLAUDE_MD = "1.0.0";

/** Version du modèle : à incrémenter à chaque changement d'un fichier copiable (elle est écrite dans le manifeste et dans le COPIES.md de chaque dépôt). */
export const VERSION_MODELE = "1.9.0";
export const FICHIER_COPIES = "COPIES.md";
/** Transition : jusqu'à cette date (AAAA-MM-JJ, jour inclus), un COPIES.md ABSENT n'est qu'un avertissement (code 0) ; à partir de là c'est une erreur. Un COPIES.md présent mais faux est TOUJOURS une erreur. */
export const COPIES_OBLIGATOIRE_DEPUIS = "2026-10-15";

/** COPIES.md absent est-il une erreur à cette date ? Date du manifeste absente ou illisible : échec fermé (erreur). `maintenant` : horloge injectable. */
export function absenceEstErreur(manifeste, maintenant = () => new Date()) {
  const depuis = manifeste?.copies_md_obligatoire_depuis;
  if (typeof depuis !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(depuis) || Number.isNaN(Date.parse(depuis))) return true;
  return maintenant().toISOString().slice(0, 10) >= depuis;
}

export const empreinte = (octets) => createHash("sha256").update(String(octets).replace(/\r\n/g, "\n"), "utf8").digest("hex");

/** Manifeste de référence à partir de la racine de l'Atelier. */
export function calculerManifeste(racine, lire = (chemin) => readFileSync(join(racine, chemin), "utf8")) {
  return {
    version: 1,
    version_modele: VERSION_MODELE,
    version_canevas_claude_md: VERSION_CANEVAS_CLAUDE_MD,
    copies_md_obligatoire_depuis: COPIES_OBLIGATOIRE_DEPUIS,
    _doc: "Empreintes SHA-256 (fins de ligne ramenées à LF) de chaque fichier du modèle auto-merge copiable dans une app. Régénéré par `node modeles/auto-merge/verifier-copies.mjs --ecrire` ; un test échoue si un fichier change sans que ce manifeste soit régénéré. Comparaison : `node modeles/auto-merge/verifier-copies.mjs <dossier-du-depot>`.",
    fichiers: COPIABLES.map((f) => ({ ...f, sha256: empreinte(lire(f.source)) })),
    gabarits: GABARITS.map((g) => ({ ...g, sha256: empreinte(lire(g.source)) })),
    exemples: EXEMPLES.map((e) => ({ ...e })),
    non_copies: [...NON_COPIES],
  };
}

/**
 * Compare un dépôt au manifeste. `lire(chemin)` renvoie le contenu ou lève ; `existe(chemin)` : présence. Chemins relatifs à la racine du dépôt vérifié.
 * @returns {{ok: boolean, lignes: {fichier: string, etat: "ok"|"different"|"absent"|"a_ne_pas_copier", attendu?: string, trouve?: string}[]}}
 */
export function comparer(manifeste, { lire, existe }) {
  if (!manifeste || manifeste.version !== 1 || !Array.isArray(manifeste.fichiers) || manifeste.fichiers.length === 0) throw new Error("manifeste illisible");
  const lignes = [];
  for (const f of manifeste.fichiers) {
    if (!existe(f.destination)) { lignes.push({ fichier: f.destination, etat: "absent" }); continue; }
    let trouve;
    try { trouve = empreinte(lire(f.destination)); } catch { lignes.push({ fichier: f.destination, etat: "absent" }); continue; }
    lignes.push(trouve === f.sha256 ? { fichier: f.destination, etat: "ok" } : { fichier: f.destination, etat: "different", attendu: f.sha256.slice(0, 12), trouve: trouve.slice(0, 12) });
  }
  for (const interdit of manifeste.non_copies || []) {
    if (existe(interdit)) lignes.push({ fichier: interdit, etat: "a_ne_pas_copier" });
  }
  return { ok: lignes.every((l) => l.etat === "ok"), lignes };
}

/** COPIES.md d'un dépôt : tableau chemin | SHA-256 normalisé LF | version du modèle (une ligne par fichier copié). */
export function formaterCopies(manifeste, empreintes) {
  const lignes = manifeste.fichiers.filter((f) => empreintes[f.destination]).map((f) => `| ${f.destination} | ${empreintes[f.destination]} | ${manifeste.version_modele} |`);
  return ["# Copies du modèle auto-merge (Atelier)", "",
    "Généré par `node modeles/auto-merge/verifier-copies.mjs --ecrire-copies .` : ne pas modifier à la main. Chaque ligne atteste qu'une copie était FIDÈLE au modèle à la version indiquée ;",
    "`node modeles/auto-merge/verifier-copies.mjs .` la revérifie contre le manifeste de l'Atelier.", "",
    "| chemin | sha256 (fins de ligne LF) | version du modèle |", "|---|---|---|", ...lignes, ""].join("\n");
}

/** Lignes de données d'un COPIES.md -> [{chemin, sha256, version}] ; tout ce qui n'est pas une ligne de données est ignoré. */
export function lireCopies(texte) {
  const out = [];
  for (const l of String(texte).replace(/\r\n/g, "\n").split("\n")) {
    const c = l.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
    if (c.length === 3 && /^[0-9a-f]{64}$/.test(c[1])) out.push({ chemin: c[0], sha256: c[1], version: c[2] });
  }
  return out;
}

/**
 * COPIES.md du dépôt cadre avec le manifeste ET avec les fichiers réels : une ligne par fichier copiable, hachage égal au manifeste, version égale à
 * celle du modèle, aucune ligne en trop. @returns {{etat: "copies_ok"|"copies_absent"|"copies_ecart", details: string[]}}
 */
export function comparerCopies(manifeste, { lire, existe }) {
  if (!existe(FICHIER_COPIES)) return { etat: "copies_absent", details: [] };
  let lignes;
  try { lignes = lireCopies(lire(FICHIER_COPIES)); } catch { return { etat: "copies_absent", details: [] }; }
  const details = [];
  const parChemin = new Map(lignes.map((l) => [l.chemin, l]));
  for (const f of manifeste.fichiers) {
    const l = parChemin.get(f.destination);
    if (!l) { details.push(`${f.destination} : absent de COPIES.md`); continue; }
    if (l.sha256 !== f.sha256) details.push(`${f.destination} : empreinte de COPIES.md différente du modèle`);
    if (l.version !== manifeste.version_modele) details.push(`${f.destination} : version ${l.version} (modèle : ${manifeste.version_modele})`);
  }
  const connus = new Set(manifeste.fichiers.map((f) => f.destination));
  for (const l of lignes) if (!connus.has(l.chemin)) details.push(`${l.chemin} : ligne inconnue du modèle`);
  return { etat: details.length ? "copies_ecart" : "copies_ok", details };
}

const LIBELLES = { ok: "OK       ", different: "DIFFÉRENT", absent: "ABSENT   ", a_ne_pas_copier: "À NE PAS COPIER" };

/** `--ecrire-copies <dépôt> [--manifeste <chemin>]` : écrit COPIES.md dans le dépôt cible, SEULEMENT si toutes ses copies sont fidèles (jamais d'attestation d'une copie modifiée). */
function ecrireCopies(argv, ici) {
  const depot = argv[1];
  if (!depot || depot.startsWith("--")) { console.log("usage : node verifier-copies.mjs --ecrire-copies <dossier-du-depot> [--manifeste <chemin>]"); return 2; }
  const i = argv.indexOf("--manifeste");
  const chemin = i >= 0 ? argv[i + 1] : join(ici, "..", "manifeste.json");
  let manifeste;
  try { manifeste = JSON.parse(readFileSync(chemin, "utf8")); } catch { console.log(`manifeste illisible : ${chemin}`); return 2; }
  const racine = resolve(depot);
  const io = { lire: (c) => readFileSync(join(racine, c), "utf8"), existe: (c) => existsSync(join(racine, c)) };
  const res = comparer(manifeste, io);
  if (!res.ok) {
    for (const l of res.lignes.filter((x) => x.etat !== "ok")) console.log(`${LIBELLES[l.etat]}  ${l.fichier}`);
    console.log("COPIES.md non écrit : les copies ne sont pas toutes fidèles au modèle (corriger d'abord).");
    return 1;
  }
  const empreintes = Object.fromEntries(manifeste.fichiers.map((f) => [f.destination, empreinte(io.lire(f.destination))]));
  writeFileSync(join(racine, FICHIER_COPIES), formaterCopies(manifeste, empreintes));
  console.log(`COPIES.md écrit : ${join(racine, FICHIER_COPIES)}`);
  return 0;
}

export function main(argv, maintenant = () => new Date()) {
  const ici = dirname(fileURLToPath(import.meta.url));
  if (argv[0] === "--ecrire") {
    const racine = resolve(argv[1] || join(ici, "..", ".."));
    writeFileSync(join(racine, "modeles", "manifeste.json"), JSON.stringify(calculerManifeste(racine), null, 2) + "\n");
    console.log(`manifeste écrit : ${join(racine, "modeles", "manifeste.json")}`);
    return 0;
  }
  if (argv[0] === "--ecrire-copies") return ecrireCopies(argv, ici);
  const depot = argv[0];
  if (!depot || depot.startsWith("--")) { console.log("usage : node verifier-copies.mjs <dossier-du-depot> [--manifeste <chemin>]"); return 2; }
  const i = argv.indexOf("--manifeste");
  const chemin = i >= 0 ? argv[i + 1] : join(ici, "..", "manifeste.json");
  let manifeste;
  try { manifeste = JSON.parse(readFileSync(chemin, "utf8")); } catch { console.log(`manifeste illisible : ${chemin}`); return 2; }
  const racine = resolve(depot);
  const res = comparer(manifeste, { lire: (c) => readFileSync(join(racine, c), "utf8"), existe: (c) => existsSync(join(racine, c)) });
  for (const l of res.lignes) console.log(`${LIBELLES[l.etat]}  ${l.fichier}${l.etat === "different" ? `  (attendu ${l.attendu}…, trouvé ${l.trouve}…)` : ""}`);
  const io = { lire: (c) => readFileSync(join(racine, c), "utf8"), existe: (c) => existsSync(join(racine, c)) };
  const copies = comparerCopies(manifeste, io);
  let copiesAbsentTolere = false;
  if (copies.etat === "copies_ok") console.log(`OK         ${FICHIER_COPIES}  (version du modèle ${manifeste.version_modele})`);
  else if (copies.etat === "copies_absent") {
    const erreur = absenceEstErreur(manifeste, maintenant);
    console.log(erreur ? `ABSENT     ${FICHIER_COPIES}  (obligatoire depuis le ${manifeste.copies_md_obligatoire_depuis ?? "?"} : à écrire avec --ecrire-copies .)`
      : `AVERTISSEMENT  ${FICHIER_COPIES} absent : obligatoire à partir du ${manifeste.copies_md_obligatoire_depuis} (à écrire : node modeles/auto-merge/verifier-copies.mjs --ecrire-copies .)`);
    copiesAbsentTolere = !erreur;
  }
  else { console.log(`DIFFÉRENT  ${FICHIER_COPIES}`); for (const d of copies.details) console.log(`  ${d}`); }
  const ok = res.ok && (copies.etat === "copies_ok" || copiesAbsentTolere);
  console.log(ok ? "Toutes les copies sont fidèles au modèle." : "ÉCART : au moins une copie diffère du modèle (ou COPIES.md manque / est périmé).");
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
