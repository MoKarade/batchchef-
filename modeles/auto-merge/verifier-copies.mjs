// verifier-copies.mjs — un dépôt d'app a-t-il des copies FIDÈLES des fichiers du modèle ? Compare au manifeste de référence (modeles/manifeste.json),
// qui donne le hachage SHA-256 de chaque fichier copiable. LECTURE SEULE sur le dépôt vérifié.
//
// Usage :
//   node modeles/auto-merge/verifier-copies.mjs <dossier-du-depot> [--manifeste <chemin>]     compare (code 1 si une copie diffère, manque ou n'a rien à faire là)
//   node modeles/auto-merge/verifier-copies.mjs --ecrire-copies <dossier-du-depot>            écrit COPIES.md (tableau chemin | SHA-256 LF | version du modèle) à la racine du dépôt cible,
//                                                                                          seulement si ses copies sont fidèles ; à lancer par le lot de CHAQUE dépôt, jamais dans l'Atelier
//                                                                                          [--hors-lot <chemin>=<raison>]... : écarts hors lot DÉJÀ CONNUS (chemin du manifeste exactement, raison obligatoire, doit être un vrai écart) ;
//                                                                                          consignés dans COPIES.md, sans jamais rendre la copie « fidèle » (la comparaison des fichiers reste stricte)
//   Hors de l'Atelier, toujours passer --manifeste C:\dev\atelier\modeles\manifeste.json : le manifeste n'est JAMAIS copié dans un dépôt cible.
//   La comparaison lit aussi le COPIES.md du dépôt : absent, périmé (version) ou qui ne correspond plus aux fichiers → code 1.
//   node modeles/auto-merge/verifier-copies.mjs --assurer-labels <dossier-du-depot>           crée les labels do-not-merge et validation-marc SEULEMENT s'ils manquent (jamais --force) ; fait aussi partie de --ecrire-copies (resync de chaque dépôt) ;
//                                                                                          erreur bloquante (code 1) si une création échoue
//   node modeles/auto-merge/verifier-copies.mjs --ecrire [<dossier-de-l-atelier>]            régénère modeles/manifeste.json (Atelier seulement : la SEULE écriture)
//
// Hachage sur le contenu normalisé : fins de ligne CRLF ramenées à LF (un checkout Windows donne les mêmes empreintes qu'un checkout Linux).
// Un fichier de la surcouche de l'Atelier (chemins-interdits-atelier.json) ne doit JAMAIS se trouver dans une app : signalé « à ne pas copier ».
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assurerLabels } from "./labels.mjs";

/** Fichiers copiables : source (relative à la racine de l'Atelier) -> destination (relative à la racine de l'app) et rôle. */
export const COPIABLES = Object.freeze([
  { source: "modeles/auto-merge/autoMerge.mjs", destination: "modeles/auto-merge/autoMerge.mjs", role: "module" },
  { source: "modeles/auto-merge/autoMerge.d.mts", destination: "modeles/auto-merge/autoMerge.d.mts", role: "types" },
  { source: "modeles/auto-merge/chemins-interdits-base.json", destination: "modeles/auto-merge/chemins-interdits-base.json", role: "liste" },
  { source: "modeles/auto-merge/fusionner.mjs", destination: "modeles/auto-merge/fusionner.mjs", role: "executeur" },
  { source: "modeles/auto-merge/armer.mjs", destination: "modeles/auto-merge/armer.mjs", role: "executeur" },
  { source: "modeles/auto-merge/labels.mjs", destination: "modeles/auto-merge/labels.mjs", role: "executeur" },
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
/**
 * PROFILS : un profil est le kit COMPLET moins une liste FERMÉE de fichiers retirés, chacun avec sa RAISON déclarée. Il ne change RIEN à la décision : tous les autres fichiers (autoMerge.mjs,
 * fusionner.mjs, armer.mjs, listes, config) gardent les mêmes empreintes que dans le kit complet. Profil « prive » (dépôt privé GitHub Free, sans protection de branche) : sans le seul
 * `armement-auto-merge.yml` — l'auto-fusion NATIVE n'y existe pas, c'est fusionner.mjs qui fusionne. La liste retirée est écrite ICI (fichier copié, haché) ET dans le manifeste : les deux doivent être
 * identiques, sinon la vérification échoue (on n'élargit pas un retrait en éditant seulement le manifeste).
 */
export const PROFILS = Object.freeze({
  prive: Object.freeze({
    _doc: "Dépôt privé GitHub Free sans protection de branche : le kit complet, SANS le seul gabarit d'armement (pas d'auto-fusion native ; fusionner.mjs fusionne).",
    retire: Object.freeze([Object.freeze({
      destination: ".github/workflows/armement-auto-merge.yml",
      raison: "profil prive : pas d'auto-fusion native en dépôt privé Free (fusionner.mjs fusionne) ; un pull_request_target de plus coûterait des minutes sans rien armer",
    })]),
  }),
});
export const PROFIL_COMPLET = "complet";
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
export const VERSION_MODELE = "1.10.0";
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
    profils: JSON.parse(JSON.stringify(PROFILS)),
  };
}

