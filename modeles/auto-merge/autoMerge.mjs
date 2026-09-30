// autoMerge.mjs — cette PR peut-elle être fusionnée toute seule ? Décision PURE : aucune dépendance, aucune I/O, aucune horloge cachée.
//
// Modèle commun de l'Atelier (modeles/auto-merge/). Le workflow (étape B) ne fait que récolter du JSON (gh pr view, fichiers de la PR via
// l'API, acteur du dernier push), appeler `decision`, puis obéir. Tout ce qui DÉCIDE est ici, avec ses tests.
//
// RÈGLE D'OR : le défaut est de NE PAS fusionner. Champ absent, état inconnu, lecture ratée, configuration invalide : on refuse.
// Un merge de trop est irréversible et part en production ; un merge raté se rattrape d'un clic.
//
// Ce que la configuration (auto-merge.json, lue sur main) peut faire : durcir (contrôles requis, chemins interdits, carence).
// Ce qu'elle ne peut PAS faire : retirer un chemin de chemins-interdits-*.json — le module ne les lit pas dans la configuration.

/** Label qui retient une PR déjà sortie du brouillon. */
export const LABEL_FREIN = "do-not-merge";
/** Label de validation humaine : INFORMATIF depuis l'attestation de pole-securite (il ne bloque plus ; ce qui débloque un chemin sensible est `attestationValide`).
 *  Posé (via `etiqueter`) sur les PR sensibles sans attestation, pour les rendre visibles. */
export const LABEL_VALIDATION = "validation-marc";
/** Auteur (et seul acteur admis) d'une PR Dependabot. Égalité stricte : « dependabot-fake » n'est pas Dependabot. */
export const DEPENDABOT = "dependabot[bot]";
/** Identifiant de l'application GitHub Actions : un contrôle REQUIS doit être publié par elle (le nom du check ne suffit pas : n'importe quelle
 *  source pourrait publier un check appelé « qualite »). Surchargeable par `app_id_requis` dans auto-merge.json. */
export const APP_GITHUB_ACTIONS = 15368;

/**
 * Chemins JAMAIS auto-fusionnés : chemins-interdits-base.json (générique, copié dans les apps) + chemins-interdits-atelier.json (SURCOUCHE de
 * l'Atelier : cockpit/*, tunnel ; absente des copies destinées aux apps, qui n'héritent d'aucun chemin cockpit/*). Imports JSON statiques,
 * aucune lecture de fichier au moment de la décision. La configuration du dépôt peut en AJOUTER (chemins_interdits), jamais en retirer :
 * ce module ne les lit pas dans la configuration. Base ou surcouche illisible = le module ne se charge pas (échec fermé : aucune fusion) ;
 * seule l'ABSENCE de la surcouche est normale (copie d'app). Lue aussi par les agents git : jamais d'auto-fusion armée sur une PR de la liste.
 */
import listeBase from "./chemins-interdits-base.json" with { type: "json" };

const listeValide = (l) => l && Array.isArray(l.chemins) && l.chemins.length > 0 && l.chemins.every((c) => typeof c === "string" && c.trim() !== "");
if (!listeValide(listeBase)) throw new Error("chemins-interdits-base.json illisible : la fusion automatique ne se charge pas");

let listeSurcouche = null;
try {
  listeSurcouche = (await import("./chemins-interdits-atelier.json", { with: { type: "json" } })).default;
} catch (e) {
  if (e && e.code !== "ERR_MODULE_NOT_FOUND") throw e;      // fichier présent mais illisible : échec fermé ; absent : copie d'app, base seule
}
if (listeSurcouche !== null && !listeValide(listeSurcouche)) throw new Error("chemins-interdits-atelier.json illisible : la fusion automatique ne se charge pas");

/** Base générique seule (ce que reçoit une app). */
export const CHEMINS_BASE = Object.freeze([...listeBase.chemins]);
/** Surcouche du dépôt courant (vide dans une app). */
export const CHEMINS_SURCOUCHE = Object.freeze(listeSurcouche ? [...listeSurcouche.chemins] : []);
export const CHEMINS_INTERDITS = Object.freeze([...CHEMINS_BASE, ...CHEMINS_SURCOUCHE]);
/** Ancien nom, conservé pour les appelants et les tests. */
export const REGLES_FIXES = CHEMINS_INTERDITS;

const CONCLUSIONS_OK = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
/** CLEAN : tout vert et à jour. HAS_HOOKS : idem avec hooks. UNKNOWN (calcul asynchrone) et BEHIND (base périmée) refusent. */
const ETATS_OK = new Set(["CLEAN", "HAS_HOOKS"]);
const SHA = /^[0-9a-f]{40}$/;
/** Chemins JAMAIS attestables (secrets, clés) : aucune attestation, aucune configuration d'app ne les lève. Motifs sur chemins normalisés (minuscules). */
export const JAMAIS_ATTESTABLES = Object.freeze(["**/.env*", "**/*.pem", "**/secrets/**", "**/jeton*", "**/*.key"]);
// Faux positif « jeton » (décision gérant/Marc 28/09) : SEUL le motif jeton est levé, et SEULEMENT pour un fichier de test (nom de fichier : point test point, point spec point,
// test_ puis .py, _test.py). Aucun autre motif ni aucun autre chemin n'est exempté (un test dans secrets/, un .env, une clé restent refusés).
const MOTIF_JETON = "**/jeton*";
const FICHIER_DE_TEST = Object.freeze(["**/*.test.*", "**/*.spec.*", "**/test_*.py", "**/*_test.py"]);
export const estTestExemptJeton = (chemin) => correspond(chemin, FICHIER_DE_TEST);
const jamaisAttestable = (c) => JAMAIS_ATTESTABLES.some((m) => !(m === MOTIF_JETON && estTestExemptJeton(c)) && correspond(c, [m]));
/** Login GitHub valide (lettres, chiffres, tirets ; 1 à 39 caractères) : nom du compte dédié de pole-securite, comparé EXACTEMENT (casse comprise). */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?:\[bot\])?$/;
/** Login d'une GitHub App (« <slug>[bot] ») : l'attestation par l'App exige alors l'identifiant numérique du compte bot ET le type « Bot » sur les revues. */
const estLoginBot = (login) => typeof login === "string" && login.endsWith("[bot]");
/** L'API GitHub plafonne la liste des fichiers d'une PR : au-delà on ne sait pas tout, donc on refuse. */
const FICHIERS_MAX = 3000;
const JOUR_MS = 86_400_000;

