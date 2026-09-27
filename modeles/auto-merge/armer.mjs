// armer.mjs — exécuteur d'ARMEMENT de l'auto-fusion native de GitHub (gabarit-armement.yml). Arme ou DÉSARME la PR selon `peutArmer` (autoMerge.mjs).
//
// Lu et exécuté depuis la branche de BASE (jamais le code de la PR : le workflow ne fait checkout que de la base). La PR n'est lue QUE par l'API `gh`.
// Entrées : variables d'environnement REPO, NUMERO, SHA (numéro et SHA validés par expression régulière : les seules valeurs venant de la PR),
// ACTION (nom de l'événement, informatif), AUTOMERGE_OFF (arrêt d'urgence). Configuration : `.github/auto-merge.json` de la base.
//
// ÉCHEC FERMÉ : toute erreur, champ absent ou lecture impossible = PAS d'armement, et DÉSARMEMENT si la PR était déjà armée (un label ou un
// nouveau commit sur un chemin sensible doit toujours retirer l'armement). Aucun texte de la PR (titre, branche, corps) n'est jamais utilisé.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DEPENDABOT, LABEL_VALIDATION, peutArmer } from "./autoMerge.mjs";
import { lireRevues, marqueurRefus, sansRisque } from "./fusionner.mjs";

const RE_NUMERO = /^[1-9][0-9]{0,8}$/;
const RE_SHA = /^[0-9a-f]{40}$/;
const TENTATIVES = 3;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function avecReessais(f, attente) {
  let derniere;
  for (let essai = 1; essai <= TENTATIVES; essai++) {
    try { return f(); } catch (e) { derniere = e; if (essai < TENTATIVES) await attente(2 ** essai * 250); }
  }
  throw derniere;
}
const json = (t, quoi) => { try { return JSON.parse(t); } catch { throw new Error(`${quoi} : réponse illisible`); } };

/** Refus à expliquer par un commentaire (chemin, label, test) plutôt qu'un simple brouillon / fork / configuration. */
const AEXPLIQUER = /^(attestation de pole-securite|fichier sensible|chemin |label |tests affaiblis|code .* sans test associé)/;

/**
 * @returns {Promise<{etat: "arme"|"desarme"|"inchange"|"ignore", raison: string}>}
 * @throws si l'entrée est invalide ou si une lecture échoue APRÈS tentative de désarmement (le job doit alors échouer, visiblement)
 */