/**
 * Fichiers retirés du profil demandé : Map destination -> raison. `complet` (ou absent) : aucun. Lève si le profil est inconnu, si le manifeste déclare un retrait différent de celui du CODE
 * (PROFILS), ou si un fichier retiré n'est pas un fichier du kit : ni retrait élargi, ni retrait inventé.
 */
export function retraitsDuProfil(manifeste, profil = PROFIL_COMPLET) {
  if (profil === PROFIL_COMPLET) return new Map();
  const voulu = PROFILS[profil];
  if (!voulu) throw new Error(`profil inconnu : ${profil} (profils : ${[PROFIL_COMPLET, ...Object.keys(PROFILS)].join(", ")})`);
  const declare = manifeste && manifeste.profils && manifeste.profils[profil];
  const dest = (l) => (Array.isArray(l) ? l.map((x) => x && x.destination).sort() : null);
  if (!declare || JSON.stringify(dest(declare.retire)) !== JSON.stringify(dest(voulu.retire))) throw new Error(`le manifeste ne déclare pas exactement le retrait du profil ${profil}`);
  const kit = new Set(manifeste.fichiers.map((f) => f.destination));
  for (const r of voulu.retire) if (!kit.has(r.destination)) throw new Error(`${r.destination} : retiré du profil ${profil} mais absent du kit`);
  return new Map(voulu.retire.map((r) => [r.destination, r.raison]));
}

/**
 * Compare un dépôt au manifeste. `lire(chemin)` renvoie le contenu ou lève ; `existe(chemin)` : présence. Chemins relatifs à la racine du dépôt vérifié.
 * @returns {{ok: boolean, lignes: {fichier: string, etat: "ok"|"different"|"absent"|"a_ne_pas_copier", attendu?: string, trouve?: string}[]}}
 */
export function comparer(manifeste, { lire, existe }, profil = PROFIL_COMPLET) {
  if (!manifeste || manifeste.version !== 1 || !Array.isArray(manifeste.fichiers) || manifeste.fichiers.length === 0) throw new Error("manifeste illisible");
  const retires = retraitsDuProfil(manifeste, profil);
  const lignes = [];
  for (const f of manifeste.fichiers) {
    // retrait VOULU du profil (raison déclarée) : distinct d'un ABSENT (oubli). S'il est pourtant là, il doit rester fidèle.
    if (retires.has(f.destination) && !existe(f.destination)) { lignes.push({ fichier: f.destination, etat: "retire", raison: retires.get(f.destination) }); continue; }
    if (!existe(f.destination)) { lignes.push({ fichier: f.destination, etat: "absent" }); continue; }
    let trouve;
    try { trouve = empreinte(lire(f.destination)); } catch { lignes.push({ fichier: f.destination, etat: "absent" }); continue; }
    lignes.push(trouve === f.sha256 ? { fichier: f.destination, etat: "ok" } : { fichier: f.destination, etat: "different", attendu: f.sha256.slice(0, 12), trouve: trouve.slice(0, 12) });
  }
  for (const interdit of manifeste.non_copies || []) {
    if (existe(interdit)) lignes.push({ fichier: interdit, etat: "a_ne_pas_copier" });
  }
  return { ok: lignes.every((l) => l.etat === "ok" || l.etat === "retire"), lignes };
}

export const TITRE_HORS_LOT = "Écarts hors lot connus (NON fidèles au modèle, raison déclarée) :";