const refus = (raison, extra = {}) => ({ merger: false, raison, etiqueter: [], ...extra });

// ── chemins ─────────────────────────────────────────────────────────────────────────────────────

/** Chemin normalisé pour la comparaison, ou null s'il est douteux (absolu, « .. », vide, octet de contrôle). */
export function normaliser(chemin) {
  if (typeof chemin !== "string") return null;
  if (chemin === "" || /[\u0000-\u001f\u007f]/.test(chemin)) return null;
  let c = chemin.replace(/\\/g, "/");
  while (c.startsWith("./")) c = c.slice(2);
  if (c === "" || c.startsWith("/") || /^[A-Za-z]:/.test(c)) return null;
  const segments = c.split("/");
  if (segments.some((s) => s === ".." || s === "")) return null;
  return segments.filter((s) => s !== ".").join("/").toLowerCase();   // sans casse : .GitHub == .github sur Windows / macOS
}

function versRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

/** Le chemin (déjà normalisé) correspond-il à l'un des motifs (`**` traverse les dossiers, `*` non) ? */
export function correspond(chemin, motifs) {
  return motifs.some((m) => typeof m === "string" && versRegex(m.replace(/\\/g, "/")).test(chemin));
}

/** Liste des chemins touchés : chaînes ou {path, previous_filename} (un renommage touche l'ancien ET le nouveau chemin). */
function chemins(fichiers) {
  const out = [];
  for (const f of fichiers) {
    const liste = typeof f === "string" ? [f] : f && typeof f === "object" ? [f.path ?? f.filename, f.previous_filename].filter((x) => x !== undefined && x !== null) : [null];
    if (liste.length === 0) return null;
    for (const p of liste) {
      const n = normaliser(p);
      if (n === null) return null;
      out.push(n);
    }
  }
  return out;
}

// ── configuration ───────────────────────────────────────────────────────────────────────────────

const listeDeTextes = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim() !== "");

/** `controles_requis_un_parmi` : liste NON VIDE de groupes ; chaque groupe = au moins 2 noms de checks non vides et distincts ; un nom n'apparaît que dans un seul groupe. */
function groupesBienFormes(groupes) {
  if (!Array.isArray(groupes) || groupes.length === 0) return false;
  const vus = new Set();
  for (const g of groupes) {
    if (!listeDeTextes(g) || g.length < 2 || new Set(g).size !== g.length) return false;
    for (const nom of g) {
      if (vus.has(nom)) return false;
      vus.add(nom);
    }
  }
  return true;
}