export async function armer({ gh, config, env, ecrire = () => {}, attente = pause }) {
  const repo = env.REPO;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("REPO absent ou invalide");
  const numero = String(env.NUMERO ?? "");
  if (!RE_NUMERO.test(numero)) throw new Error("numéro de PR invalide");           // sans numéro valide on ne peut même pas désarmer : le job échoue
  let sha = String(env.SHA ?? "");
  const action = /^[a-z_]{1,40}$/.test(env.ACTION ?? "") ? env.ACTION : "inconnue";
  // Lancement manuel (workflow_dispatch : pole-securite a approuvé, il relance la base pour CE numéro) : pas d'événement de PR, donc pas de SHA d'événement ;
  // le SHA est lu maintenant sur la PR, et `--match-head-commit` protège contre une poussée entre la lecture et l'armement.
  const manuel = action === "workflow_dispatch" && sha === "";

  const armee = () => {
    const v = json(gh(["pr", "view", numero, "--repo", repo, "--json", "autoMergeRequest"]), "état d'armement");
    return v.autoMergeRequest !== null && v.autoMergeRequest !== undefined;
  };
  /** Désarme si la PR est armée ; en cas de doute sur l'état, tente quand même. */
  const desarmer = (raison) => {
    let etait = true;
    try { etait = armee(); } catch { etait = true; }
    if (etait) {
      try { gh(["pr", "merge", numero, "--repo", repo, "--disable-auto"]); } catch (e) { if (/not enabled|not.*auto/i.test(String(e.message))) return "inchange"; throw e; }
      ecrire(`- PR #${numero} (${action}) : désarmée — \`${sansRisque(raison, 200)}\``);
      return "desarme";
    }
    ecrire(`- PR #${numero} (${action}) : non armée — \`${sansRisque(raison, 200)}\``);
    return "inchange";
  };

  try {
    if (env.AUTOMERGE_OFF !== undefined && !["", "0"].includes(String(env.AUTOMERGE_OFF).trim())) {
      return { etat: desarmer("arrêt d'urgence AUTOMERGE_OFF"), raison: "arrêt d'urgence" };
    }
    if (!manuel && !RE_SHA.test(sha)) throw new Error("SHA invalide");
    const pr = json(await avecReessais(() => gh(["pr", "view", numero, "--repo", repo, "--json",
      "state,isDraft,isCrossRepository,labels,baseRefName,headRefOid,author,autoMergeRequest"]), attente), `PR #${numero}`);
    if (pr.state !== "OPEN") { ecrire(`- PR #${numero} (${action}) : ${sansRisque(pr.state, 20)}, rien à faire`); return { etat: "ignore", raison: "PR non ouverte" }; }

    if (manuel) sha = String(pr.headRefOid ?? "");
    if (!RE_SHA.test(sha)) throw new Error("SHA invalide");
    // la décision vaut pour CE commit : si la tête a bougé depuis l'événement, on désarme (un nouvel événement `synchronize` réévaluera)
    if (pr.headRefOid !== sha) return { etat: desarmer("le SHA de la PR a changé depuis l'événement"), raison: "SHA changé" };
    if (config.branche_base && pr.baseRefName !== config.branche_base) return { etat: desarmer("branche de base non prévue"), raison: "base" };
    const auteur = pr.author && pr.author.login;
    if (typeof auteur !== "string" || auteur === "") return { etat: desarmer("auteur inconnu"), raison: "auteur" };
    // Dependabot : l'auto-fusion NATIVE ignore la carence ; ces PR sont laissées au workflow de fusion (carence, dernier commit vérifié)
    if (/dependabot/i.test(auteur) || auteur === DEPENDABOT) return { etat: desarmer("PR Dependabot : traitée par le workflow de fusion (carence)"), raison: "dependabot" };

    const brut = await avecReessais(() => gh(["api", "--paginate", `repos/${repo}/pulls/${numero}/files`, "--jq",
      ".[] | {path: .filename, previous_filename: .previous_filename, status: .status, patch: .patch}"]), attente);
    const fichiers = brut.split("\n").filter((l) => l !== "").map((l) => {
      const f = json(l, `fichiers de la PR #${numero}`);
      if (f.previous_filename === null || f.previous_filename === undefined) delete f.previous_filename;
      if (f.patch === null) delete f.patch;
      return f;
    });

    // attestation de pole-securite : revues lues seulement si le dépôt a un compte dédié ; lecture ratée (null) = aucune attestation
    const reviews = config.securite_login ? await lireRevues(gh, repo, numero, attente) : [];
    const d = peutArmer({ ...pr, fichiers, reviews, auteur, creeLe: undefined }, config);
    if (!d.armer) {
      const etat = desarmer(d.raison);
      for (const label of d.etiqueter) {
        try {
          if (label === LABEL_VALIDATION) gh(["label", "create", label, "--repo", repo, "--color", "FBCA04", "--description", "La fusion attend la validation de Marc", "--force"]);
          gh(["pr", "edit", numero, "--repo", repo, "--add-label", label]);
        } catch (e) { ecrire(`- ⚠️ label ${sansRisque(label, 40)} non posé`); }
      }
      if (AEXPLIQUER.test(d.raison)) {                                  // la raison (chemin ou label fautif) est écrite UNE fois sur la PR
        const marqueur = marqueurRefus(d.raison);
        try {
          const existants = gh(["api", "--paginate", `repos/${repo}/issues/${numero}/comments`, "--jq", ".[].body"]);
          if (!existants.includes(marqueur)) {
            gh(["pr", "comment", numero, "--repo", repo, "--body",
              `Cette PR ne sera pas fusionnée automatiquement.\n\nRaison : \`${sansRisque(d.raison)}\`\n\nElle attend l'attestation de pole-securite (revue APPROVED du compte dédié sur ce commit) ; le label \`${LABEL_VALIDATION}\` est informatif.\n\n${marqueur}`]);
          }
        } catch { ecrire("- ⚠️ commentaire de refus non posé"); }
      }
      return { etat, raison: d.raison };
    }

    if (pr.autoMergeRequest) { ecrire(`- PR #${numero} (${action}) : déjà armée`); return { etat: "inchange", raison: "déjà armée" }; }
    gh(["pr", "merge", numero, "--repo", repo, "--auto", "--squash", "--match-head-commit", sha]);
    ecrire(`- PR #${numero} (${action}) : ✅ armée (${sha.slice(0, 8)})`);
    return { etat: "arme", raison: d.raison };
  } catch (e) {
    // ÉCHEC FERMÉ : tout échec désarme
    try { desarmer("échec de l'évaluation"); } catch { /* le job échoue de toute façon */ }
    throw e;
  }
}

async function main() {
  const config = JSON.parse(readFileSync(process.env.AUTOMERGE_CONFIG || ".github/auto-merge.json", "utf8"));
  const { ghReel } = await import("./fusionner.mjs");
  const resume = process.env.GITHUB_STEP_SUMMARY;
  const ecrire = async (l) => { console.log(l); if (resume) (await import("node:fs")).appendFileSync(resume, l + "\n"); };
  const lignes = [];
  await armer({ gh: ghReel, config, ecrire: (l) => lignes.push(l), env: {
    REPO: process.env.REPO, NUMERO: process.env.NUMERO, SHA: process.env.SHA, ACTION: process.env.ACTION, AUTOMERGE_OFF: process.env.AUTOMERGE_OFF } });
  for (const l of ["### Armement de l'auto-fusion", ...lignes]) await ecrire(l);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.log(`::error::${sansRisque(e.message, 200)}`); process.exit(1); });
}