/**
 * Écarts « hors lot » déclarés à l'écriture de COPIES.md (`--hors-lot <chemin>=<raison>`, option répétable). GARDE-FOUS : (a) le chemin doit être EXACTEMENT la destination d'un fichier
 * DÉJÀ listé dans le manifeste (jamais un chemin arbitraire), et pas déjà un retrait de profil ; (b) une RAISON textuelle est obligatoire pour chaque fichier (3 à 200 caractères, une seule ligne) ;
 * pas de doublon. Lève une Error au message clair sinon. @returns {Map<string, string>} destination -> raison
 */
export function validerHorsLot(manifeste, entrees, retires = new Map()) {
  const kit = new Set(manifeste.fichiers.map((f) => f.destination));
  const out = new Map();
  for (const brut of entrees) {
    const i = String(brut).indexOf("=");
    const chemin = i < 0 ? String(brut) : String(brut).slice(0, i);
    const raison = i < 0 ? "" : String(brut).slice(i + 1).trim();
    if (!kit.has(chemin)) throw new Error(`--hors-lot : « ${chemin} » n'est pas un fichier du manifeste (chemins acceptés : ceux de modeles/manifeste.json, exactement)`);
    if (retires.has(chemin)) throw new Error(`--hors-lot : « ${chemin} » est déjà un retrait voulu du profil (sa raison est consignée par le profil)`);
    if (out.has(chemin)) throw new Error(`--hors-lot : « ${chemin} » est déclaré deux fois`);
    if (raison.length < 3 || raison.length > 200 || /[\r\n]/.test(raison)) throw new Error(`--hors-lot : « ${chemin} » exige une raison textuelle (3 à 200 caractères, une ligne) : --hors-lot ${chemin}=<raison>`);
    out.set(chemin, raison);
  }
  return out;
}