/** Valide auto-merge.json. Toute erreur = refus de fusionner (la configuration illisible n'est jamais « permissive »). */
export function validerConfig(config) {
  const erreurs = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) return { ok: false, erreurs: ["configuration absente ou illisible"] };
  const unParmi = config.controles_requis_un_parmi;
  if (unParmi !== undefined && !groupesBienFormes(unParmi)) {
    erreurs.push("controles_requis_un_parmi : liste non vide de groupes, chacun d'au moins 2 noms de checks distincts, un nom dans un seul groupe");
  }
  const avecGroupes = Array.isArray(unParmi) && unParmi.length > 0;
  if (!listeDeTextes(config.controles_requis) || (config.controles_requis.length === 0 && !avecGroupes)) {
    erreurs.push("controles_requis : liste de noms de checks, non vide sauf si controles_requis_un_parmi fixe au moins un groupe (sinon rien ne serait vérifié)");
  }
  if (!listeDeTextes(config.chemins_interdits)) erreurs.push("chemins_interdits : liste de motifs");
  if (!listeDeTextes(config.chemins_label_validation)) erreurs.push("chemins_label_validation : liste de motifs");
  if (config.chemins_validation_visuelle !== undefined && !listeDeTextes(config.chemins_validation_visuelle)) erreurs.push("chemins_validation_visuelle : liste de motifs (chemins dont la modification demande la validation visuelle de Marc)");
  if (!listeDeTextes(config.controles_non_bloquants)) erreurs.push("controles_non_bloquants : liste de noms de checks");
  if (!Number.isInteger(config.carence_dependabot_jours) || config.carence_dependabot_jours < 0 || config.carence_dependabot_jours > 60) {
    erreurs.push("carence_dependabot_jours : entier de 0 à 60");
  }
  if (config.app_id_requis !== undefined && (!Number.isInteger(config.app_id_requis) || config.app_id_requis <= 0)) erreurs.push("app_id_requis : entier positif");
  if (config.frein_fusions_par_heure !== undefined && (!Number.isInteger(config.frein_fusions_par_heure) || config.frein_fusions_par_heure < 1 || config.frein_fusions_par_heure > 100)) {
    erreurs.push("frein_fusions_par_heure : entier de 1 à 100");
  }
  if (config.regles_test_associe !== undefined) {
    const r = config.regles_test_associe;
    if (!Array.isArray(r) || !r.every((x) => x && typeof x === "object" && typeof x.code === "string" && x.code.trim() !== "" && typeof x.test === "string" && x.test.trim() !== "")) {
      erreurs.push("regles_test_associe : liste de {code, test} (motifs)");
    }
  }
  if (config.securite_login !== undefined && (typeof config.securite_login !== "string" || (config.securite_login !== "" && !LOGIN.test(config.securite_login)))) {
    erreurs.push("securite_login : login GitHub du compte dédié ou d'une App « <slug>[bot] » (texte, vide = aucune attestation possible)");
  }
  if (typeof config.securite_login === "string" && estLoginBot(config.securite_login) && config.securite_user_id === undefined) {
    erreurs.push("securite_user_id : obligatoire quand securite_login est une App (« [bot] ») : identifiant numérique du compte bot");
  }
  if (config.chemins_attestables !== undefined && !listeDeTextes(config.chemins_attestables)) erreurs.push("chemins_attestables : liste de motifs (chemins de l'app que l'attestation peut lever)");
  if (config.securite_user_id !== undefined && (!Number.isInteger(config.securite_user_id) || config.securite_user_id <= 0)) erreurs.push("securite_user_id : entier positif (identifiant numérique du compte dédié)");
  if (config.branche_base !== undefined && (typeof config.branche_base !== "string" || config.branche_base === "")) erreurs.push("branche_base : texte");
  if (config.attestation_toutes_pr !== undefined && typeof config.attestation_toutes_pr !== "boolean") erreurs.push("attestation_toutes_pr : booléen (true ou false)");
  if (config.attestation_toutes_pr === true && (typeof config.securite_login !== "string" || config.securite_login === "")) {
    erreurs.push("attestation_toutes_pr : exige securite_login (sinon aucune attestation ne serait jamais possible)");
  }
  if (config.statut_local !== undefined) {
    const s = config.statut_local;
    const bienForme = s && typeof s === "object" && !Array.isArray(s) && typeof s.contexte === "string" && s.contexte.trim() !== ""
      && typeof s.createur_login === "string" && LOGIN.test(s.createur_login) && Number.isInteger(s.createur_id) && s.createur_id > 0;
    if (!bienForme) erreurs.push("statut_local : {contexte, createur_login, createur_id} (statut de commit publié par un compte identifié par son login ET son identifiant numérique)");
    else if (!(Array.isArray(config.controles_requis) && config.controles_requis.includes(s.contexte)) && !(avecGroupes && groupesBienFormes(unParmi) && unParmi.some((g) => g.includes(s.contexte)))) {
      erreurs.push("statut_local.contexte doit figurer dans controles_requis ou dans un groupe de controles_requis_un_parmi");
    }
  }
  if (erreurs.length === 0) {
    const requis = new Set(config.controles_requis);
    const doublon = config.controles_non_bloquants.find((n) => requis.has(n));
    if (doublon) erreurs.push(`« ${doublon} » est à la fois requis et non bloquant`);
    for (const nom of (unParmi ?? []).flat()) {
      if (requis.has(nom)) erreurs.push(`« ${nom} » est à la fois requis simple et membre d'un groupe « un parmi » (le groupe ne servirait à rien)`);
      if (config.controles_non_bloquants.includes(nom)) erreurs.push(`« ${nom} » est à la fois membre d'un groupe « un parmi » et non bloquant`);
    }
  }
  return { ok: erreurs.length === 0, erreurs };
}

