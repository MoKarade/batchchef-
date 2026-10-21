// Alerte « merge sans déploiement » (`DEPLOI-MUET`, tâche #203) : après un push sur `master`, vérifie que Vercel a
// créé un déploiement pour CE commit. Une CI verte ne prouve pas que le site est en ligne : un déploiement qui n'existe
// pas n'a aucun état à être rouge (docs/claude/05-deploiement.md).
//
// Ce que Vercel laisse sur le commit : un statut « Vercel » dès la création du déploiement (pending pendant le build,
// success une fois fini, ou success « Canceled by Ignored Build Step » quand `build-necessaire.sh` saute un commit
// de doc : ce CANCELED est volontaire et sain). Un merge muet (#169, 14/10/2026) n'a AUCUN statut Vercel.
//
// Échec fermé : le script sort en erreur si aucun statut Vercel n'apparaît dans le délai, si le déploiement est en
// échec, ou si l'API GitHub reste illisible. Il n'affiche jamais le jeton.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Juge les statuts d'un commit, fonction PURE (aucune I/O).
 * @param {{context?: string, state?: string, description?: string}[] | undefined} statuts  statuts les plus récents par contexte
 * @returns {{etat: "present" | "echec" | "absent", detail: string}}
 */
export function jugerStatuts(statuts) {
  const vercel = (statuts ?? []).find((s) => typeof s?.context === "string" && s.context.startsWith("Vercel"));
  if (!vercel) return { etat: "absent", detail: "aucun statut Vercel sur ce commit" };
  const detail = `${vercel.context} : ${vercel.state ?? "?"}${vercel.description ? ` (${vercel.description})` : ""}`;
  if (vercel.state === "failure" || vercel.state === "error") return { etat: "echec", detail };
  // pending (build en cours) et success (READY, ou CANCELED volontaire) prouvent tous deux que le déploiement EXISTE.
  return { etat: "present", detail };
}

/**
 * Interroge jusqu'à ce qu'un statut Vercel apparaisse. `lire` rend les statuts ou lève ; `dormir` attend `pauseMs`.
 * @param {{lire: () => Promise<{context?: string, state?: string, description?: string}[]>, dormir: (ms: number) => Promise<void>, essais: number, pauseMs: number}} o
 * @returns {Promise<{etat: "present" | "echec" | "absent" | "illisible", detail: string, essais: number}>}
 */
export async function attendreDeploiement({ lire, dormir, essais, pauseMs }) {
  let dernier = { etat: "absent", detail: "aucun essai" };
  let lectures = 0;
  let derniereErreur = "";
  for (let i = 1; i <= essais; i++) {
    try {
      dernier = jugerStatuts(await lire());
      lectures++;
      if (dernier.etat !== "absent") return { ...dernier, essais: i };
    } catch (e) {
      derniereErreur = e instanceof Error ? e.message : String(e);
    }
    if (i < essais) await dormir(pauseMs);
  }
  // Jamais lu une seule fois : on ne sait rien, ce n'est PAS la preuve d'un merge muet, mais ce n'est pas un vert non plus.
  if (lectures === 0) return { etat: "illisible", detail: `API GitHub illisible (${derniereErreur})`, essais };
  return { ...dernier, essais };
}

async function lancer() {
  const { GITHUB_REPOSITORY: depot, GITHUB_SHA: sha, GITHUB_TOKEN: jeton } = process.env;
  if (!depot || !sha || !jeton) {
    console.error("[deploiement] GITHUB_REPOSITORY, GITHUB_SHA ou GITHUB_TOKEN absent : rien n'a été vérifié.");
    process.exit(1);
  }
  const essais = Number(process.env.DEPLOIEMENT_ESSAIS ?? 20);
  const pauseMs = Number(process.env.DEPLOIEMENT_PAUSE_MS ?? 30_000);
  const lire = async () => {
    const r = await fetch(`https://api.github.com/repos/${depot}/commits/${sha}/status?per_page=100`, {
      headers: { authorization: `Bearer ${jeton}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).statuses ?? [];
  };
  const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const court = sha.slice(0, 7);
  const r = await attendreDeploiement({ lire, dormir, essais, pauseMs });
  const lignes = {
    present: `Déploiement présent pour ${court} : ${r.detail}.`,
    echec: `Déploiement EN ÉCHEC pour ${court} : ${r.detail}. La production sert encore l'ancien build.`,
    absent: `AUCUN déploiement pour ${court} après ${r.essais} essais (${(r.essais * pauseMs) / 60_000} min) : DEPLOI-MUET. La CI est verte mais le site ne sert pas ce commit. Rattrapage : un NOUVEAU push sur master (jamais « Redeploy »), voir docs/claude/05-deploiement.md.`,
    illisible: `Vérification impossible pour ${court} : ${r.detail}.`,
  };
  console.log(lignes[r.etat]);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lignes[r.etat]}\n`);
  process.exit(r.etat === "present" ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await lancer();