/** Écarts hors lot consignés dans un COPIES.md (section TITRE_HORS_LOT) -> Map destination -> raison. Une ligne sans raison n'est pas comptée. */
export function lireEcartsHorsLot(texte) {
  const out = new Map();
  let dedans = false;
  for (const l of String(texte).replace(/\r\n/g, "\n").split("\n")) {
    if (l.trim() === TITRE_HORS_LOT) { dedans = true; continue; }
    if (!dedans) continue;
    if (l.trim() === "") break;
    const m = /^- (\S+) : (.{3,})$/.exec(l.trim());
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/** COPIES.md d'un dépôt : tableau chemin | SHA-256 normalisé LF | version du modèle (une ligne par fichier copié). */
export function formaterCopies(manifeste, empreintes, profil = PROFIL_COMPLET, horsLot = new Map()) {
  const retires = retraitsDuProfil(manifeste, profil);
  const lignes = manifeste.fichiers.filter((f) => empreintes[f.destination] && !horsLot.has(f.destination)).map((f) => `| ${f.destination} | ${empreintes[f.destination]} | ${manifeste.version_modele} |`);
  const nonCopies = [...retires].filter(([dest]) => !empreintes[dest]).map(([dest, raison]) => `- ${dest} : ${raison}`);
  const ecarts = [...horsLot].map(([dest, raison]) => `- ${dest} : ${raison}`);
  return ["# Copies du modèle auto-merge (Atelier)", "", `Profil : ${profil}`, "",
    "Généré par `node modeles/auto-merge/verifier-copies.mjs --ecrire-copies .` : ne pas modifier à la main. Chaque ligne atteste qu'une copie était FIDÈLE au modèle à la version indiquée ;",
    "`node modeles/auto-merge/verifier-copies.mjs .` la revérifie contre le manifeste de l'Atelier.", "",
    "| chemin | sha256 (fins de ligne LF) | version du modèle |", "|---|---|---|", ...lignes, "",
    ...(nonCopies.length ? ["Fichiers du kit NON copiés (retrait voulu du profil, raison déclarée) :", ...nonCopies, ""] : []),
    ...(ecarts.length ? [TITRE_HORS_LOT, ...ecarts, ""] : [])].join("\n");
}

/** Profil consigné dans un COPIES.md (ligne « Profil : nom ») ; `complet` si la ligne manque (anciens COPIES.md). */
export function lireProfil(texte) {
  const m = /^Profil : ([a-z]+)[ ]*$/m.exec(String(texte).replace(/\r\n/g, "\n"));
  return m ? m[1] : PROFIL_COMPLET;
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
export function comparerCopies(manifeste, { lire, existe }, profil = PROFIL_COMPLET) {
  if (!existe(FICHIER_COPIES)) return { etat: "copies_absent", details: [] };
  let lignes, texte;
  try { texte = lire(FICHIER_COPIES); lignes = lireCopies(texte); } catch { return { etat: "copies_absent", details: [] }; }
  const details = [];
  const retires = retraitsDuProfil(manifeste, profil);
  const profilConsigne = lireProfil(texte);
  if (profilConsigne !== profil) details.push(`profil de COPIES.md (${profilConsigne}) différent du profil vérifié (${profil})`);
  const parChemin = new Map(lignes.map((l) => [l.chemin, l]));
  const horsLot = lireEcartsHorsLot(texte);                                            // écarts déclarés (avec raison) : pas de ligne attendue, mais la comparaison des FICHIERS reste stricte (comparer)
  for (const f of manifeste.fichiers) {
    const l = parChemin.get(f.destination);
    if (!l && retires.has(f.destination)) continue;                                   // retrait voulu du profil : pas de ligne attendue
    if (!l && horsLot.has(f.destination)) continue;
    if (!l) { details.push(`${f.destination} : absent de COPIES.md`); continue; }
    if (l.sha256 !== f.sha256) details.push(`${f.destination} : empreinte de COPIES.md différente du modèle`);
    if (l.version !== manifeste.version_modele) details.push(`${f.destination} : version ${l.version} (modèle : ${manifeste.version_modele})`);
  }
  const connus = new Set(manifeste.fichiers.map((f) => f.destination));
  for (const l of lignes) if (!connus.has(l.chemin)) details.push(`${l.chemin} : ligne inconnue du modèle`);
  return { etat: details.length ? "copies_ecart" : "copies_ok", details };
}

/** `gh` réel (sans shell), exécuté DANS le dépôt vérifié : `gh repo view` lit son remote. Injectable pour les tests. */
export const ghReel = (args, cwd) => execFileSync("gh", args, { encoding: "utf8", cwd, timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });

/**
 * Le profil déclaré correspond-il à la VISIBILITÉ réelle du dépôt ? Le profil « prive » n'a de sens que pour un dépôt PRIVÉ (pas d'auto-fusion native) : un dépôt PUBLIC qui le déclarerait
 * échoue ; une visibilité illisible aussi (échec fermé). Le profil complet ne dépend pas de la visibilité (rien n'est lu). @returns {{ok: boolean, ligne: string}}
 */
export function controleVisibilite(profil, gh, racine) {
  if (profil === PROFIL_COMPLET) return { ok: true, ligne: `Profil : ${profil}` };
  let prive;
  try { prive = JSON.parse(gh(["repo", "view", "--json", "isPrivate"], racine)).isPrivate; } catch { prive = undefined; }
  if (prive === true) return { ok: true, ligne: `Profil : ${profil} — dépôt PRIVÉ (gh repo view)` };
  if (prive === false) return { ok: false, ligne: `Profil : ${profil} — dépôt PUBLIC (gh repo view) : le profil ${profil} est réservé aux dépôts privés` };
  return { ok: false, ligne: `Profil : ${profil} — visibilité du dépôt illisible (gh repo view) : profil ${profil} refusé (échec fermé)` };
}

/** Labels indispensables au dépôt : `do-not-merge` (frein dur) et `validation-marc`. Créés SEULEMENT s'ils manquent (labels.mjs : jamais --force, un label personnalisé n'est pas touché). */
export const LABELS_DU_DEPOT = Object.freeze(["do-not-merge", "validation-marc"]);

/**
 * Assure les labels du dépôt vérifié (`gh` lancé DANS le dépôt : il lit son remote). ÉCHEC = erreur affichée et code non nul (jamais silencieux) ; l'appelant s'arrête.
 * @returns {{ok: boolean}}
 */
export function assurerLabelsDuDepot(gh, racine, ecrire = console.log) {
  try {
    const { crees, presents } = assurerLabels((args) => gh(args, racine), [], [...LABELS_DU_DEPOT]);
    ecrire(`Labels : ${presents.length ? `présents ${presents.join(", ")}` : "aucun déjà présent"}${crees.length ? ` ; créés ${crees.join(", ")}` : ""}`);
    return { ok: true };
  } catch (e) {
    ecrire(`ERREUR labels : ${String(e && e.message).slice(0, 200)}`);
    return { ok: false };
  }
}

const LIBELLES = { ok: "OK       ", different: "DIFFÉRENT", absent: "ABSENT   ", retire: "RETIRÉ   ", a_ne_pas_copier: "À NE PAS COPIER" };

/** `--profil <nom>` dans les arguments : nom du profil (défaut `complet`), ou `null` si l'option est mal formée. */
function profilDemande(argv) {
  const i = argv.indexOf("--profil");
  if (i < 0) return PROFIL_COMPLET;
  const nom = argv[i + 1];
  return nom && !nom.startsWith("--") ? nom : null;
}
const detailLigne = (l) => (l.etat === "different" ? `  (attendu ${l.attendu}…, trouvé ${l.trouve}…)` : l.etat === "retire" ? `  (${l.raison})` : "");

/** `--ecrire-copies <dépôt> [--manifeste <chemin>]` : écrit COPIES.md dans le dépôt cible, SEULEMENT si toutes ses copies sont fidèles (jamais d'attestation d'une copie modifiée). */
function ecrireCopies(argv, ici, gh) {
  const depot = argv[1];
  if (!depot || depot.startsWith("--")) { console.log("usage : node verifier-copies.mjs --ecrire-copies <dossier-du-depot> [--manifeste <chemin>] [--hors-lot <chemin>=<raison>]..."); return 2; }
  const i = argv.indexOf("--manifeste");
  const chemin = i >= 0 ? argv[i + 1] : join(ici, "..", "manifeste.json");
  let manifeste;
  try { manifeste = JSON.parse(readFileSync(chemin, "utf8")); } catch { console.log(`manifeste illisible : ${chemin}`); return 2; }
  const racine = resolve(depot);
  const profil = profilDemande(argv);
  if (profil === null) { console.log("usage : --profil <nom>"); return 2; }
  const io = { lire: (c) => readFileSync(join(racine, c), "utf8"), existe: (c) => existsSync(join(racine, c)) };
  let res;
  try { res = comparer(manifeste, io, profil); } catch (e) { console.log(String(e.message)); return 2; }
  // écarts « hors lot » déclarés (--hors-lot <chemin>=<raison>, répétable) : chemins du manifeste seulement, raison obligatoire, et chacun doit être un VRAI écart (jamais un drapeau inutile ni silencieux)
  const entreesHorsLot = [];
  for (let k = 0; k < argv.length; k++) {
    if (argv[k] !== "--hors-lot") continue;
    if (argv[k + 1] === undefined || argv[k + 1].startsWith("--")) { console.log("usage : --hors-lot <chemin>=<raison> (option répétable)"); return 2; }
    entreesHorsLot.push(argv[k + 1]);
  }
  let horsLot;
  try { horsLot = validerHorsLot(manifeste, entreesHorsLot, retraitsDuProfil(manifeste, profil)); } catch (e) { console.log(String(e.message)); return 2; }
  const ecartsReels = new Set(res.lignes.filter((x) => x.etat === "different" || x.etat === "absent").map((x) => x.fichier));
  for (const chemin of horsLot.keys()) if (!ecartsReels.has(chemin)) { console.log(`--hors-lot : « ${chemin} » n'est pas un écart (la copie est fidèle) : ne pas le déclarer`); return 2; }
  const bloquants = res.lignes.filter((x) => x.etat !== "ok" && x.etat !== "retire" && !horsLot.has(x.fichier));
  if (bloquants.length) {
    for (const l of bloquants) console.log(`${LIBELLES[l.etat]}  ${l.fichier}`);
    console.log("COPIES.md non écrit : les copies ne sont pas toutes fidèles au modèle (corriger d'abord).");
    return 1;
  }
  const vis = controleVisibilite(profil, gh, racine);
  console.log(vis.ligne);
  if (!vis.ok) { console.log("COPIES.md non écrit."); return 1; }
  // resync de CHAQUE dépôt : les labels manquants sont créés ici (un dépôt déjà installé est rattrapé), erreur BLOQUANTE : COPIES.md n'est pas écrit
  if (!assurerLabelsDuDepot(gh, racine).ok) { console.log("COPIES.md non écrit : labels indispensables absents et non créés."); return 1; }
  const empreintes = Object.fromEntries(manifeste.fichiers.filter((f) => io.existe(f.destination)).map((f) => [f.destination, empreinte(io.lire(f.destination))]));   // un retrait voulu du profil n'a pas de ligne
  for (const l of res.lignes.filter((x) => x.etat === "retire")) console.log(`${LIBELLES.retire}  ${l.fichier}${detailLigne(l)}`);
  for (const [chemin, raison] of horsLot) console.log(`HORS LOT   ${chemin}  (${raison})`);
  writeFileSync(join(racine, FICHIER_COPIES), formaterCopies(manifeste, empreintes, profil, horsLot));
  console.log(`COPIES.md écrit : ${join(racine, FICHIER_COPIES)}`);
  return 0;
}

export function main(argv, maintenant = () => new Date(), gh = ghReel) {
  const ici = dirname(fileURLToPath(import.meta.url));
  if (argv[0] === "--ecrire") {
    const racine = resolve(argv[1] || join(ici, "..", ".."));
    writeFileSync(join(racine, "modeles", "manifeste.json"), JSON.stringify(calculerManifeste(racine), null, 2) + "\n");
    console.log(`manifeste écrit : ${join(racine, "modeles", "manifeste.json")}`);
    return 0;
  }
  if (argv[0] === "--ecrire-copies") return ecrireCopies(argv, ici, gh);
  if (argv[0] === "--assurer-labels") {
    const dossier = argv[1];
    if (!dossier || dossier.startsWith("--")) { console.log("usage : node verifier-copies.mjs --assurer-labels <dossier-du-depot>"); return 2; }
    return assurerLabelsDuDepot(gh, resolve(dossier)).ok ? 0 : 1;
  }
  const depot = argv[0];
  if (!depot || depot.startsWith("--")) { console.log("usage : node verifier-copies.mjs <dossier-du-depot> [--manifeste <chemin>]"); return 2; }
  const i = argv.indexOf("--manifeste");
  const chemin = i >= 0 ? argv[i + 1] : join(ici, "..", "manifeste.json");
  let manifeste;
  try { manifeste = JSON.parse(readFileSync(chemin, "utf8")); } catch { console.log(`manifeste illisible : ${chemin}`); return 2; }
  const racine = resolve(depot);
  const profil = profilDemande(argv);
  if (profil === null) { console.log("usage : --profil <nom>"); return 2; }
  const io = { lire: (c) => readFileSync(join(racine, c), "utf8"), existe: (c) => existsSync(join(racine, c)) };
  let res, copies;
  try { res = comparer(manifeste, io, profil); copies = comparerCopies(manifeste, io, profil); } catch (e) { console.log(String(e.message)); return 2; }
  const vis = controleVisibilite(profil, gh, racine);
  console.log(vis.ligne);
  for (const l of res.lignes) console.log(`${LIBELLES[l.etat]}  ${l.fichier}${detailLigne(l)}`);
  let copiesAbsentTolere = false;
  if (copies.etat === "copies_ok") console.log(`OK         ${FICHIER_COPIES}  (version du modèle ${manifeste.version_modele})`);
  else if (copies.etat === "copies_absent") {
    const erreur = absenceEstErreur(manifeste, maintenant);
    console.log(erreur ? `ABSENT     ${FICHIER_COPIES}  (obligatoire depuis le ${manifeste.copies_md_obligatoire_depuis ?? "?"} : à écrire avec --ecrire-copies .)`
      : `AVERTISSEMENT  ${FICHIER_COPIES} absent : obligatoire à partir du ${manifeste.copies_md_obligatoire_depuis} (à écrire : node modeles/auto-merge/verifier-copies.mjs --ecrire-copies .)`);
    copiesAbsentTolere = !erreur;
  }
  else { console.log(`DIFFÉRENT  ${FICHIER_COPIES}`); for (const d of copies.details) console.log(`  ${d}`); }
  const ok = vis.ok && res.ok && (copies.etat === "copies_ok" || copiesAbsentTolere);
  console.log(ok ? "Toutes les copies sont fidèles au modèle." : "ÉCART : au moins une copie diffère du modèle (ou COPIES.md manque / est périmé).");
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
