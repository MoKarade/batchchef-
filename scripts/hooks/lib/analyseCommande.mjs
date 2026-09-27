// scripts/hooks/lib/analyseCommande.mjs
//
// [GATE-COMMIT-ANALYSE] Analyse (pure, sans effet de bord) de la commande Bash reçue par le hook
// `commit-gate.mjs`, pour répondre à deux questions :
//   1. La commande LANCE-t-elle vraiment un `git commit` ? (et pas seulement : « elle contient ce texte »)
//   2. Quels fichiers ce commit embarquera-t-il, y compris quand un `git add` le précède dans la MÊME
//      commande (l'index est alors encore vide au moment où le hook s'exécute) ?
//
// ⚠️ POURQUOI UN MODULE À PART : `commit-gate.mjs` lit stdin au chargement ; l'importer dans un test bloque
// (même raison que `testsHomonymes.mjs`).
//
// ⚠️ DÉFAUT SÛR : dès que l'analyse n'est pas sûre (guillemet non fermé, heredoc sans fin, `cd`, `git -C`,
// `git reset` avant le commit, `git add -p`, substitution bizarre…), le résultat est `incertain: true` et
// le hook lance la suite complète — exactement ce que faisait l'ancien hook.
//
// Le découpage suit la grammaire shell utile ici : segments séparés par `&&` `||` `;` `|` `&` et retours
// ligne ; le contenu des chaînes ('…', "…"), des heredocs (<<EOF) et des commentaires n'est JAMAIS pris
// pour une commande ; `$(…)` et `(…)` sont analysés (une commande y tourne réellement).

