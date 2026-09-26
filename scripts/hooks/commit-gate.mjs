#!/usr/bin/env node
// MODÈLE COMMUN — PreToolUse (Bash) : avant tout `git commit`, exige que les étapes du dépôt (typecheck, tests ciblés, build…) soient vertes.
// exit 2 = bloque. Copie du modèle de l'Atelier (modeles/qualite/), généralisée à partir de FinanceAI/scripts/hooks/commit-gate.mjs (#1071, relu par pole-securite).
//
// COMMUN (ce fichier + lib/analyseCommande.mjs) : lecture de la commande, détection d'un VRAI `git commit`, fichiers attendus, exécution SANS shell, plafond de sortie.
// PROPRE AU DÉPÔT (commit-gate.json, à côté de ce fichier) : étapes à lancer, fichiers sans effet, configuration globale, tests ciblés. Voir modeles/qualite/commit-gate.json.
//
// Grille C de pole-securite :
//   C1  préfiltre sur le texte NORMALISÉ (guillemets et antislash retirés) ; enveloppes (bash -c, env, xargs…) = incertain → suite complète ;
//   C2  aucun shell : chaque commande est un TABLEAU d'arguments (execFileSync), programme dans une liste blanche, chemins après `--` ;
//   C3  sortie d'erreur plafonnée (200 lignes, 20 ko) ;
//   échec fermé : entrée illisible, configuration illisible ou invalide, git en échec, analyse incertaine → on bloque ou on lance la suite complète, jamais « laisse passer ».
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { analyseCommande, fichiersAttendus, toucheLeGate, estConfigGlobale, finDeSortie, validerConfigGate, resoudreCommande } from './lib/analyseCommande.mjs';

// Entrée illisible = on ne sait pas ce qui va être lancé : fail-closed (exit 2 + message).
let cmd;
try {
  const entree = JSON.parse(readFileSync(0, 'utf8'));
  cmd = entree?.tool_input?.command ?? '';
} catch (e) {
  process.stderr.write(`Commit-gate : entrée du hook illisible (${e?.message ?? e}). Bloqué par prudence.\n`);
  process.exit(2);
}

// On ne réagit qu'à un VRAI segment shell `git commit` (pas au texte d'un echo, d'un heredoc ou d'un rapport) ; incertain → suite complète.
const analyse = analyseCommande(cmd);
if (!analyse.estCommit) process.exit(0);

// Configuration du dépôt : APRÈS la détection (une commande sans rapport avec un commit ne dépend jamais de la configuration), illisible = on bloque.
let config;
try {
  const fichier = join(dirname(fileURLToPath(import.meta.url)), 'commit-gate.json');   // à côté du script, jamais une variable d'environnement
  config = validerConfigGate(JSON.parse(readFileSync(fichier, 'utf8')));
} catch (e) {
  process.stderr.write(`Commit-gate : configuration illisible ou invalide (${e?.message ?? e}). Bloqué par prudence.\n`);
  process.exit(2);
}

// ⚠️ SANS SHELL : les chemins viennent du texte de la commande, AVANT qu'elle soit approuvée. `execFileSync(programme, [tableau])`
// n'interprète rien ; les chemins viennent après `--`.
const MAX = 64 * 1024 * 1024;
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX }).split('\0').filter(Boolean);
// `git status --porcelain -z` : « XY chemin » ; pour un renommage, l'entrée suivante est l'ancien nom.
const statut = ({ chemins = [], sansNonSuivis = false }) => {
  const args = ['status', '--porcelain', '-z', `--untracked-files=${sansNonSuivis ? 'no' : 'all'}`];
  if (chemins.length) args.push('--', ...chemins);
  const entrees = git(args);
  const out = [];
  for (let i = 0; i < entrees.length; i++) {
    out.push(entrees[i].slice(3));
    if (/^[RC]/.test(entrees[i])) i++;
  }
  return out;
};

// Fichiers que le commit EMBARQUERA (un `git add` peut précéder dans la même commande). Analyse incertaine ou git en échec → liste vide → suite complète.
const attendus = fichiersAttendus(analyse, {
  index: () => git(['diff', '--cached', '--name-only', '-z']),
  suivisModifies: () => git(['diff', '--name-only', '-z']),
  dernierCommit: () => git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD']),
  status: statut,
});
const stagedFiles = attendus ?? [];
// Liste BLANCHE des fichiers sans effet (config `sans_effet`) : tout le reste compte comme du source.
if (!toucheLeGate(stagedFiles, config.sansEffet)) process.exit(0);

const executer = (cmd2) => {
  const { programme, args } = resoudreCommande(cmd2, { existe: existsSync, joindre: join, dossier: dirname });
  return execFileSync(programme, args, { stdio: 'pipe', maxBuffer: 256 * 1024 * 1024 });
};

// Tests CIBLÉS (étape avec `cible`) : uniquement les tests AFFECTÉS par les fichiers stagés ; la suite COMPLÈTE reste exécutée en CI. Suite complète si :
// liste indisponible, configuration globale touchée (ne se cible pas par le graphe d'imports), nom de fichier commençant par « - », outil de ciblage absent.
const cibleImpossible = stagedFiles.some((f) => estConfigGlobale(f, config.configGlobale)) || stagedFiles.some((f) => f.startsWith('-'));
function executerEtape(etape) {
  const c = etape.cible;
  const extensions = c ? new RegExp(`\\.(${c.extensions.join('|')})$`) : null;
  const sources = c ? stagedFiles.filter((f) => extensions.test(f) && existsSync(f) && !f.startsWith('-')) : [];
  const outilPresent = c ? existsSync(resolve(c.outil[c.outil.length - 1])) : false;
  if (!c || sources.length === 0 || cibleImpossible || !outilPresent) return executer(etape.commande);
  executer([...c.outil, ...c.argsRelated, ...sources]);
  const toujours = c.toujours.filter((f) => existsSync(f));           // tests-gardes qui lisent le SOURCE : jamais trouvés par le graphe d'imports
  if (toujours.length) executer([...c.outil, ...c.argsRun, ...toujours]);
}

for (const etape of config.etapes) {
  try { executerEtape(etape); }
  catch (e) {
    // L'erreur d'origine (fin plafonnée) : sortie standard + erreur + cause système (ENOBUFS, signal, code de sortie).
    const sortie = ((e.stdout?.toString() || '') + (e.stderr?.toString() || '')).trimEnd();
    const cause = [e.code && `code=${e.code}`, e.signal && `signal=${e.signal}`, e.status != null && `sortie=${e.status}`].filter(Boolean).join(' ');
    process.stderr.write(`Commit bloqué : ${etape.nom} a échoué${cause ? ' (' + cause + ')' : ''}. Corrige avant de committer.\n`);
    process.stderr.write(finDeSortie(sortie || e.message || String(e)) + '\n');
    process.exit(2);
  }
}
process.exit(0);
