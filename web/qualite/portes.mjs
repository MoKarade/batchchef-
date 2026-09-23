#!/usr/bin/env node
// Portes qualité de l'Atelier — version commune à toutes les apps (source : dépôt atelier,
// modeles/qualite/portes.mjs ; pilote : BatchChef, S1). Ce qui change d'une app à l'autre vit
// dans qualite/seuils.json, bloc « config » — ce fichier-ci ne se modifie pas sur place.
//
// Lance chaque contrôle, mesure un chiffre, le compare au seuil de qualite/seuils.json.
// Principe du CLIQUET : les seuils figent l'état au jour de la mise en place. L'existant est
// toléré, mais rien ne peut reculer. Quand un chiffre s'améliore, `--maj` resserre le seuil —
// jamais l'inverse (sauf `--forcer`, décision explicite de Marc).
//
//   node qualite/portes.mjs             → toutes les portes rapides
//   node qualite/portes.mjs --mutation  → + lit le dernier rapport de mutation (npm run mutation)
//   node qualite/portes.mjs --seulement-mutation → juge uniquement le rapport de mutation (CI hebdo)
//   node qualite/portes.mjs --maj       → resserre les seuils sur les chiffres améliorés
//
// Écrit qualite/rapport.json (non versionné) : c'est ce que lit le cockpit de l'Atelier.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEUILS = join(RACINE, "qualite", "seuils.json");
const RAPPORT = join(RACINE, "qualite", "rapport.json");
const args = new Set(process.argv.slice(2));
const seuils = JSON.parse(readFileSync(SEUILS, "utf8"));
const config = seuils.config;

