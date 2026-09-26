// voie-rapide.mjs — première étape du job requis « portes » : la PR ne touche-t-elle que de la documentation ?
// Si oui, les étapes lourdes (install, tests, build) sont sautées par `if:` et le job réussit en moins d'une minute.
// Le job TOUJOURS tourne (pas de `paths:` : un check requis filtré ne tourne pas et bloque la PR).
//
// Usage (dans le workflow) : BASE_SHA=<base de la PR> node modeles/ci/voie-rapide.mjs
//   écrit `rapide=true|false` dans $GITHUB_OUTPUT et une ligne de résumé dans $GITHUB_STEP_SUMMARY ; code de sortie toujours 0 (la décision est la sortie).
// Échec fermé : base absente (push, lancement manuel), base introuvable, erreur de git, liste vide ou trop longue = rapide=false = TOUT s'exécute.
// Jamais « docs » : fichiers de workflow (.github/workflows/**), package.json, lockfiles, versions de Node, configs (*.config.*, tsconfig*, vercel.json…).
// Sans dépendance : Node et git seulement.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { basename } from "node:path/posix";
import { pathToFileURL } from "node:url";

/** Au-delà, la liste est peut-être tronquée ou la PR trop large pour un pari : on exécute tout. */
export const MAX_FICHIERS = 3000;

const TOUJOURS_EXECUTES_NOMS = new Set(["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
  ".nvmrc", ".node-version", ".tool-versions", "vercel.json", "dependabot.yml", "dependabot.yaml", "codeowners", "auto-merge.json"]);

const nettoyer = (chemin) => String(chemin).replace(/\\/g, "/").replace(/^\.\//, "");

/** Ce fichier est-il un fichier qui change ce que la CI doit vérifier (donc JAMAIS de la documentation) ? */
export function estSensible(chemin) {
  const c = nettoyer(chemin);
  const nom = basename(c).toLowerCase();
  return c.startsWith(".github/workflows/") || c.startsWith(".github/actions/") || TOUJOURS_EXECUTES_NOMS.has(nom)
    || /(^|[.-])config\.|^tsconfig|^\.eslintrc|^\.prettierrc|^\.env/.test(nom);
}

/** Extensions qui sont de la documentation sous docs/ : texte, images, PDF SEULEMENT. Tout autre type sous docs/ (js, mjs, ts, html, css, json, yml, py, ps1, sh…) s'exécute. */
export const EXTENSIONS_DOC = new Set([".md", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".pdf"]);
const extension = (c) => { const nom = basename(c).toLowerCase(); const i = nom.lastIndexOf("."); return i > 0 ? nom.slice(i) : ""; };

/** Documentation pure : `*.md` (n'importe où) ou fichier `docs/**` de type texte, image ou PDF, sauf fichiers sensibles (qui gagnent toujours). */
export function estDocumentation(chemin, lus = []) {
  const c = nettoyer(chemin);
  if (c === "" || c.split("/").includes("..") || estSensible(c) || estLuParLesTests(c, lus)) return false;
  const ext = extension(c);
  return ext === ".md" || (c.startsWith("docs/") && EXTENSIONS_DOC.has(ext));
}

/** Documents LUS par des tests (ex. un test qui ouvre docs/adr/0004-….md ou vérifie la taille de CLAUDE.md) : jamais « docs », ils déclenchent tout. Liste posée dans le workflow (`DOCS_LUES_PAR_LES_TESTS`). */
export function listeLus(texte) {
  return String(texte || "").split(/[\n,]/).map((x) => nettoyer(x.trim())).filter((x) => x !== "" && !x.split("/").includes(".."));
}
/** Entrée exacte, ou dossier (entrée terminée par `/`). */
export const estLuParLesTests = (c, lus) => lus.some((e) => c === e || (e.endsWith("/") && c.startsWith(e)));

/** Décision pure. `fichiers` : liste, ou null si illisible. `lus` : documents lus par des tests (jamais « docs »). */
export function decider(fichiers, lus = []) {
  if (!Array.isArray(fichiers)) return { rapide: false, raison: "liste des fichiers illisible : tout s'exécute" };
  if (fichiers.length === 0) return { rapide: false, raison: "aucun fichier modifié détecté : tout s'exécute" };
  if (fichiers.length >= MAX_FICHIERS) return { rapide: false, raison: `${fichiers.length} fichiers (liste peut-être tronquée) : tout s'exécute` };
  const autres = fichiers.filter((f) => !estDocumentation(f, lus));
  if (autres.length) return { rapide: false, raison: `${autres.length} fichier(s) hors documentation sur ${fichiers.length} : tout s'exécute` };
  return { rapide: true, raison: `${fichiers.length} fichier(s), tous de la documentation : install, tests et build sautés` };
}

const REF_SURE = /^[0-9A-Za-z._\/-]{1,200}$/;
const gitParDefaut = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000, maxBuffer: 64 * 1024 * 1024 });

/** Fichiers modifiés entre la base et HEAD ; null au moindre doute. */
export function fichiersModifies(base, git = gitParDefaut) {
  if (!REF_SURE.test(base || "")) return null;
  try {
    git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
    // -z : noms séparés par NUL, exacts quel que soit core.quotepath (sans lui, un nom accentué ou à espace revient entre guillemets et fausserait la comparaison)
    return git(["diff", "--name-only", "-z", "--no-renames", base, "HEAD"]).split("\0").filter(Boolean);
  } catch { return null; }
}

export function main(env = process.env, git) {
  let d;
  try { d = decider(env.BASE_SHA ? fichiersModifies(env.BASE_SHA, git) : null, listeLus(env.DOCS_LUES_PAR_LES_TESTS)); }
  catch { d = { rapide: false, raison: "erreur inattendue : tout s'exécute" }; }
  const evenement = env.GITHUB_EVENT_NAME && env.GITHUB_EVENT_NAME !== "pull_request" ? ` (événement ${env.GITHUB_EVENT_NAME}, jamais de voie rapide)` : "";
  const rapide = d.rapide && (!env.GITHUB_EVENT_NAME || env.GITHUB_EVENT_NAME === "pull_request");
  const ligne = `Voie rapide : ${rapide ? "OUI" : "non"} — ${d.raison}${evenement}`;
  console.log(ligne);
  try {
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `rapide=${rapide}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${ligne}\n`);
  } catch { /* la sortie manque : l'étape suivante lit « non vide et différent de true » comme false */ }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
