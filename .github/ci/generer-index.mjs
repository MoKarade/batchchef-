// generer-index.mjs — docs/INDEX.md GÉNÉRÉ (jamais écrit à la main) + contrôle de docs/correspondance.md (ancien titre -> nouveau chemin).
// (source : modeles/docs/ de l'Atelier ; dans une app la COPIE vit sous .github/ci/ : chemin sensible, une PR ne peut pas la réécrire sans attestation.)
// Usage, depuis la racine du dépôt :
//   node .github/ci/generer-index.mjs            écrit docs/INDEX.md
//   node .github/ci/generer-index.mjs --verifier code 1 si docs/INDEX.md est périmé, ou si une ligne de docs/correspondance.md pointe vers un chemin absent
// L'index : un titre (première ligne `# `, sinon le nom du fichier) et le chemin de chaque *.md sous docs/, groupés par dossier, ordre stable.
// Sans dépendance ; sortie identique sous Windows et Linux (fins de ligne LF, chemins en `/`, tri en ordre d'octets).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";

export const FICHIER_INDEX = "docs/INDEX.md";
export const FICHIER_CORRESPONDANCE = "docs/correspondance.md";
const EXCLUS = new Set([FICHIER_INDEX]);

/** Liste récursive des *.md sous `dossier` (chemins relatifs à la racine, séparateur `/`), triés. `lister(chemin)` -> [{nom, dossier}] injectable. */
export function collecter(racine, dossier = "docs", lister = (rel) => readdirSync(join(racine, rel)).map((nom) => ({ nom, dossier: statSync(join(racine, rel, nom)).isDirectory() }))) {
  const trouves = [];
  const visiter = (rel) => {
    for (const { nom, dossier: estDossier } of lister(rel)) {
      const chemin = posix.join(rel, nom);
      if (estDossier) { if (!nom.startsWith(".") && nom !== "node_modules") visiter(chemin); }
      else if (nom.toLowerCase().endsWith(".md") && !EXCLUS.has(chemin)) trouves.push(chemin);
    }
  };
  visiter(dossier);
  return trouves.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Titre d'un document : première ligne `# Titre` hors bloc de code ; sinon le nom du fichier sans extension. */
export function titre(chemin, texte) {
  let dansCode = false;
  for (const ligne of String(texte).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(ligne)) { dansCode = !dansCode; continue; }
    const m = !dansCode && /^#\s+(.+?)\s*#*\s*$/.exec(ligne);
    if (m) return m[1].replace(/\|/g, "\\|");
  }
  return posix.basename(chemin).replace(/\.md$/i, "");
}

/** Contenu de docs/INDEX.md à partir de [{chemin, titre}]. */
export function formaterIndex(entrees) {
  const groupes = new Map();
  for (const e of entrees) {
    const dossier = posix.dirname(e.chemin);
    if (!groupes.has(dossier)) groupes.set(dossier, []);
    groupes.get(dossier).push(e);
  }
  const lignes = ["# Index des docs", "",
    "<!-- GÉNÉRÉ par `node .github/ci/generer-index.mjs` : ne pas modifier à la main (`--verifier` échoue si ce fichier est périmé). -->", "",
    `${entrees.length} document(s). Ancien titre -> nouveau chemin : [correspondance.md](correspondance.md).`, ""];
  for (const [dossier, liste] of groupes) {
    lignes.push(`## ${dossier}/`, "");
    for (const e of liste) lignes.push(`- [${e.titre}](${posix.relative("docs", e.chemin) || e.chemin}) — \`${e.chemin}\``);
    lignes.push("");
  }
  return lignes.join("\n");
}

/** Lignes de données de correspondance.md : `| ancien titre | nouveau chemin |` -> [{ancien, chemin}] ; en-tête, séparateur et modèles `<...>` ignorés. */
export function lireCorrespondance(texte) {
  const out = [];
  for (const ligne of String(texte).split(/\r?\n/)) {
    if (!ligne.trim().startsWith("|")) continue;
    const c = ligne.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
    if (c.length !== 2 || /^-+$/.test(c[0].replace(/[: ]/g, "")) || /^ancien titre$/i.test(c[0]) || c[1].startsWith("<")) continue;
    out.push({ ancien: c[0], chemin: c[1].replace(/^`|`$/g, "") });
  }
  return out;
}

/** Lignes de correspondance dont le chemin n'existe pas (ou sort de docs/) : liste de messages, vide = tout est bon. */
export function verifierCorrespondance(texte, existe) {
  return lireCorrespondance(texte).flatMap((l) => {
    if (l.chemin.includes("..") || /^(\/|[A-Za-z]:)/.test(l.chemin)) return [`« ${l.ancien} » : chemin douteux ${l.chemin}`];
    return existe(l.chemin) ? [] : [`« ${l.ancien} » : ${l.chemin} n'existe pas`];
  });
}

export function main(argv, racine = process.cwd()) {
  const io = { existe: (c) => existsSync(join(racine, c)), lire: (c) => readFileSync(join(racine, c), "utf8") };
  if (!io.existe("docs")) { console.log("pas de dossier docs/ ici"); return 2; }
  const attendu = formaterIndex(collecter(racine).map((chemin) => ({ chemin, titre: titre(chemin, io.lire(chemin)) })));
  if (argv[0] === "--verifier") {
    const problemes = [];
    const actuel = io.existe(FICHIER_INDEX) ? io.lire(FICHIER_INDEX).replace(/\r\n/g, "\n") : null;
    if (actuel !== attendu) problemes.push(`${FICHIER_INDEX} périmé ou absent (node .github/ci/generer-index.mjs)`);
    if (io.existe(FICHIER_CORRESPONDANCE)) problemes.push(...verifierCorrespondance(io.lire(FICHIER_CORRESPONDANCE), io.existe));
    for (const p of problemes) console.log(`ÉCHEC  ${p}`);
    if (!problemes.length) console.log("OK  index à jour, correspondances valides");
    return problemes.length ? 1 : 0;
  }
  writeFileSync(join(racine, FICHIER_INDEX), attendu);
  console.log(`${FICHIER_INDEX} écrit`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