const MOTS_DE_TETE = new Set(['{', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time', 'exec', 'command']);
// Sous-commandes git qui modifient l'index de façon non prévisible ici → on ne devine pas.
const GIT_MUTE_INDEX = new Set(['reset', 'restore', 'checkout', 'switch', 'rm', 'mv', 'stash', 'apply', 'merge', 'cherry-pick', 'rebase', 'revert', 'pull', 'am', 'clean']);
// Options de `git commit` qui consomment le mot suivant.
const COMMIT_OPTION_AVEC_VALEUR = new Set(['-m', '-F', '-C', '-c', '-t', '--message', '--file', '--author', '--date', '--reuse-message', '--reedit-message', '--template', '--cleanup', '--trailer', '--fixup', '--squash', '--pathspec-from-file']);
const COMMIT_COURT_AVEC_VALEUR = 'mFCct';
// Options de `git` (avant la sous-commande) qui consomment le mot suivant.
const GIT_OPTION_AVEC_VALEUR = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

// Outils qui EXÉCUTENT une autre commande (enveloppes, interpréteurs) : on ne voit pas ce qu'ils lancent.
const ENVELOPPES = new Set(['env', 'eval', 'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'source', '.', 'cmd', 'powershell', 'pwsh',
  'xargs', 'sudo', 'doas', 'nice', 'nohup', 'timeout', 'watch', 'find', 'setsid', 'stdbuf', 'ionice', 'busybox', 'script',
  'python', 'python3', 'node', 'perl', 'ruby', 'php', 'deno', 'bun', 'npx']);
const INTERPRETEURS_DE_SHELL = new Set(['eval', 'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'source', '.']);
// Sous-commandes git connues et sans lien avec l'index : toute autre (alias possible : `git ci`) → incertain.
const GIT_SOUS_INOFFENSIVES = new Set(['status', 'diff', 'log', 'show', 'branch', 'fetch', 'remote', 'push', 'tag', 'config', 'rev-parse',
  'ls-files', 'ls-remote', 'ls-tree', 'blame', 'describe', 'worktree', 'reflog', 'shortlog', 'grep', 'rev-list', 'diff-tree', 'cat-file',
  'show-ref', 'for-each-ref', 'symbolic-ref', 'merge-base', 'name-rev', 'gc', 'init', 'clone', 'version', 'help', 'check-ignore',
  'submodule', 'bisect', 'notes', 'archive', 'count-objects', 'fsck', 'maintenance', 'sparse-checkout', 'whatchanged', 'range-diff']);
// Un chemin venu du texte de la commande ne doit contenir aucun caractère de contrôle ni de métacaractère shell.
const CHEMIN_HOSTILE = /[\x00-\x1f\x7f&|<>^%!`$;'"]|^-/;

class Incertain extends Error {}

/** Lit une liste de commandes jusqu'à `fermeur` (')' pour `$(…)`, '`' pour un backtick, ou fin de chaîne). */
function lireListe(s, debut, fermeur) {
  const segments = [];
  let mots = [];
  let mot = '';
  let motOuvert = false;
  let heredocs = []; // délimiteurs à consommer au prochain retour ligne
  let i = debut;

  let cibleARejeter = false; // le mot qui suit un opérateur de redirection est un fichier, pas un argument
  const finMot = () => {
    if (!motOuvert) return;
    if (cibleARejeter) cibleARejeter = false; else mots.push(mot);
    mot = ''; motOuvert = false;
  };
  const finSegment = () => { finMot(); if (mots.length) segments.push(mots); mots = []; };
  const ajoute = (c) => { mot += c; motOuvert = true; };

  while (i < s.length) {
    const c = s[i];
    if (fermeur && c === fermeur) { finSegment(); return { segments, i: i + 1 }; }
    if (c === ' ' || c === '\t' || c === '\r') { finMot(); i++; continue; }
    if (c === '\n') {
      finSegment(); i++;
      for (const h of heredocs) { i = sauteHeredoc(s, i, h); }
      heredocs = [];
      continue;
    }
    if (c === '\\') {
      if (s[i + 1] === '\n') { i += 2; continue; }
      if (i + 1 >= s.length) throw new Incertain('backslash final');
      ajoute(s[i + 1]); i += 2; continue;
    }
    if (c === '#' && !motOuvert) { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === "'") {
      const fin = s.indexOf("'", i + 1);
      if (fin < 0) throw new Incertain("guillemet simple non fermé");
      mot += s.slice(i + 1, fin); motOuvert = true; i = fin + 1; continue;
    }
    if (c === '"') { const r = lireDouble(s, i + 1); segments.push(...r.segments); mot += r.texte; motOuvert = true; i = r.i; continue; }
    if (c === '`') { const r = lireListe(s, i + 1, '`'); segments.push(...r.segments); ajoute('`'); i = r.i; continue; }
    if (c === '$' && s[i + 1] === '(') { const r = lireListe(s, i + 2, ')'); segments.push(...r.segments); ajoute('$()'); i = r.i; continue; }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      const m = /^<<-?[ \t]*(?:'([^']*)'|"([^"]*)"|([A-Za-z0-9_]+))/.exec(s.slice(i));
      if (!m) throw new Incertain('heredoc illisible');
      heredocs.push({ mot: m[1] ?? m[2] ?? m[3], tiret: s[i + 2] === '-' });
      i += m[0].length; continue;
    }
    if (c === '>' || (c === '<' && s[i + 1] !== '<')) {
      // Redirection (`> f`, `>> f`, `2>&1`, `2>/dev/null`, `< f`) : ni le descripteur ni la cible ne sont des arguments.
      if (motOuvert && /^[0-9]+$/.test(mot)) { mot = ''; motOuvert = false; } else finMot();
      i++;
      while (s[i] === '>' || s[i] === '|') i++;
      if (s[i] === '&') { i++; while (i < s.length && /[0-9-]/.test(s[i])) i++; } else cibleARejeter = true;
      continue;
    }
    if (c === '&' && s[i + 1] === '&') { finSegment(); i += 2; continue; }
    if (c === '|' && s[i + 1] === '|') { finSegment(); i += 2; continue; }
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') { finSegment(); i++; continue; }
    ajoute(c); i++;
  }
  if (fermeur) throw new Incertain(`« ${fermeur} » non fermé`);
  finSegment();
  return { segments, i };
}

/** Contenu d'une chaîne "…" : les `$(…)` et backticks y sont exécutés, le reste est du texte. */
function lireDouble(s, debut) {
  const segments = [];
  let texte = '';
  let i = debut;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') return { segments, texte, i: i + 1 };
    if (c === '\\') { texte += s[i + 1] ?? ''; i += 2; continue; }
    if (c === '$' && s[i + 1] === '(') { const r = lireListe(s, i + 2, ')'); segments.push(...r.segments); texte += '$()'; i = r.i; continue; }
    if (c === '`') { const r = lireListe(s, i + 1, '`'); segments.push(...r.segments); texte += '`'; i = r.i; continue; }
    texte += c; i++;
  }
  throw new Incertain('guillemet double non fermé');
}

/** Avance après le corps d'un heredoc (jusqu'à la ligne qui vaut le délimiteur). */
function sauteHeredoc(s, debut, { mot, tiret }) {
  let i = debut;
  while (i <= s.length) {
    let fin = s.indexOf('\n', i);
    if (fin < 0) fin = s.length;
    let ligne = s.slice(i, fin).replace(/\r$/, '');
    if (tiret) ligne = ligne.replace(/^\t+/, '');
    if (ligne === mot) return Math.min(fin + 1, s.length);
    if (fin >= s.length) break;
    i = fin + 1;
  }
  throw new Incertain('heredoc sans fin');
}

/** Retire les préfixes sans effet (VAR=x, `!`, `command`…) et rend [outil, ...args]. */
function commande(mots) {
  let k = 0;
  while (k < mots.length && (MOTS_DE_TETE.has(mots[k]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(mots[k]))) k++;
  return mots.slice(k);
}

/**
 * @typedef {object} AnalyseCommande
 * @property {boolean} estCommit       la commande lance au moins un `git commit`
 * @property {boolean} incertain       analyse non sûre → le hook doit lancer la suite complète
 * @property {string}  [raison]        pourquoi (diagnostic)
 * @property {boolean} index           l'index courant fait partie des fichiers attendus
 * @property {string[]} chemins        chemins nommés (git add X, git commit X) à résoudre par `git status`
 * @property {boolean} tousChangements `git add -A` / `.` : tout ce que `git status` liste
 * @property {boolean} suivisSeulement `git add -u` : les fichiers déjà suivis modifiés
 * @property {boolean} commitTout      `git commit -a` : fichiers suivis modifiés
 * @property {boolean} amend           `--amend` : les fichiers du dernier commit sont aussi embarqués
 */

/** @returns {AnalyseCommande} */
export function analyseCommande(cmd) {
  const vide = { estCommit: false, incertain: false, index: false, chemins: [], tousChangements: false, suivisSeulement: false, commitTout: false, amend: false };
  // Entrée non textuelle : on ne sait pas → fail-closed (suite complète), jamais « pas un commit ».
  if (typeof cmd !== 'string') return { ...vide, estCommit: true, incertain: true, raison: 'commande non textuelle', index: true };
  // Préfiltre sur le texte NORMALISÉ (guillemets et antislash retirés : `g"i"t com\mit` = `git commit`).
  const normalise = (t) => t.replace(/['"\\]/g, '');
  const evoqueGit = /git/i.test(normalise(cmd));
  if (!evoqueGit) return vide;
  const evoqueCommit = /commit/i.test(normalise(cmd));
  const mentionne = evoqueCommit;

  let segments;
  try { segments = lireListe(cmd, 0, null).segments; }
  catch (e) {
    if (!(e instanceof Incertain)) throw e;
    // Illisible : on ne bloque que si le texte évoque réellement `git … commit` ; sinon rien à garder.
    return mentionne ? { ...vide, estCommit: true, incertain: true, raison: e.message, index: true } : vide;
  }

  const r = { ...vide, chemins: [] };
  const incertain = (raison) => { r.incertain = true; r.raison ??= raison; };

  for (const seg of segments) {
    const c = commande(seg);
    if (c.length === 0) continue;
    const outil = c[0];
    const nomOutil = outil.replace(/^.*[\\/]/, '').toLowerCase().replace(/\.exe$/, '');
    if (outil === 'cd' || outil === 'pushd' || outil === 'popd') { if (!r.estCommit) r.aChangeDeDossier = true; continue; }
    const texteSegment = seg.join(' ');
    // Outil issu d'une expansion (`$G commit`) : impossible de savoir ce qu'il lance.
    if (/[$`]/.test(outil) && evoqueCommit) { r.suspect = 'outil issu d’une expansion'; continue; }
    if (ENVELOPPES.has(nomOutil)) {
      const norm = normalise(texteSegment);
      if ((/git/i.test(norm) && /commit/i.test(norm)) || (INTERPRETEURS_DE_SHELL.has(nomOutil) && /[$`]/.test(texteSegment)) || nomOutil === 'eval') {
        if (/git/i.test(norm) || evoqueCommit) r.suspect = `enveloppe « ${nomOutil} » qui peut lancer git commit`;
      }
      continue;
    }
    if (nomOutil !== 'git') continue;

    // Options globales de git, puis sous-commande.
    let k = 1;
    while (k < c.length && c[k].startsWith('-')) {
      if (c[k] === '-C' || c[k].startsWith('--git-dir') || c[k].startsWith('--work-tree')) incertain('git -C / --git-dir : autre dépôt');
      k += GIT_OPTION_AVEC_VALEUR.has(c[k]) ? 2 : 1;
    }
    const sous = c[k];
    const args = c.slice(k + 1);
    if (sous === undefined || /[$`]/.test(sous)) { if (evoqueCommit) r.suspect = 'sous-commande git issue d’une expansion'; continue; }
    if (c.slice(1, k).some(o => /alias\./i.test(o))) r.suspect = 'alias git défini en ligne';

    if (sous === 'add') {
      for (let a = 0; a < args.length; a++) {
        const x = args[a];
        if (x === '--') { for (const p of args.slice(a + 1)) ajouteChemin(r, p); break; }
        if (x === '-A' || x === '--all') r.tousChangements = true;
        else if (x === '-u' || x === '--update') r.suivisSeulement = true;
        else if (x === '-p' || x === '--patch' || x === '-i' || x === '--interactive' || x === '-e' || x === '--edit') incertain('git add interactif');
        else if (x.startsWith('--pathspec-from-file')) incertain('git add --pathspec-from-file');
        else if (x.startsWith('-')) continue;
        else ajouteChemin(r, x);
      }
      continue;
    }
    if (sous === 'commit') {
      r.estCommit = true;
      r.index = true;
      for (let a = 0; a < args.length; a++) {
        const x = args[a];
        if (x === '--') { for (const p of args.slice(a + 1)) ajouteChemin(r, p); break; }
        if (x === '--all') r.commitTout = true;
        else if (x === '--amend') r.amend = true;
        else if (x.startsWith('--pathspec-from-file')) incertain('git commit --pathspec-from-file');
        else if (x.startsWith('--')) { if (COMMIT_OPTION_AVEC_VALEUR.has(x)) a++; }
        else if (/^-[A-Za-z]+/.test(x)) {
          // Groupe d'options courtes : -a, -am, -sa… ; une lettre à valeur consomme le reste du groupe.
          let prendSuivant = false;
          for (let ch = 1; ch < x.length; ch++) {
            const l = x[ch];
            if (l === 'a') r.commitTout = true;
            if (COMMIT_COURT_AVEC_VALEUR.includes(l)) { prendSuivant = ch === x.length - 1; break; }
          }
          if (prendSuivant) a++;
        } else ajouteChemin(r, x); // `git commit fichier` : commit --only
      }
      if (r.aChangeDeDossier) incertain('cd avant le commit');
      continue;
    }
    if (GIT_MUTE_INDEX.has(sous)) { if (!r.estCommit) incertain(`git ${sous} avant le commit`); continue; }
    if (!GIT_SOUS_INOFFENSIVES.has(sous)) r.suspect = `sous-commande git inconnue « ${sous} » (alias ?)`;
  }
  delete r.aChangeDeDossier;

  // `cd` avant un commit rencontré plus tard ; et texte évoquant un commit que l'analyse n'a pas retrouvé
  // dans un segment exécuté = faux positif assumé (echo, heredoc, rapport…) → rien à garder.
  if (r.suspect) { r.estCommit = true; incertain(r.suspect); }
  delete r.suspect;
  if (!r.estCommit) return { ...vide };
  if (r.incertain) r.index = true;
  return r;
}

function ajouteChemin(r, p) {
  if (p === '.' || p === './') { r.tousChangements = true; return; }
  if (CHEMIN_HOSTILE.test(p)) { r.suspect = 'chemin avec caractère de contrôle ou métacaractère'; return; }
  r.chemins.push(p);
}

/**
 * Fichiers attendus, à partir de l'analyse et d'un accès git injecté (testable sans dépôt).
 * `git` expose : index(), suivisModifies(), dernierCommit(), status({chemins?, sansNonSuivis?}).
 * @returns {string[] | null} null = impossible de savoir → suite complète.
 */
export function fichiersAttendus(analyse, git) {
  if (!analyse.estCommit || analyse.incertain) return null;
  const out = new Set();
  const ajoute = (liste) => { for (const f of liste) out.add(f); };
  try {
    if (analyse.index) ajoute(git.index());
    if (analyse.commitTout) ajoute(git.suivisModifies());
    if (analyse.amend) ajoute(git.dernierCommit());
    if (analyse.tousChangements) ajoute(git.status({}));
    if (analyse.suivisSeulement) ajoute(git.status({ sansNonSuivis: true }));
    if (analyse.chemins.length) ajoute(git.status({ chemins: analyse.chemins }));
  } catch { return null; }
  return [...out];
}

/**
 * Fichiers qui ne peuvent PAS affecter typecheck/tests/build : la documentation seule.
 * ⚠️ Liste BLANCHE : tout le reste (package.json, lockfile, tsconfig*, configs vite/vitest, .css, scripts .mjs,
 * workflows…) est du source pour le gate. Le défaut est « ça compte ».
 */
// [MODÈLE COMMUN] Les listes ci-dessous sont les valeurs PAR DÉFAUT (celles de FinanceAI) ; chaque dépôt les surcharge dans commit-gate.json
// (`sans_effet`, `config_globale`), compilées par validerConfigGate. Le découpage de la commande (tout ce qui précède) est identique à la
// version relue par pole-securite (FinanceAI#1071, blob 4cbcd5a1) : ne PAS le modifier ici sans nouvelle relecture.
export const SANS_EFFET_PAR_DEFAUT = Object.freeze([/\.md$/i, /^docs\//]);
export const CONFIG_GLOBALE_PAR_DEFAUT = Object.freeze([
  /^(package(-lock)?\.json|tsconfig[^/]*\.json|vite[^/]*\.[cm]?[jt]s|vitest[^/]*\.[cm]?[jt]s|tailwind[^/]*|postcss[^/]*|eslint[^/]*|index\.html|\.npmrc|\.nvmrc)$/,
  /\.css$/i,
]);
const normaliserChemin = (f) => String(f).replace(/\\/g, '/');
export const estSansEffetSurLeGate = (f, motifs = SANS_EFFET_PAR_DEFAUT) => motifs.some((re) => re.test(normaliserChemin(f)));

/** `true` si au moins un fichier attendu peut changer le résultat du gate (ou si la liste est vide = inconnu). */
export const toucheLeGate = (fichiers, motifs = SANS_EFFET_PAR_DEFAUT) => fichiers.length === 0 || fichiers.some(f => !estSansEffetSurLeGate(f, motifs));

const MAX_LIGNES = 200;
const MAX_OCTETS = 20 * 1024;
/** Fin d'une sortie d'erreur, plafonnée (200 dernières lignes, 20 ko) : jamais tout un journal, jamais l'environnement. */
export const finDeSortie = (t) => {
  let out = String(t).split('\n').slice(-MAX_LIGNES).join('\n');
  if (out.length > MAX_OCTETS) out = out.slice(-MAX_OCTETS);
  return out;
};

/**
 * Fichiers de CONFIGURATION GLOBALE : ils changent le comportement de tout le typecheck/lint/build/tests, que
 * le graphe d'imports ne peut pas cibler → suite complète. (Les autres non-TS — scripts .mjs, workflows —
 * passent le gate mais restent ciblables : `vitest related` suit aussi les imports des .mjs.)
 */
export const estConfigGlobale = (f, motifs = CONFIG_GLOBALE_PAR_DEFAUT) => motifs.some((re) => re.test(normaliserChemin(f)));

// ───────────────────────── configuration par dépôt (commit-gate.json) ─────────────────────────
// La logique est COMMUNE (commit-gate.mjs + ce module) ; ce qui est propre au dépôt (étapes à lancer, fichiers sans effet, configuration globale,
// tests ciblés) vit dans commit-gate.json. Grille C de pole-securite : configuration illisible ou invalide = ÉCHEC FERMÉ (le hook bloque) ;
// jamais de shell (chaque commande est un TABLEAU d'arguments, programme dans une liste blanche) ; sortie d'erreur plafonnée (finDeSortie).
export const PROGRAMMES_AUTORISES = Object.freeze(['npm', 'node', 'python', 'python3']);
const MAX_MOTIF = 200;
const MAX_ARG = 300;

const estTexte = (x) => typeof x === 'string' && x.trim() !== '' && !/[\x00-\x1f\x7f]/.test(x);
function motifs(liste, nom) {
  if (!Array.isArray(liste)) throw new Error(`${nom} : liste de motifs attendue`);
  return liste.map((m) => {
    if (!estTexte(m) || m.length > MAX_MOTIF) throw new Error(`${nom} : motif invalide`);
    try { return new RegExp(m, 'i'); } catch { throw new Error(`${nom} : expression régulière illisible (${m})`); }
  });
}
// Options qui font exécuter du code EN LIGNE (node -e, python -c…) : refusées, la configuration ne lance que des fichiers du dépôt (qui, eux, sont relus en PR).
const EXECUTION_EN_LIGNE = {
  node: /^(--eval|--print|--input-type|-e|-p)(=|$)|^-[a-z]*[ep][a-z]*$/i,
  python: /^-[a-z]*[cm][a-z]*$/i,
};
EXECUTION_EN_LIGNE.python3 = EXECUTION_EN_LIGNE.python;
// Un argument ne sort jamais du dépôt : pas de « .. », pas de chemin absolu (Unix, Windows, UNC).
const ARGUMENT_HORS_DEPOT = /\.\.|^[\\/]|^[A-Za-z]:/;
function commandeValide(c, nom) {
  if (!Array.isArray(c) || c.length === 0 || !c.every((a) => estTexte(a) && a.length <= MAX_ARG)) throw new Error(`${nom} : commande = tableau d'arguments (texte non vide)`);
  if (!PROGRAMMES_AUTORISES.includes(c[0])) throw new Error(`${nom} : programme « ${c[0]} » hors liste blanche (${PROGRAMMES_AUTORISES.join(', ')})`);
  const enLigne = EXECUTION_EN_LIGNE[c[0]];
  for (const a of c.slice(1)) {
    if (enLigne && enLigne.test(a)) throw new Error(`${nom} : option d'exécution en ligne refusée (${a}) : lancer un fichier du dépôt`);
    if (ARGUMENT_HORS_DEPOT.test(a)) throw new Error(`${nom} : argument hors du dépôt refusé (${a.slice(0, 40)}) : ni « .. » ni chemin absolu`);
  }
  return [...c];
}

/**
 * Valide et compile commit-gate.json. Lève une Error au moindre doute (le hook bloque alors : échec fermé).
 * @returns {{sansEffet: RegExp[], configGlobale: RegExp[], etapes: {nom: string, commande: string[], cible: null | {outil: string[], extensions: string[], argsRelated: string[], argsRun: string[], toujours: string[]}}[]}}
 */
export function validerConfigGate(brut) {
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) throw new Error('configuration : objet attendu');
  if (!Array.isArray(brut.etapes) || brut.etapes.length === 0) throw new Error('etapes : au moins une étape (sinon le gate ne vérifie rien)');
  const etapes = brut.etapes.map((e, i) => {
    const nom = `etapes[${i}]`;
    if (e === null || typeof e !== 'object' || !estTexte(e.nom)) throw new Error(`${nom} : nom manquant`);
    let cible = null;
    if (e.cible !== undefined && e.cible !== null) {
      const c = e.cible;
      if (typeof c !== 'object' || !Array.isArray(c.extensions) || !c.extensions.every((x) => /^[A-Za-z0-9]{1,8}$/.test(x)) || c.extensions.length === 0) throw new Error(`${nom}.cible : extensions invalides`);
      const args = (l, n) => {
        if (!Array.isArray(l) || !l.every((a) => estTexte(a) && a.length <= MAX_ARG)) throw new Error(`${nom}.cible.${n} : liste de textes attendue`);
        if (l.some((a) => ARGUMENT_HORS_DEPOT.test(a))) throw new Error(`${nom}.cible.${n} : argument hors du dépôt refusé (ni « .. » ni chemin absolu)`);
        return [...l];
      };
      cible = { outil: commandeValide(c.outil, `${nom}.cible.outil`), extensions: [...c.extensions], argsRelated: args(c.args_related ?? [], 'args_related'), argsRun: args(c.args_run ?? [], 'args_run'), toujours: args(c.toujours ?? [], 'toujours') };
    }
    return { nom: e.nom, commande: commandeValide(e.commande, `${nom}.commande`), cible };
  });
  return {
    sansEffet: brut.sans_effet === undefined ? [...SANS_EFFET_PAR_DEFAUT] : motifs(brut.sans_effet, 'sans_effet'),
    configGlobale: brut.config_globale === undefined ? [...CONFIG_GLOBALE_PAR_DEFAUT] : motifs(brut.config_globale, 'config_globale'),
    etapes,
  };
}

/**
 * Programme et arguments réellement exécutés (SANS shell). `node` = le Node courant ; `npm` = npm-cli.js du Node courant quand il existe
 * (Windows : npm.cmd ne se lance pas sans shell), sinon le programme `npm` du PATH. `existe` est injectable (tests).
 * @returns {{programme: string, args: string[]}}
 */
export function resoudreCommande(cmd, { execPath = process.execPath, existe = () => false, joindre = (...p) => p.join('/'), dossier = (p) => p.replace(/[\\/][^\\/]*$/, '') } = {}) {
  const [prog, ...args] = cmd;
  if (prog === 'node') return { programme: execPath, args };
  if (prog === 'npm') {
    const cli = joindre(dossier(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return existe(cli) ? { programme: execPath, args: [cli, ...args] } : { programme: 'npm', args };
  }
  return { programme: prog, args };
}