function lancer(commande) {
  const debut = Date.now();
  const r = spawnSync(commande, { cwd: RACINE, shell: true, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status ?? 1, sortie: (r.stdout || "") + (r.stderr || ""), stdout: r.stdout || "", secondes: (Date.now() - debut) / 1000 };
}

// Une sortie illisible (outil planté, sortie vide) est un échec NOMMÉ, avec la fin de ce que l'outil
// a dit — jamais un « Unexpected end of JSON input » anonyme. Vécu le 23/09/2026 : eslint plantait
// sous FlatCompat (JobAI #30, BatchChef #107) et la porte ne disait que « SyntaxError ».
function json(r, quoi) {
  const debut = r.stdout.search(/[[{]/);
  try {
    if (debut < 0) throw new Error("aucun JSON en sortie");
    return JSON.parse(r.stdout.slice(debut).replace(/^\uFEFF/, ""));
  } catch (e) {
    const fin = r.sortie.trim().split("\n").slice(-15).join("\n");
    throw new Error(`${quoi} : sortie illisible (${e.message}) — l'outil a sans doute planté. Fin de sa sortie :\n${fin}`);
  }
}

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 100);

// ---------------------------------------------------------------- mesures
const mesures = {};
const durees = {};

function typecheck() {
  const r = lancer("npx --no-install tsc --noEmit");
  mesures["typecheck.erreurs"] = (r.sortie.match(/error TS\d+/g) || []).length + (r.code && !/error TS/.test(r.sortie) ? 1 : 0);
  durees.typecheck = r.secondes;
}

function lint() {
  const r = lancer(`npx --no-install ${config.lint} -f json`);
  const res = json(r, "lint (eslint)");
  mesures["lint.erreurs"] = res.reduce((s, f) => s + f.errorCount, 0);
  mesures["lint.avertissements"] = res.reduce((s, f) => s + f.warningCount, 0);
  durees.lint = r.secondes;
}

function testsEtCouverture() {
  const r = lancer(
    // reportOnFailure : sans lui, UN test rouge supprime tout le rapport de couverture (défaut Vitest).
    // vitest_args (config) : réglages propres à l'app, ex. un délai plus long sous instrumentation.
    "npx --no-install vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=text-summary " +
      `--coverage.reportOnFailure=true --reporter=json --outputFile=coverage/tests.json ${config.vitest_args || ""}`,
  );
  const tests = JSON.parse(readFileSync(join(RACINE, "coverage", "tests.json"), "utf8"));
  mesures["tests.echecs"] = tests.numFailedTests + (tests.numRuntimeErrorTestSuites || 0) + (r.code && !tests.numFailedTests ? 1 : 0);
  mesures["tests.total"] = tests.numTotalTests;
  const resume = JSON.parse(readFileSync(join(RACINE, "coverage", "coverage-summary.json"), "utf8"));
  mesures["couverture.lignes_global"] = resume.total.lines.pct;
  mesures["couverture.branches_global"] = resume.total.branches.pct;
  // Le cœur métier (config.coeur) est la couverture qui compte le plus.
  const motif = new RegExp(config.coeur.motif);
  let couvertes = 0, total = 0;
  for (const [fichier, m] of Object.entries(resume)) {
    if (fichier === "total" || !motif.test(fichier)) continue;
    couvertes += m.lines.covered;
    total += m.lines.total;
  }
  mesures["couverture.lignes_coeur"] = pct(couvertes, total);
  durees.tests = r.secondes;
}

function codeMort() {
  const r = lancer("npx --no-install knip --reporter json");
  const res = json(r, "code mort (knip)");
  let n = 0;
  for (const i of res.issues) for (const v of Object.values(i)) if (Array.isArray(v)) n += v.length;
  mesures["code_mort.problemes"] = n;
  durees.code_mort = r.secondes;
}

function architecture() {
  const r = lancer(`npx --no-install depcruise ${config.archi.join(" ")} --output-type json`);
  const res = json(r, "architecture (dependency-cruiser)");
  mesures["architecture.violations"] = res.summary.violations.filter((v) => v.rule.severity === "error").length;
  durees.architecture = r.secondes;
}

function mutation() {
  const f = join(RACINE, "reports", "mutation", "mutation.json");
  if (!existsSync(f)) {
    console.log("  (pas de rapport de mutation : lancer `npm run mutation` d'abord)");
    return;
  }
  const rapport = JSON.parse(readFileSync(f, "utf8"));
  let detectes = 0, nonDetectes = 0;
  for (const fichier of Object.values(rapport.files)) {
    for (const m of fichier.mutants) {
      if (m.status === "Killed" || m.status === "Timeout") detectes++;
      else if (m.status === "Survived" || m.status === "NoCoverage") nonDetectes++;
    }
  }
  mesures["mutation.score"] = pct(detectes, detectes + nonDetectes);
  mesures["mutation.survivants"] = nonDetectes;
}

// ---------------------------------------------------------------- comparaison
const LIBELLES = {
  "typecheck.erreurs": "Typage (erreurs)",
  "lint.erreurs": "Lint (erreurs)",
  "lint.avertissements": "Lint (avertissements)",
  "tests.echecs": "Tests en échec",
  "couverture.lignes_coeur": `Couverture ${config.coeur.libelle} (% lignes)`,
  "couverture.lignes_global": "Couverture globale (% lignes)",
  "couverture.branches_global": "Couverture globale (% branches)",
  "code_mort.problemes": "Code mort (exports/fichiers inutilisés)",
  "architecture.violations": "Règles d'architecture violées",
  "mutation.score": "Score de mutation (%)",
};
const TOLERANCE = 0.2; // points de % : bruit de mesure de la couverture

function main() {
  const etapes = args.has("--seulement-mutation") ? [] : [typecheck, lint, testsEtCouverture, codeMort, architecture];
  for (const etape of etapes) {
    process.stdout.write(`… ${etape.name}\n`);
    etape();
  }
  if (args.has("--mutation") || args.has("--seulement-mutation")) mutation();

  const lignes = [];
  let recul = false;
  for (const [cle, libelle] of Object.entries(LIBELLES)) {
    if (!(cle in mesures)) continue;
    const s = seuils.portes[cle];
    const v = mesures[cle];
    let statut = "—";
    if (s && "max" in s) statut = v <= s.max ? "OK" : "RECUL";
    if (s && "min" in s) statut = v >= s.min - TOLERANCE ? "OK" : "RECUL";
    if (statut === "RECUL") recul = true;
    const cible = s ? ("max" in s ? `≤ ${s.max}` : `≥ ${s.min}`) : "(pas encore de seuil)";
    lignes.push({ cle, libelle, valeur: v, seuil: cible, statut });
  }

  console.log(`\nPortes qualité — ${config.app}`);
  for (const l of lignes) console.log(`  ${l.statut.padEnd(5)} ${l.libelle.padEnd(42)} ${String(l.valeur).padStart(7)}   seuil ${l.seuil}`);

  const commit = lancer("git rev-parse --short HEAD").stdout.trim();
  writeFileSync(RAPPORT, JSON.stringify({ app: config.app, date: new Date().toISOString(), commit, verdict: recul ? "RECUL" : "OK", portes: lignes, durees }, null, 2));

  if (args.has("--maj")) {
    let change = false;
    for (const l of lignes) {
      const s = seuils.portes[l.cle];
      if (!s) continue;
      if ("max" in s && (l.valeur < s.max || args.has("--forcer"))) { s.max = l.valeur; change = true; }
      if ("min" in s && (l.valeur > s.min || args.has("--forcer"))) { s.min = Math.floor(l.valeur * 10) / 10; change = true; }
    }
    if (change) {
      seuils.mis_a_jour = new Date().toISOString().slice(0, 10);
      writeFileSync(SEUILS, JSON.stringify(seuils, null, 2) + "\n");
      console.log("\nSeuils resserrés dans qualite/seuils.json (à committer).");
    }
  }

  if (recul) {
    console.log("\nVERDICT : RECUL — au moins un chiffre est moins bon que le seuil. Corriger avant de fusionner.");
    process.exit(1);
  }
  console.log("\nVERDICT : OK — aucune porte n'a reculé.");
}

main();
