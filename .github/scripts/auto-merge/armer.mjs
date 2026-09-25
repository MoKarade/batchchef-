// armer.mjs — armement de l'auto-fusion d'une PR, sous la décision du modèle de l'Atelier (autoMerge.mjs : peutArmer).
// Lancé par .github/workflows/fusion-auto.yml (pull_request_target : ce script et la liste des chemins interdits sont lus
// sur la branche de base, jamais dans la PR). Échec fermé : toute erreur = pas d'armement, et on tente de désarmer.
// Variables : GH_TOKEN, REPO (owner/nom), PR (numéro), SHA (tête de PR de l'événement).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { peutArmer } from "./autoMerge.mjs";

const { GH_TOKEN, REPO, PR, SHA } = process.env;
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const resume = (texte) => {
  console.log(texte);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${texte}\n`);
};

/** Désarme (sans erreur si la PR n'était pas armée). */
function desarmer() {
  try { gh(["pr", "merge", "--disable-auto", PR, "--repo", REPO]); } catch { /* pas armée : rien à faire */ }
}

try {
  if (!GH_TOKEN || !REPO || !/^\d+$/.test(PR || "") || !/^[0-9a-f]{40}$/.test(SHA || "")) throw new Error("variables d'environnement manquantes ou invalides");
  const config = JSON.parse(readFileSync(new URL("../../auto-merge.json", import.meta.url), "utf8"));
  const vue = JSON.parse(gh(["pr", "view", PR, "--repo", REPO, "--json", "isDraft,isCrossRepository,labels,headRefOid,state"]));
  // le SHA de l'événement doit être la tête actuelle : sinon un push plus récent a déjà déclenché son propre run
  if (vue.headRefOid !== SHA) { resume(`Tête de PR différente de l'événement (${vue.headRefOid} ≠ ${SHA}) : run ignoré.`); process.exit(0); }
  if (vue.state !== "OPEN") { resume("PR non ouverte : rien à faire."); process.exit(0); }
  const brut = gh(["api", "--paginate", `repos/${REPO}/pulls/${PR}/files`, "--jq", ".[] | {path: .filename, previous_filename: .previous_filename, status: .status, patch: .patch}"]);
  const fichiers = brut.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l));
  const decision = peutArmer({ ...vue, fichiers }, config);
  if (decision.armer) {
    gh(["pr", "merge", "--auto", "--squash", PR, "--repo", REPO]);
    resume(`Fusion automatique armée : ${decision.raison}.`);
  } else {
    desarmer();
    resume(`Fusion automatique NON armée (désarmée si elle l'était) : ${decision.raison}.`);
  }
} catch (e) {
  desarmer();
  resume(`Échec fermé, aucune fusion automatique : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
