// autoMerge.mjs — cette PR peut-elle être fusionnée toute seule ? Décision PURE : aucune dépendance, aucune I/O, aucune horloge cachée.
//
// Modèle commun de l'Atelier (modeles/auto-merge/). Le workflow (étape B) ne fait que récolter du JSON (gh pr view, fichiers de la PR via
// l'API, acteur du dernier push), appeler `decision`, puis obéir. Tout ce qui DÉCIDE est ici, avec ses tests.
//
// RÈGLE D'OR : le défaut est de NE PAS fusionner. Champ absent, état inconnu, lecture ratée, configuration invalide : on refuse.
// Un merge de trop est irréversible et part en production ; un merge raté se rattrape d'un clic.
//
// Ce que la configuration (auto-merge.json, lue sur main) peut faire : durcir (contrôles requis, chemins interdits, carence).
// Ce qu'elle ne peut PAS faire : retirer un chemin de chemins-interdits.json — le module ne les lit pas dans la configuration.

/** Label qui retient une PR déjà sortie du brouillon. */
export const LABEL_FREIN = "do-not-merge";
/** Label de validation humaine : présent = la fusion attend Marc. Posé (via `etiqueter`) sur les chemins sensibles. */
export const LABEL_VALIDATION = "validation-marc";
/** Auteur (et seul acteur admis) d'une PR Dependabot. Égalité stricte : « dependabot-fake » n'est pas Dependabot. */
export const DEPENDABOT = "dependabot[bot]";
/** Identifiant de l'application GitHub Actions : un contrôle REQUIS doit être publié par elle (le nom du check ne suffit pas : n'importe quelle
 *  source pourrait publier un check appelé « qualite »). Surchargeable par `app_id_requis` dans auto-merge.json. */
export const APP_GITHUB_ACTIONS = 15368;

/**
 * Chemins JAMAIS auto-fusionnés : SOURCE UNIQUE = chemins-interdits.json (import statique, aucune I/O au runtime). La configuration du
 * dépôt peut en AJOUTER (chemins_interdits), jamais en retirer : ce module ne les lit pas dans la configuration. Liste illisible = le
 * module ne se charge pas (échec fermé : aucune fusion). Lue aussi par les agents git : jamais d'auto-fusion armée sur une PR de la liste.
 */
import listeInterdite from "./chemins-interdits.json" with { type: "json" };

if (!listeInterdite || !Array.isArray(listeInterdite.chemins) || listeInterdite.chemins.length === 0 ||
    !listeInterdite.chemins.every((c) => typeof c === "string" && c.trim() !== "")) {
  throw new Error("chemins-interdits.json illisible : la fusion automatique ne se charge pas");
}
export const CHEMINS_INTERDITS = Object.freeze([...listeInterdite.chemins]);
/** Ancien nom, conservé pour les appelants et les tests. */
export const REGLES_FIXES = CHEMINS_INTERDITS;

const CONCLUSIONS_OK = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
/** CLEAN : tout vert et à jour. HAS_HOOKS : idem avec hooks. UNKNOWN (calcul asynchrone) et BEHIND (base périmée) refusent. */
const ETATS_OK = new Set(["CLEAN", "HAS_HOOKS"]);
const SHA = /^[0-9a-f]{40}$/;
/** L'API GitHub plafonne la liste des fichiers d'une PR : au-delà on ne sait pas tout, donc on refuse. */
const FICHIERS_MAX = 3000;
const JOUR_MS = 86_400_000;

const refus = (raison, extra = {}) => ({ merger: false, raison, etiqueter: [], ...extra });

// ── chemins ─────────────────────────────────────────────────────────────────────────────────────