// ── checks ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Statut de commit du vérificateur local (config `statut_local`) : il ne satisfait le contrôle requis de même nom QUE s'il est un vrai STATUT de commit (pas un check-run,
 * pas de champ `status`) portant `createur` = { id, login, type } EXACTEMENT égal au compte configuré (même principe que l'attestation de pole-securite : le nom du
 * statut seul ne prouve rien, n'importe qui avec un accès en écriture peut publier « portes-locales »). Type attendu : « Bot » pour un login « <slug>[bot] », sinon « User ».
 */
export function statutLocalValide(c, nom, cfg) {
  if (!cfg || typeof cfg !== "object" || nom !== cfg.contexte) return false;
  if (!c || typeof c.state !== "string" || c.status !== undefined || c.context !== nom) return false;
  const u = c.createur;
  if (!u || typeof u !== "object") return false;
  return u.id === cfg.createur_id && u.login === cfg.createur_login && u.type === (estLoginBot(cfg.createur_login) ? "Bot" : "User");
}

/**
 * Groupe « un parmi » (config `controles_requis_un_parmi`) : vrai si AU MOINS UN contrôle du groupe est vert ET vient de la bonne source, soit publié par GitHub Actions
 * (`app_id_requis`, défaut 15368), soit statut de commit du vérificateur local publié par le compte identifié (`statutLocalValide`). Le nom seul ne prouve rien.
 * Ne dit RIEN des contrôles rouges : `decision` refuse déjà tout contrôle rouge ou en attente, membre d'un groupe compris (un rouge bloque toujours).
 */
export function groupeSatisfait(checks, groupe, config) {
  if (!Array.isArray(checks) || !Array.isArray(groupe) || !config) return false;
  const appIdRequis = config.app_id_requis ?? APP_GITHUB_ACTIONS;
  return checks.some((c) => {
    const nom = nomDuCheck(c);
    return groupe.includes(nom) && verdictCheck(c).v === "vert" && (c.appId === appIdRequis || statutLocalValide(c, nom, config.statut_local));
  });
}

/**
 * Rattache le créateur du DERNIER statut de commit portant `contexte` au check correspondant de statusCheckRollup. `lignesTsv` : sortie de
 * `repos/{r}/commits/{sha}/statuses` (du plus récent au plus ancien), une ligne « contexte<TAB>état<TAB>id<TAB>login<TAB>type ». Seul le plus récent compte ;
 * s'il ne concorde pas avec l'état du rollup (course), ou s'il est illisible, AUCUN créateur n'est rattaché (échec fermé : le statut ne satisfait rien).
 */
export function rattacherCreateurs(checks, lignesTsv, contexte) {
  const dernier = String(lignesTsv ?? "").split("\n").filter((l) => l !== "").map((l) => l.split("\t")).find((p) => p[0] === contexte);
  return checks.map((c) => {
    if (!c || c.context !== contexte || typeof c.state !== "string" || c.status !== undefined) return c;
    if (!dernier || dernier.length < 5 || dernier[1] !== c.state) return c;
    const id = Number(dernier[2]);
    if (!Number.isInteger(id) || id <= 0) return c;
    return { ...c, createur: { id, login: dernier[3], type: dernier[4] } };
  });
}

const nomDuCheck = (c) => (c && (c.name || c.context)) || "check sans nom";

/**
 * Verdict d'UN check : "vert" | "rouge" | "attente". Les statuts « legacy » n'ont pas de `status` mais un `state`.
 * Une forme inconnue est « rouge » : on ne devine pas.
 */
function verdictCheck(c) {
  if (!c || typeof c !== "object") return { v: "rouge", detail: "check illisible" };
  if (typeof c.state === "string" && c.status === undefined) {
    if (c.state === "SUCCESS") return { v: "vert" };
    if (c.state === "PENDING" || c.state === "EXPECTED") return { v: "attente", detail: "en cours" };
    return { v: "rouge", detail: c.state };
  }
  if (c.status !== "COMPLETED") return { v: "attente", detail: `pas terminé (${c.status || "statut absent"})` };
  if (!CONCLUSIONS_OK.has(c.conclusion)) return { v: "rouge", detail: c.conclusion || "conclusion absente" };
  return { v: c.conclusion === "SUCCESS" ? "vert" : "neutre" };
}

// ── fichiers (partagé par decision et peutArmer) ────────────────────────────────────────────────

// ── tests affaiblis (analyse STATIQUE du patch fourni par l'API ; aucun code n'est exécuté) ─────────────────────────

/** Motifs de fichiers de tests (chemins normalisés : minuscules, séparateur « / »). */
const MOTIFS_TESTS = ["tests/**", "**/tests/**", "**/__tests__/**", "test_*.py", "**/test_*.py", "**/*_test.py", "*_test.py", "*.test.*", "**/*.test.*", "*.spec.*", "**/*.spec.*"];
export function estFichierDeTest(chemin) {
  const n = normaliser(chemin);
  return n !== null && correspond(n, MOTIFS_TESTS);
}

/** Ligne d'assertion ou de déclaration de test (unittest, pytest, node:test, jest/vitest, ava). */
const RE_ASSERTION = /^(?:await\s+)?(?:self\.assert\w*\s*\(|assert(?:\.\w+)?\s*[\s(]|assert\w+\s*\(|expect\s*\(|def\s+test_\w*|(?:async\s+)?(?:it|test|describe)\s*\(|t\.(?:is|equal|ok|deepEqual|throws|truthy|falsy)\w*\s*\(|with\s+self\.assert\w*|self\.subTest\s*\()/;
/** Assertion qui ne prouve rien : ajoutée à la place d'une vraie, elle ne compte pas. */
const RE_TRIVIALE = /^(?:assert\s+(?:True|1)\b|assert\s*\(\s*true\s*\)|assert\.ok\(\s*true\s*\)|self\.assertTrue\(\s*True\s*\)|self\.assertEqual\(\s*1\s*,\s*1\s*\)|self\.assertIsNone\(\s*None\s*\)|expect\(\s*true\s*\)|assert\s+1\s*==\s*1)/;
/** Ajout qui désactive un test. */
const RE_SAUT = /(?:@unittest\.skip|@unittest\.expectedFailure|\bexpectedFailure\b|@pytest\.mark\.(?:skip|xfail)|pytest\.(?:skip|importorskip)|\.skipTest\s*\(|\b(?:it|test|describe)\.(?:skip|todo)\b|\bx(?:it|describe|test)\s*\(|@skip\b|\b(?:sys\.)?exit\s*\(\s*0?\s*\)|\bos\._exit\s*\(|\bprocess\.exit\s*\(\s*0?\s*\)|\bif\s+False\b|\bif\s*\(\s*false\s*\))/;

function analyserPatch(patch) {
  let retirees = 0, ajoutees = 0, sauts = 0;
  for (const brute of patch.split("\n")) {
    if (brute.startsWith("+++") || brute.startsWith("---") || brute.startsWith("@@")) continue;
    const signe = brute[0];
    if (signe !== "+" && signe !== "-") continue;
    const ligne = brute.slice(1).trim();
    if (signe === "-") { if (RE_ASSERTION.test(ligne)) retirees++; continue; }
    if (RE_SAUT.test(ligne) && !ligne.startsWith("#") && !ligne.startsWith("//")) sauts++;
    if (RE_ASSERTION.test(ligne) && !RE_TRIVIALE.test(ligne)) ajoutees++;
  }
  return { retirees, ajoutees, sauts };
}

const court = (t) => String(t).replace(/[\u0000-\u001f\u007f`]+/g, " ").slice(0, 120);   // chemin borné pour une raison lisible

/**
 * Une PR qui touche des tests les AFFAIBLIT-elle ? -> raison lisible (une ligne) ou null.
 * Signalé : fichier de test supprimé ou déplacé hors des tests ; patch illisible (absent) sur un test modifié ; test qui perd plus de lignes
 * d'assertion / `def test_` / `it(` / `test(` qu'il n'en gagne (une assertion triviale n'en compte pas) ; ajout d'un saut (skip, xit…).
 * Entrées sous forme de chaînes (sans statut ni patch) : non analysables, ignorées (le workflow fournit toujours des objets).
 */
export function testAffaibli(fichiers) {
  for (const f of fichiers) {
    if (!f || typeof f !== "object") continue;
    const chemin = f.path ?? f.filename;
    const avant = f.previous_filename;
    const testActuel = estFichierDeTest(chemin), testAvant = avant ? estFichierDeTest(avant) : false;
    if (!testActuel && !testAvant) continue;
    const nom = court(testActuel ? chemin : avant);
    if (f.status === "removed") return `tests affaiblis : fichier de test supprimé (${nom})`;
    if (testAvant && !testActuel) return `tests affaiblis : test déplacé hors des tests (${nom})`;
    if (f.status === "added") continue;
    if (typeof f.patch !== "string") {
      if (f.status === "renamed") continue;                  // simple renommage : pas de patch, contenu identique
      return `tests affaiblis : diff du test illisible (${nom}), validation de Marc requise`;
    }
    const { retirees, ajoutees, sauts } = analyserPatch(f.patch);
    if (sauts > 0) return `tests affaiblis : un test est désactivé (skip) dans ${nom}`;
    if (retirees > ajoutees) return `tests affaiblis : ${nom} perd des assertions (${retirees} retirées, ${ajoutees} ajoutées)`;
  }
  return null;
}

/** Règle « test associé » : du code qui change sans qu'aucun test associé change (ajouté ou modifié, pas supprimé) -> raison, sinon null. */
function testAssocieManquant(fichiers, regles) {
  const entrees = fichiers.map((f) => (typeof f === "string"
    ? { chemin: normaliser(f), status: undefined, patch: undefined }
    : { chemin: normaliser(f && (f.path ?? f.filename)), status: f && f.status, patch: f && f.patch })).filter((f) => f.chemin !== null);
  // un test « associé » doit PROUVER quelque chose : fichier de test AJOUTÉ, ou au moins une assertion AJOUTÉE (une modification neutre
  // — commentaire, espace, renommage de variable —, un patch absent ou une simple chaîne ne suffisent pas)
  const prouve = (f) => f.status === "added" || (typeof f.patch === "string" && analyserPatch(f.patch).ajoutees > 0);
  for (const { code, test } of regles) {
    const codeTouche = entrees.find((f) => f.status !== "removed" && correspond(f.chemin, [code]) && !correspond(f.chemin, [test]));
    if (!codeTouche) continue;
    const testTouche = entrees.some((f) => f.status !== "removed" && correspond(f.chemin, [test]) && prouve(f));
    if (!testTouche) return `code ${court(codeTouche.chemin)} modifié sans test associé (${test}) : un test doit être ajouté ou une assertion ajoutée, validation de Marc requise`;
  }
  return null;
}

// ── attestation de pole-securite (docs/specs/attestation-revue.md) ─────────────────────────────────────────────

/**
 * Le compte dédié `login` a-t-il APPROUVÉ le SHA EXACT `sha` ? Fonction pure, échec fermé : tout ce qui n'est pas clairement « oui » est « non ».
 * On garde les revues du compte (`user.login` égal EXACTEMENT : pas de casse, de préfixe ni de suffixe tolérés), on prend la DERNIÈRE (`submitted_at`) ;
 * valide seulement si `state === "APPROVED"` ET `commit_id === sha`. DISMISSED, CHANGES_REQUESTED, COMMENTED, autre SHA, autre compte, liste illisible,
 * revue du compte sans date lisible, login ou SHA invalide = pas d'attestation. Les revues PENDING (jamais soumises) sont ignorées.
 * @param {unknown} reviews  revues de la PR : [{user: {login, id, type}, state, commit_id, submitted_at}]
 * Quand `userId` (securite_user_id) est configuré, une revue ne compte que si `user.id` est ce nombre : un login renommé puis réattribué à un autre compte ne trompe pas le garde.
 * GitHub App (login « <slug>[bot] ») : `userId` est OBLIGATOIRE (sans lui : pas d'attestation) et la revue doit porter `user.type === "Bot"` ; un login humain n'est jamais accepté à sa place
 * (comparaison exacte : « atelier-securite-marc » n'est pas « atelier-securite-marc[bot] », ni l'inverse).
 * @param {{login?: string, sha?: string, userId?: number}} cible  compte attendu (securite_login, lu sur la branche de base), SHA actuel de la PR, identifiant numérique (option)
 */
export function attestationValide(reviews, cible) {
  const { login, sha, userId } = cible && typeof cible === "object" ? cible : {};
  if (userId !== undefined && (!Number.isInteger(userId) || userId <= 0)) return false;
  if (typeof login !== "string" || !LOGIN.test(login)) return false;
  const bot = estLoginBot(login);
  if (bot && userId === undefined) return false;                                    // App : l'identifiant numérique du compte bot est exigé
  if (typeof sha !== "string" || !SHA.test(sha)) return false;
  if (!Array.isArray(reviews)) return false;
  let derniere = null, instant = -Infinity;
  for (const r of reviews) {
    if (!r || typeof r !== "object") return false;                                  // une entrée illisible : on ne sait pas ce qu'elle cache
    const auteur = r.user && typeof r.user === "object" ? r.user.login : undefined;
    if (auteur !== login) continue;
    if (userId !== undefined && r.user.id !== userId) continue;                        // même login, autre compte (renommage puis réattribution) : ignoré
    if (bot ? r.user.type !== "Bot" : r.user.type !== undefined && r.user.type !== "User") continue;   // App : type « Bot » exigé ; login humain : jamais un compte Bot
    if (r.state === "PENDING") continue;
    const t = typeof r.submitted_at === "string" ? Date.parse(r.submitted_at) : NaN;
    if (!Number.isFinite(t)) return false;
    if (t >= instant) { derniere = r; instant = t; }                                 // égalité : la plus tardive de la liste
  }
  return derniere !== null && derniere.state === "APPROVED" && derniere.commit_id === sha;
}

/**
 * Code de raison d'une décision (ou d'un refus d'armement) : UN élément de la liste fermée CODES_RAISON (codes-raison.mjs), écrit en sortie du job
 * (`code_pr_<numéro>`). Le `motif` posé par la décision prime ; `frein_horaire` vient du `code` existant (alerte) ; sinon on lit la raison. Tout ce qui
 * reste (fork, autre branche de base, fichier interdit, liste douteuse, configuration, arrêt d'urgence…) est « hors_perimetre » : l'auto-merge n'a pas à s'en occuper.
 * N'ajoute AUCUN champ à la décision : le `code` existant déclenche des alertes (fusionner.mjs `signaler`), ce code-ci est de l'information.
 */
export function codeRaison(d) {
  if (!d || typeof d !== "object") return "hors_perimetre";
  if (d.merger === true || d.armer === true) return "merge_ok";
  if (d.motif) return d.motif;
  if (d.code === "frein_horaire") return "frein_horaire";
  const r = String(d.raison || "");
  if (r.startsWith("attestation de pole-securite requise")) return "attestation_requise";
  if (r === "brouillon" || r.startsWith("brouillon")) return "brouillon";
  if (r === `label ${LABEL_FREIN}` || r.startsWith("validation visuelle requise")) return "do_not_merge";
  if (r.startsWith("le SHA de la PR a changé")) return "sha_change";
  if (r.startsWith("état de fusion")) return "etat_fusion";
  if (r.startsWith("aucun check") || r.startsWith("contrôle requis absent")) return "controle_en_cours";
  return "hors_perimetre";
}

/**
 * Un refus « attestable » (chemin interdit ou sensible, test affaibli, test associé manquant) est LEVÉ par une attestation valide sur le SHA actuel ;
 * sans elle il reste un refus, avec une raison qui le dit. Les autres refus (liste douteuse, brouillon…) ne sont jamais attestables.
 */
/**
 * INC-26 : `attestation_toutes_pr: true` = TOUTE PR (quels que soient ses fichiers, Dependabot compris) exige l'attestation de pole-securite (revue APPROVED de
 * `securite_login`, et `securite_user_id` si configuré, sur le SHA de tête). Refus lisible + label validation-marc (informatif) ; null si rien à exiger.
 */
function exigenceAttestationToutes(pr, config) {
  if (config.attestation_toutes_pr !== true) return null;
  const sha = typeof pr.headRefOid === "string" ? pr.headRefOid : "";
  if (attestationValide(pr.reviews, { login: config.securite_login, sha, userId: config.securite_user_id })) return null;
  return { raison: `attestation de pole-securite requise pour ${SHA.test(sha) ? sha.slice(0, 7) : "SHA inconnu"} (toutes les PR de ce dépôt : attestation_toutes_pr)`, etiqueter: [LABEL_VALIDATION] };
}

function avecAttestation(fautif, pr, config) {
  if (!fautif) return null;
  const { attestable, ...refusSimple } = fautif;
  if (!attestable) return refusSimple;
  const sha = typeof pr.headRefOid === "string" ? pr.headRefOid : "";
  if (attestationValide(pr.reviews, { login: config.securite_login, sha, userId: config.securite_user_id })) return null;
  return { ...refusSimple, raison: `attestation de pole-securite requise pour ${SHA.test(sha) ? sha.slice(0, 7) : "SHA inconnu"} (${fautif.raison})` };
}

/** Refus (objet) si la liste des fichiers est douteuse ou touche un chemin interdit / sensible ; sinon null. */
function examinerFichiers(pr, config) {
  if (!Array.isArray(pr.fichiers)) return refus("liste des fichiers illisible");
  if (pr.fichiers.length === 0) return refus("aucun fichier modifié");
  if (pr.fichiers.length >= FICHIERS_MAX) return refus("liste des fichiers peut-être tronquée");
  const touches = chemins(pr.fichiers);
  if (touches === null) return refus("chemin de fichier douteux");
  // TOUTES les catégories sont évaluées (jamais « le premier refus gagne ») : un refus NON attestable l'emporte, où qu'il se trouve ; une attestation ne lève que
  // ce qui est attestable. Non attestables : chemins_interdits de l'app (secrets, migrations… sauf ceux qu'elle déclare dans `chemins_attestables`, choix explicite relu
  // par pole-securite) et JAMAIS_ATTESTABLES (secrets, clés : toujours refusés, même si l'app les déclare attestables).
  const attestables = config.chemins_attestables || [];
  for (const c of touches) {
    const app = correspond(c, config.chemins_interdits);
    if (app && !correspond(c, attestables)) return refus(`chemin interdit par auto-merge.json : ${c}`);
    if (jamaisAttestable(c)) return refus(`chemin jamais attestable (secret, clé) : ${c}`);
  }
  // Frein VISUEL (chemins_validation_visuelle) : NON attestable (une attestation de sécurité ne remplace pas le regard de Marc sur le rendu) et évalué ICI, dans la même fonction pure
  // que les autres chemins, donc à CHAQUE passage (workflow_run, status, check_run, cron) : un fichier visuel ajouté par un commit ultérieur reçoit le label lui aussi.
  // Le label posé est `do-not-merge` (le frein DUR) : le kit ne le retire jamais (aucun `--remove-label` dans le kit), seul un retrait manuel rouvre la fusion.
  // La raison dit QUEL motif a touché QUEL fichier : elle ne ressemble jamais à un do-not-merge posé à la main pour une faille de sécurité.
  for (const motif of config.chemins_validation_visuelle || []) {
    const fichier = touches.find((c) => correspond(c, [motif]));
    if (fichier) {
      return refus(`validation visuelle requise : le motif « ${court(motif)} » de chemins_validation_visuelle touche ${court(fichier)} ; label ${LABEL_FREIN} posé, à retirer À LA MAIN par Marc après validation`,
        { etiqueter: [LABEL_FREIN], motif: "do_not_merge" });
    }
  }
  const attestable = [];
  const fixe = touches.find((c) => correspond(c, CHEMINS_INTERDITS));
  if (fixe) attestable.push(refus(`fichier sensible ${fixe} : jamais auto-fusionné, validation de Marc requise (chemins-interdits-*.json)`, { etiqueter: [LABEL_VALIDATION], attestable: true }));
  const interditLeve = touches.find((c) => correspond(c, config.chemins_interdits));       // interdit de l'app déclaré attestable (chemins_attestables)
  if (interditLeve) attestable.push(refus(`chemin interdit par auto-merge.json : ${interditLeve}`, { attestable: true }));
  const sensible = touches.find((c) => correspond(c, config.chemins_label_validation));
  if (sensible) attestable.push(refus(`chemin sensible (${sensible}) : validation de Marc requise`, { etiqueter: [LABEL_VALIDATION], attestable: true }));
  const faible = testAffaibli(pr.fichiers);
  if (faible) attestable.push(refus(faible, { etiqueter: [LABEL_VALIDATION], code: "test_affaibli", attestable: true }));
  const associe = testAssocieManquant(pr.fichiers, config.regles_test_associe || []);
  if (associe) attestable.push(refus(associe, { etiqueter: [LABEL_VALIDATION], code: "test_associe_manquant", attestable: true }));
  return attestable[0] ?? null;
}

/**
 * Peut-on ARMER l'auto-fusion de cette PR (l'activer à l'ouverture, ou laisser un workflow le faire) ? Le refus porte sur l'armement autant
 * que sur la fusion : appelée par fusionner.mjs ET par les workflows d'armement des autres dépôts, et par les agents git avant d'armer.
 * Non si : configuration invalide, brouillon, fork, label do-not-merge ou validation-marc, chemin interdit / sensible, liste de fichiers douteuse.
 * (Les checks, le SHA et la carence Dependabot ne concernent que la fusion : `decision`.)
 * @param {object} pr  mêmes champs que pour `decision` (isDraft, isCrossRepository, labels, fichiers)
 * @param {object} config  auto-merge.json
 * @returns {{armer: boolean, raison: string, etiqueter: string[]}}
 */
export function peutArmer(pr, config) {
  const non = (raison, etiqueter = [], code = undefined) => ({ armer: false, raison, etiqueter, ...(code ? { code } : {}) });
  const cfg = validerConfig(config);
  if (!cfg.ok) return non(`configuration invalide : ${cfg.erreurs.join(" ; ")}`);
  if (!pr || typeof pr !== "object") return non("aucune donnée de PR");
  if (pr.isDraft !== false) return non("brouillon");
  if (pr.isCrossRepository !== false) return non("PR venant d'un fork");
  const labels = Array.isArray(pr.labels) ? pr.labels : null;
  if (labels === null) return non("labels illisibles");
  const noms = new Set(labels.map((l) => l && l.name));
  if (noms.has(LABEL_FREIN)) return non(`label ${LABEL_FREIN}`);
  // `validation-marc` est INFORMATIF : il ne bloque plus (seule l'attestation de pole-securite lève un chemin sensible ; `do-not-merge` reste le frein)
  const fautif = avecAttestation(examinerFichiers(pr, config), pr, config);
  if (fautif) return non(fautif.raison, fautif.etiqueter, fautif.code);
  const toutes = exigenceAttestationToutes(pr, config);
  if (toutes) return non(toutes.raison, toutes.etiqueter);
  return { armer: true, raison: "aucun obstacle à l'armement", etiqueter: [] };
}

// ── décision ────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} pr  Champs de `gh pr view` + ceux que le workflow ajoute :
 *   state, isDraft, isCrossRepository, labels[{name}], mergeStateStatus, baseRefName,
 *   headRefOid (SHA actuel de la PR), checks (statusCheckRollup), fichiers (chemins de la PR, renommages compris),
 *   auteur (login de l'auteur), dernierActeur (login de qui a poussé le dernier commit), creeLe (ISO, création de la PR)
 * @param {object} config  Contenu de auto-merge.json, lu sur main (jamais dans la PR)
 * @param {object} contexte
 * @param {string} contexte.shaAttendu  SHA de l'événement qui a déclenché le workflow : doit être celui de la PR
 * @param {{AUTOMERGE_OFF?: string}} [contexte.env]  Variables d'environnement utiles (arrêt d'urgence)
 * @param {number|string|Date} contexte.maintenant  Heure de la décision (injectée : la fonction reste pure)
 * @param {number} [contexte.fusionsHeure]  Fusions des 60 dernières minutes (exigé si `frein_fusions_par_heure` est configuré)
 * @returns {{merger: boolean, raison: string, etiqueter: string[], sha?: string}} `sha` : à passer à `gh pr merge --match-head-commit`
 */
export function decision(pr, config, contexte = {}) {
  const env = contexte.env || {};

  // 0. arrêt d'urgence : AUTOMERGE_OFF défini et différent de vide / « 0 » = aucune fusion (une valeur bizarre arrête, elle ne libère pas)
  if (env.AUTOMERGE_OFF !== undefined && env.AUTOMERGE_OFF !== null && !["", "0"].includes(String(env.AUTOMERGE_OFF).trim())) {
    return refus("arrêt d'urgence AUTOMERGE_OFF");
  }

  const cfg = validerConfig(config);
  if (!cfg.ok) return refus(`configuration invalide : ${cfg.erreurs.join(" ; ")}`);
  if (!pr || typeof pr !== "object") return refus("aucune donnée de PR");

  if (pr.state !== "OPEN") return refus(`PR à l'état ${pr.state || "inconnu"}`);
  // `!== false` et non `=== true` : un champ ABSENT doit refuser, pas passer.
  if (pr.isDraft !== false) return refus("brouillon");
  if (pr.isCrossRepository !== false) return refus("PR venant d'un fork");
  if (config.branche_base && pr.baseRefName !== config.branche_base) return refus(`branche de base ${pr.baseRefName || "inconnue"} (attendu ${config.branche_base})`);

  // 1. SHA exact : la décision vaut pour CE commit, pas pour celui d'après
  if (typeof pr.headRefOid !== "string" || !SHA.test(pr.headRefOid)) return refus("SHA de la PR illisible");
  if (typeof contexte.shaAttendu !== "string" || !SHA.test(contexte.shaAttendu)) return refus("SHA attendu absent ou illisible");
  if (pr.headRefOid !== contexte.shaAttendu) return refus("le SHA de la PR a changé depuis l'événement");

  // 2. labels
  const labels = Array.isArray(pr.labels) ? pr.labels : null;
  if (labels === null) return refus("labels illisibles");
  const noms = new Set(labels.map((l) => l && l.name));
  if (noms.has(LABEL_FREIN)) return refus(`label ${LABEL_FREIN}`);
  // `validation-marc` est INFORMATIF (voir peutArmer) : le blocage vient de l'absence d'attestation, pas du label.

  // 3. auteur / Dependabot (vérifié par l'ACTEUR du dernier push, avec carence)
  if (typeof pr.auteur !== "string" || pr.auteur === "") return refus("auteur inconnu");
  if (/dependabot/i.test(pr.auteur) && pr.auteur !== DEPENDABOT) return refus(`auteur ${pr.auteur} : ressemble à Dependabot sans l'être`);
  if (pr.auteur === DEPENDABOT) {
    if (pr.dernierActeur !== DEPENDABOT) return refus(`PR Dependabot dont le dernier push vient de ${pr.dernierActeur || "un acteur inconnu"}`);
    const cree = new Date(pr.creeLe).getTime();
    const maintenant = new Date(contexte.maintenant).getTime();
    if (!Number.isFinite(cree) || !Number.isFinite(maintenant)) return refus("dates illisibles pour la carence Dependabot");
    const ageJours = (maintenant - cree) / JOUR_MS;
    if (ageJours < config.carence_dependabot_jours) return refus(`carence Dependabot : ${ageJours.toFixed(1)} j sur ${config.carence_dependabot_jours}`);
  }

  // 4. fichiers : chemins interdits (source unique) + interdits de l'app ; chemins sensibles → validation de Marc
  const fautif = avecAttestation(examinerFichiers(pr, config), pr, config);
  if (fautif) return fautif;
  // 4a. INC-26 : dépôt où TOUTE PR doit être attestée (Dependabot compris, aucune exception)
  const toutes = exigenceAttestationToutes(pr, config);
  if (toutes) return refus(toutes.raison, { etiqueter: toutes.etiqueter });

  // 4b. frein horaire : trop de fusions automatiques dans l'heure = la suite attend Marc (compte inconnu = refus)
  if (config.frein_fusions_par_heure !== undefined) {
    const n = contexte.fusionsHeure;
    if (!Number.isInteger(n) || n < 0) return refus("frein : nombre de fusions de l'heure inconnu", { code: "frein_horaire" });
    if (n >= config.frein_fusions_par_heure) {
      // refus TEMPORAIRE : SANS label (un label ne s'enlève pas tout seul, il est réservé aux vrais motifs de sécurité) ; la PR est réexaminée au passage suivant
      return refus(`frein horaire : ${n} fusions dans l'heure (plafond ${config.frein_fusions_par_heure}), la PR sera réexaminée au prochain passage`, { code: "frein_horaire" });
    }
  }

  // 5. checks : échec fermé
  const checks = Array.isArray(pr.checks) ? pr.checks : null;
  if (checks === null) return refus("checks illisibles");
  if (checks.length === 0) return refus("aucun check : rien n'a été vérifié");
  const nonBloquants = new Set(config.controles_non_bloquants);
  const requis = new Map(config.controles_requis.map((n) => [n, false]));   // nom -> vu vert (et de la bonne application)
  const appIdRequis = config.app_id_requis ?? APP_GITHUB_ACTIONS;
  let preuve = false;
  for (const c of checks) {
    const nom = nomDuCheck(c);
    if (nonBloquants.has(nom)) continue;         // déclaré non bloquant : ni preuve, ni obstacle (ex. revue d'agent lente ou en course)
    const { v, detail } = verdictCheck(c);
    if (v === "attente" || v === "rouge") return refus(`${nom} : ${detail}`, { motif: v === "rouge" ? "controle_rouge" : "controle_en_cours" });
    if (v === "vert") {
      preuve = true;
      // vert ET publié par GitHub Actions (appId absent = non), OU statut de commit du vérificateur local publié par le compte identifié (statut_local)
      if (requis.has(nom) && (c.appId === appIdRequis || statutLocalValide(c, nom, config.statut_local))) requis.set(nom, true);
    }
  }
  const manquant = [...requis].find(([, vu]) => !vu);
  if (manquant) return refus(`contrôle requis absent, non vert ou non publié par GitHub Actions (app ${appIdRequis}) : ${manquant[0]}`);
  const groupeManquant = (config.controles_requis_un_parmi ?? []).find((g) => !groupeSatisfait(checks, g, config));
  if (groupeManquant) return refus(`aucun contrôle vert de la bonne source parmi (un parmi) : ${groupeManquant.join(", ")}`);
  if (!preuve) return refus("aucun check réellement vert : rien n'a été prouvé");

  if (!ETATS_OK.has(pr.mergeStateStatus)) return refus(`état de fusion ${pr.mergeStateStatus || "inconnu"} (attendu CLEAN)`);

  return { merger: true, raison: "contrôles requis verts, chemins autorisés, SHA inchangé", etiqueter: [], sha: pr.headRefOid };
}
