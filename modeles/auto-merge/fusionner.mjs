// fusionner.mjs — exécuteur du workflow d'auto-merge : récolte les faits (gh), appelle `decision()` (autoMerge.mjs), puis obéit.
// Aucune règle de décision ici : elles sont toutes dans autoMerge.mjs. Ce fichier ne fait que RÉCOLTER et EXÉCUTER, avec `gh` injectable
// pour les tests. Lu depuis main par le workflow (jamais depuis le code d'une PR).
//
// Échec fermé : toute lecture qui rate (API, JSON illisible) = on ne fusionne pas cette PR, et le job échoue (visible).
import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { decision, peutArmer, codeRaison, LABEL_VALIDATION } from "./autoMerge.mjs";

const TENTATIVES = 5;

/** `gh` réel : sans shell (tableau d'arguments), sortie texte. */
export function ghReel(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function avecReessais(f, attente) {
  let derniere;
  for (let essai = 1; essai <= TENTATIVES; essai++) {
    try { return f(); } catch (e) { derniere = e; if (essai < TENTATIVES) await attente(2 ** essai * 250); }
  }
  throw derniere;
}

const json = (texte, quoi) => {
  try { return JSON.parse(texte); } catch { throw new Error(`${quoi} : réponse illisible`); }
};

/** Texte sûr pour un commentaire : sans caractère de contrôle, sans backtick ni retour à la ligne, borné (un nom de fichier peut être hostile). */
export function sansRisque(texte, max = 300) {
  return String(texte).replace(/[\u0000-\u001f\u007f`]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Marqueur caché du commentaire de refus : une raison identique n'est écrite qu'UNE fois (raison différente : nouveau commentaire). */
export function marqueurRefus(raison) {
  return `<!-- auto-merge-refus:${createHash("sha256").update(String(raison)).digest("hex").slice(0, 16)} -->`;
}

/** Le refus vient-il d'un chemin ou d'un label (à expliquer à la PR) plutôt que d'un brouillon, d'un fork ou d'une config ? */
const refusAExpliquer = (raison) => /^(attestation de pole-securite|fichier sensible|chemin |label |tests affaiblis|code .* sans test associé)/.test(raison);

/**
 * Revues de la PR (attestation de pole-securite) : `gh api --paginate repos/R/pulls/N/reviews`, réduites aux champs utiles. Lecture ratée ou illisible = `null`
 * (jamais une liste vide déguisée) : `attestationValide` répond alors « non » et la PR sensible reste bloquée (échec fermé), sans faire échouer les autres PR.
 * @returns {Promise<{user: {login: string|null}, state: string, commit_id: string, submitted_at: string|null}[] | null>}
 */
export async function lireRevues(gh, repo, numero, attente = pause) {
  try {
    const brut = await avecReessais(() => gh(["api", "--paginate", `repos/${repo}/pulls/${numero}/reviews`, "--jq",
      ".[] | {user: {login: .user.login, id: .user.id, type: .user.type}, state: .state, commit_id: .commit_id, submitted_at: .submitted_at}"]), attente);
    return brut.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l));
  } catch { return null; }
}

/** Label des issues d'alerte, lues par le gérant et le cockpit (`gh issue list --label alerte-auto-merge`). */
export const LABEL_ALERTE = "alerte-auto-merge";

/**
 * Catégories FIXES des issues d'alerte. Une issue est bâtie UNIQUEMENT à partir de ce modèle (catégorie, numéro de PR, SHA court, lien du run) :
 * jamais un chemin, un nom de fichier, un message d'erreur ni un texte venant de la PR (le gérant et le cockpit lisent ces issues : un texte
 * libre serait une voie d'injection — @mention, lien, fausse consigne). Le détail (raison) reste dans le commentaire de la PR, en code inline.
 */
export const CATEGORIES = Object.freeze({
  controle_rouge: "contrôle rouge à la fusion",
  audit_impossible: "audit après fusion impossible",
  lecture_impossible: "lecture impossible",
  fusion_impossible: "fusion impossible",
  label_non_pose: "label non posé",
  commentaire_non_pose: "commentaire non posé",
  frein_horaire: "frein horaire",
  test_affaibli: "test affaibli",
  test_associe_manquant: "test associé manquant",
});

/** Texte d'une ligne de résumé : en code inline, jamais du markdown actif venant de la PR. */
const enCode = (t) => `\`${sansRisque(t, 200)}\``;

/**
 * @param {object} p
 * @param {(args: string[]) => string} p.gh
 * @param {object} p.config  contenu d'auto-merge.json (lu sur main)
 * @param {{REPO: string, BRANCHE?: string, SHA_EVENT?: string, AUTOMERGE_OFF?: string}} p.env
 * @param {() => number|string} p.maintenant
 * @param {(ligne: string) => void} p.ecrire  ligne de résumé (job summary)
 * @param {(ms: number) => Promise<void>} [p.attente]
 * @returns {Promise<{fusionnees: number[], alertes: string[], erreurs: string[]}>}
 */
export async function executer({ gh, config, env, maintenant, ecrire, sortie = () => {}, attente = pause }) {
  const repo = env.REPO;
  const res = { fusionnees: [], alertes: [], erreurs: [], signaux: [] };
  /** Enregistre une alerte (catégorie fixe + PR + SHA) : l'issue est créée à la fin, une fois par signal. */
  const signaler = (categorie, n, sha) => {
    if (!CATEGORIES[categorie]) return;
    if (!res.signaux.some((x) => x.categorie === categorie && x.n === n && x.sha === sha)) res.signaux.push({ categorie, n, sha });
  };
  if (!repo) throw new Error("REPO absent");

  const off = env.AUTOMERGE_OFF !== undefined && !["", "0"].includes(String(env.AUTOMERGE_OFF).trim());
  if (off) {
    ecrire(`- ⛔ arrêt d'urgence AUTOMERGE_OFF : aucune fusion.`);
    return res;
  }

  // PR à examiner : celle de la branche du run CI, sinon toutes les PR ouvertes (rattrapage)
  const liste = json(await avecReessais(() => gh(["pr", "list", "--repo", repo, "--state", "open", "--limit", "100", "--json", "number,headRefOid,headRefName"]), attente), "liste des PR");
  // lancement manuel pour UNE PR (workflow_dispatch, entrée `pr` : pole-securite vient d'approuver) : le numéro est validé, jamais interprété
  const numero = env.NUMERO === undefined || env.NUMERO === "" ? null : String(env.NUMERO);
  if (numero !== null && !/^[1-9][0-9]{0,8}$/.test(numero)) throw new Error("numéro de PR invalide");
  const cibles = liste.filter((p) => (!env.BRANCHE || p.headRefName === env.BRANCHE) && (numero === null || p.number === Number(numero)));
  if (cibles.length === 0) { ecrire("- aucune PR ouverte à examiner."); return res; }

  let shaCourant;   // SHA de la PR en cours d'examen (pour le modèle des alertes)
  const poserLabels = (n, labels) => {
    for (const label of labels) {
      try {
        if (label === LABEL_VALIDATION) gh(["label", "create", label, "--repo", repo, "--color", "FBCA04", "--description", "La fusion attend la validation de Marc", "--force"]);
        gh(["pr", "edit", String(n), "--repo", repo, "--add-label", label]);
      } catch (e) { res.erreurs.push(`PR #${n} : label ${label} non posé (${String(e.message).slice(0, 80)})`); signaler("label_non_pose", n, shaCourant); }
    }
  };

  /** Commentaire de refus, UNE fois par raison (marqueur caché) ; vrai si posé. */
  const expliquer = async (n, raison) => {
    const marqueur = marqueurRefus(raison);
    const existants = await avecReessais(() => gh(["api", "--paginate", `repos/${repo}/issues/${n}/comments`, "--jq", ".[].body"]), attente);
    if (existants.includes(marqueur)) return false;
    const corps = `Cette PR ne sera pas fusionnée automatiquement.\n\nRaison : \`${sansRisque(raison)}\`\n\nElle attend l'attestation de pole-securite (revue APPROVED du compte dédié sur ce commit) ; le label \`${LABEL_VALIDATION}\` est informatif.\n\n${marqueur}`;
    try { gh(["pr", "comment", String(n), "--repo", repo, "--body", corps]); return true; }
    catch (e) { res.erreurs.push(`PR #${n} : commentaire de refus non posé (${String(e.message).slice(0, 80)})`); signaler("commentaire_non_pose", n, shaCourant); return false; }
  };

  /** Nombre de PR fusionnées dans les 60 dernières minutes (toutes fusions confondues : la prudence prime). */
  const fusionsDerniereHeure = async () => {
    const liste = json(await avecReessais(() => gh(["pr", "list", "--repo", repo, "--state", "merged", "--limit", "100", "--json", "number,mergedAt"]), attente), "PR fusionnées");
    const limite = new Date(maintenant()).getTime() - 3600_000;
    return liste.filter((p) => new Date(p.mergedAt).getTime() >= limite).length;
  };

  for (const { number: n, headRefOid: shaListe } of cibles) {
    shaCourant = shaListe;
    try {
      const pr = json(await avecReessais(() => gh(["pr", "view", String(n), "--repo", repo, "--json",
        "state,isDraft,isCrossRepository,labels,mergeStateStatus,baseRefName,headRefOid,statusCheckRollup,author,createdAt"]), attente), `PR #${n}`);
      // fichiers de la PR : chemin, ancien chemin (renommage), statut et PATCH (analysé statiquement : détecteur de tests affaiblis ; absent = illisible)
      const brut = await avecReessais(() => gh(["api", "--paginate", `repos/${repo}/pulls/${n}/files`, "--jq", ".[] | {path: .filename, previous_filename: .previous_filename, status: .status, patch: .patch}"]), attente);
      const fichiers = brut.split("\n").filter((l) => l !== "").map((l) => {
        const f = json(l, `fichiers de la PR #${n}`);
        if (f.previous_filename === null || f.previous_filename === undefined) delete f.previous_filename;
        if (f.patch === null) delete f.patch;
        return f;
      });
      // dernier commit : auteur seulement s'il est VÉRIFIÉ par GitHub (sinon inconnu : Dependabot refusé, échec fermé)
      const commit = json(await avecReessais(() => gh(["api", `repos/${repo}/commits/${pr.headRefOid}`, "--jq", "{auteur: .author.login, verifie: .commit.verification.verified}"]), attente), `commit de la PR #${n}`);
      const dernierActeur = commit && commit.verifie === true ? commit.auteur : undefined;

      // application qui a publié chaque check (le nom seul ne prouve rien) : une seule application par nom, sinon « ambigu » (jamais accepté)
      const brutApps = await avecReessais(() => gh(["api", "--paginate", `repos/${repo}/commits/${pr.headRefOid}/check-runs`, "--jq", ".check_runs[] | [.name, (.app.id | tostring)] | @tsv"]), attente);
      const apps = new Map();
      for (const l of brutApps.split("\n").filter((x) => x !== "")) {
        const [nom, id] = l.split("\t");
        apps.set(nom, apps.has(nom) && apps.get(nom) !== Number(id) ? "ambigu" : Number(id));
      }
      const checks = (pr.statusCheckRollup || []).map((c) => (c && c.name && apps.has(c.name) ? { ...c, appId: apps.get(c.name) } : c));

      // revues (attestation de pole-securite) : lues seulement si le dépôt a un compte dédié (`securite_login`), sinon aucune attestation n'est possible
      const reviews = config.securite_login ? await lireRevues(gh, repo, n, attente) : [];
      if (reviews === null) ecrire(`- PR #${n} : ⚠️ revues illisibles, aucune attestation possible pour cette PR`);
      const entree = { ...pr, checks, fichiers, reviews, auteur: pr.author && pr.author.login, dernierActeur, creeLe: pr.createdAt };
      // SHA attendu : celui de l'événement (workflow_run), sinon celui de la liste (détecte un push entre la liste et la lecture)
      const shaAttendu = env.SHA_EVENT && env.BRANCHE ? env.SHA_EVENT : shaListe;
      // ARMEMENT d'abord : chemin interdit ou label de sécurité = la PR ne part pas, et on DIT pourquoi (un commentaire, une seule fois)
      const armement = peutArmer(entree, config);
      if (!armement.armer) {
        poserLabels(n, armement.etiqueter);
        const commente = refusAExpliquer(armement.raison) ? await expliquer(n, armement.raison) : false;
        if (armement.code) signaler(armement.code, n, shaCourant);
        const codeArmement = codeRaison(armement);
        sortie(`code_pr_${n}=${codeArmement}`);
        ecrire(`- PR #${n} : pas d'armement [${codeArmement}] — ${enCode(armement.raison)}${commente ? " (commentaire posé)" : ""}`);
        continue;
      }

      // frein horaire : fusions des 60 dernières minutes (lues sur GitHub) + celles de ce passage ; illisible = la PR est sautée (échec fermé)
      let fusionsHeure;
      if (config.frein_fusions_par_heure !== undefined) fusionsHeure = (await fusionsDerniereHeure()) + res.fusionnees.length;

      const d = decision(entree, config, { shaAttendu, env: { AUTOMERGE_OFF: env.AUTOMERGE_OFF }, maintenant: maintenant(), fusionsHeure });

      poserLabels(n, d.etiqueter);
      if (!d.merger) {
        const commente = d.etiqueter.length ? await expliquer(n, d.raison) : false;
        if (d.code) signaler(d.code, n, shaCourant);                      // frein horaire : alerte, sans label ni commentaire
        const codeRefus = codeRaison(d);
        sortie(`code_pr_${n}=${codeRefus}`);
        ecrire(`- PR #${n} : pas de fusion [${codeRefus}] — ${enCode(d.raison)}${d.etiqueter.length ? ` (label ${d.etiqueter.join(", ")} posé)` : ""}${commente ? " (commentaire posé)" : ""}`);
        continue;
      }

      let fait = false;
      for (let essai = 1; essai <= TENTATIVES && !fait; essai++) {
        try { gh(["pr", "merge", String(n), "--repo", repo, "--squash", "--delete-branch", "--match-head-commit", d.sha]); fait = true; }
        catch {
          const etat = (() => { try { return gh(["pr", "view", String(n), "--repo", repo, "--json", "state", "--jq", ".state"]).trim(); } catch { return ""; } })();
          if (etat === "MERGED") fait = true; else await attente(2 ** essai * 250);
        }
      }
      if (!fait) { res.erreurs.push(`PR #${n} : fusion impossible après ${TENTATIVES} essais`); signaler("fusion_impossible", n, shaCourant); ecrire(`- PR #${n} : ⚠️ fusion impossible (${enCode(d.raison)})`); continue; }
      res.fusionnees.push(n);
      sortie(`code_pr_${n}=merge_ok`);
      ecrire(`- PR #${n} : ✅ fusionnée (${d.sha.slice(0, 8)}) — ${enCode(d.raison)}`);
      // trace sur la PR elle-même : une ligne par fusion automatique (une fois par SHA)
      try {
        const marqueurFusion = `<!-- auto-merge-fusion:${d.sha.slice(0, 16)} -->`;
        const deja = await avecReessais(() => gh(["api", "--paginate", `repos/${repo}/issues/${n}/comments`, "--jq", ".[].body"]), attente);
        if (!deja.includes(marqueurFusion)) {
          gh(["pr", "comment", String(n), "--repo", repo, "--body", `Fusion automatique du commit \`${d.sha.slice(0, 8)}\` : ${sansRisque(d.raison)}.\n\n${marqueurFusion}`]);
        }
      } catch (e) { res.erreurs.push(`PR #${n} : commentaire de fusion non posé (${String(e.message).slice(0, 80)})`); signaler("commentaire_non_pose", n, shaCourant); }

      // audit après fusion : ne devrait JAMAIS trouver un contrôle requis rouge ou manquant
      try {
        const apres = json(gh(["pr", "view", String(n), "--repo", repo, "--json", "statusCheckRollup"]), `audit PR #${n}`).statusCheckRollup || [];
        const ok = (c) => (c.status === "COMPLETED" && c.conclusion === "SUCCESS") || c.state === "SUCCESS";
        const nom = (c) => c.name || c.context;
        const manquants = config.controles_requis.filter((r) => !apres.some((c) => nom(c) === r && ok(c)));
        const rouges = apres.filter((c) => !config.controles_non_bloquants.includes(nom(c)) && (c.status === "COMPLETED" ? !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c.conclusion) : c.state && c.state !== "SUCCESS"));
        if (manquants.length || rouges.length) {
          const msg = `ALERTE : PR #${n} fusionnée avec contrôle rouge ou manquant (${[...manquants, ...rouges.map(nom)].join(", ")}) — ne devrait jamais arriver`;
          res.alertes.push(msg);
          signaler("controle_rouge", n, shaCourant);
          ecrire(`- 🚨 ${enCode(msg)}`);
        }
      } catch (e) {
        res.alertes.push(`PR #${n} : audit après fusion impossible (${String(e.message).slice(0, 80)})`);
        signaler("audit_impossible", n, shaCourant);
        ecrire(`- 🚨 PR #${n} : audit après fusion impossible`);
      }
    } catch (e) {
      res.erreurs.push(`PR #${n} : ${String(e.message).slice(0, 120)}`);
      signaler("lecture_impossible", n, shaCourant);
      ecrire(`- PR #${n} : ⚠️ lecture impossible, pas de fusion`);
    }
  }
  // issues d'alerte : MODÈLE FIXE (catégorie, PR, SHA court, lien du run), une seule par signal tant qu'elle est ouverte ; aucun texte de la PR
  const urlRun = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(env.RUN_URL || "") ? env.RUN_URL : null;
  for (const { categorie, n, sha } of res.signaux) {
    try {
      const nom = CATEGORIES[categorie];
      const sha8 = /^[0-9a-f]{40}$/.test(sha || "") ? sha.slice(0, 8) : "inconnu";
      const marqueur = `<!-- auto-merge-alerte:${createHash("sha256").update(`${categorie}|${n}|${sha}`).digest("hex").slice(0, 16)} -->`;
      const ouvertes = gh(["issue", "list", "--repo", repo, "--label", LABEL_ALERTE, "--state", "open", "--limit", "100", "--json", "body", "--jq", ".[].body"]);
      if (ouvertes.includes(marqueur)) continue;
      gh(["label", "create", LABEL_ALERTE, "--repo", repo, "--color", "B60205", "--description", "Alerte de la fusion automatique (lue par le gérant et le cockpit)", "--force"]);
      const corps = `Catégorie : ${nom}\nPR : #${Number(n)}\nCommit : ${sha8}${urlRun ? `\nRun : ${urlRun}` : ""}\n\n${marqueur}`;
      gh(["issue", "create", "--repo", repo, "--title", `Alerte fusion automatique : ${nom} (PR #${Number(n)})`, "--label", LABEL_ALERTE, "--body", corps]);
      ecrire(`- 🚨 issue ${enCode(LABEL_ALERTE)} créée : ${nom} (PR #${Number(n)})`);
    } catch (e) { ecrire("- ⚠️ issue d'alerte non créée"); }
  }
  return res;
}

// ── point d'entrée (workflow) ────────────────────────────────────────────────────────────────────
async function main() {
  const configPath = process.env.AUTOMERGE_CONFIG || ".github/auto-merge.json";
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const resume = process.env.GITHUB_STEP_SUMMARY;
  const ecrire = (ligne) => { console.log(ligne); if (resume) appendFileSync(resume, ligne + "\n"); };
  const sortieJob = process.env.GITHUB_OUTPUT;
  const sortie = (ligne) => { if (sortieJob && /^code_pr_[1-9][0-9]{0,8}=[a-z_]+$/.test(ligne)) appendFileSync(sortieJob, ligne + "\n"); };
  ecrire("### Fusion automatique");
  const r = await executer({
    gh: ghReel, config, maintenant: () => Date.now(), ecrire, sortie,
    env: { REPO: process.env.REPO, BRANCHE: process.env.BRANCHE || undefined, SHA_EVENT: process.env.SHA_EVENT || undefined, AUTOMERGE_OFF: process.env.AUTOMERGE_OFF,
      NUMERO: process.env.NUMERO || undefined,
      RUN_URL: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.REPO}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined },
  });
  for (const a of r.alertes) console.log(`::error::${sansRisque(a, 200)}`);
  for (const e of r.erreurs) console.log(`::error::${sansRisque(e, 200)}`);
  process.exit(r.alertes.length || r.erreurs.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.log(`::error::${e.message}`); process.exit(1); });
}