/** Chemin normalisé pour la comparaison, ou null s'il est douteux (absolu, « .. », vide, octet de contrôle). */
export function normaliser(chemin) {
  if (typeof chemin !== "string") return null;
  // eslint-disable-next-line no-control-regex
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

/** Valide auto-merge.json. Toute erreur = refus de fusionner (la configuration illisible n'est jamais « permissive »). */
export function validerConfig(config) {
  const erreurs = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) return { ok: false, erreurs: ["configuration absente ou illisible"] };
  if (!listeDeTextes(config.controles_requis) || config.controles_requis.length === 0) erreurs.push("controles_requis : liste non vide de noms de checks");
  if (!listeDeTextes(config.chemins_interdits)) erreurs.push("chemins_interdits : liste de motifs");
  if (!listeDeTextes(config.chemins_label_validation)) erreurs.push("chemins_label_validation : liste de motifs");
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
  if (config.branche_base !== undefined && (typeof config.branche_base !== "string" || config.branche_base === "")) erreurs.push("branche_base : texte");
  if (erreurs.length === 0) {
    const requis = new Set(config.controles_requis);
    const doublon = config.controles_non_bloquants.find((n) => requis.has(n));
    if (doublon) erreurs.push(`« ${doublon} » est à la fois requis et non bloquant`);
  }
  return { ok: erreurs.length === 0, erreurs };
}

// ── checks ──────────────────────────────────────────────────────────────────────────────────────

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

/** Refus (objet) si la liste des fichiers est douteuse ou touche un chemin interdit / sensible ; sinon null. */
function examinerFichiers(pr, config) {
  if (!Array.isArray(pr.fichiers)) return refus("liste des fichiers illisible");
  if (pr.fichiers.length === 0) return refus("aucun fichier modifié");
  if (pr.fichiers.length >= FICHIERS_MAX) return refus("liste des fichiers peut-être tronquée");
  const touches = chemins(pr.fichiers);
  if (touches === null) return refus("chemin de fichier douteux");
  const fixe = touches.find((c) => correspond(c, CHEMINS_INTERDITS));
  if (fixe) return refus(`fichier sensible ${fixe} : jamais auto-fusionné, validation de Marc requise (chemins-interdits.json)`, { etiqueter: [LABEL_VALIDATION] });
  const interdit = touches.find((c) => correspond(c, config.chemins_interdits));
  if (interdit) return refus(`chemin interdit par auto-merge.json : ${interdit}`);
  const sensible = touches.find((c) => correspond(c, config.chemins_label_validation));
  if (sensible) return refus(`chemin sensible (${sensible}) : validation de Marc requise`, { etiqueter: [LABEL_VALIDATION] });
  const faible = testAffaibli(pr.fichiers);
  if (faible) return refus(faible, { etiqueter: [LABEL_VALIDATION], code: "test_affaibli" });
  const associe = testAssocieManquant(pr.fichiers, config.regles_test_associe || []);
  if (associe) return refus(associe, { etiqueter: [LABEL_VALIDATION], code: "test_associe_manquant" });
  return null;
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
  if (noms.has(LABEL_VALIDATION)) return non(`label ${LABEL_VALIDATION} : la fusion attend Marc`);
  const fautif = examinerFichiers(pr, config);
  if (fautif) return non(fautif.raison, fautif.etiqueter, fautif.code);
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
  if (noms.has(LABEL_VALIDATION)) return refus(`label ${LABEL_VALIDATION} : la fusion attend Marc`);

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
  const fautif = examinerFichiers(pr, config);
  if (fautif) return fautif;

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
    if (v === "attente" || v === "rouge") return refus(`${nom} : ${detail}`);
    if (v === "vert") {
      preuve = true;
      if (requis.has(nom) && c.appId === appIdRequis) requis.set(nom, true);   // vert ET publié par GitHub Actions (appId absent = non)
    }
  }
  const manquant = [...requis].find(([, vu]) => !vu);
  if (manquant) return refus(`contrôle requis absent, non vert ou non publié par GitHub Actions (app ${appIdRequis}) : ${manquant[0]}`);
  if (!preuve) return refus("aucun check réellement vert : rien n'a été prouvé");

  if (!ETATS_OK.has(pr.mergeStateStatus)) return refus(`état de fusion ${pr.mergeStateStatus || "inconnu"} (attendu CLEAN)`);

  return { merger: true, raison: "contrôles requis verts, chemins autorisés, SHA inchangé", etiqueter: [], sha: pr.headRefOid };
}
