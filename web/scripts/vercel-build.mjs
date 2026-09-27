// Build Vercel (`vercel-build` dans package.json), avec une GARDE : la base Neon est UNIQUE et partagée par les
// préversions, donc migrer / réparer depuis une préversion écrit dans la PRODUCTION avant tout merge (CLAUDE.md §6).
//
// Règle (échec fermé) : `db:migrate` et `db:reparer-ingredients` ne tournent QUE si VERCEL_ENV vaut exactement
// « production ». (Sur Vercel, VERCEL_ENV absente = build en ERREUR, voir plus bas.) « preview », « development », absente, vide ou inconnue : on saute les deux et on lance seulement le build.
// Fonctionne sous Windows et Linux (Vercel = Linux) : aucune syntaxe shell, aucune recherche dans PATH (voir lancer()).
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MIGRATION = { nom: "db:migrate", args: ["run", "db:migrate"] };
const REPARATION = { nom: "db:reparer-ingredients", args: ["run", "db:reparer-ingredients"] };
const BUILD = { nom: "build", args: ["run", "build"] };

/**
 * Plan du build, fonction PURE (aucune I/O).
 * @param {Record<string, string | undefined>} env
 * @returns {{etapes: {nom: string, args: string[]}[], message: string, erreur?: string}}  `erreur` : le build doit échouer
 */
export function etapesDeBuild(env) {
  // Sur Vercel (VERCEL=1), VERCEL_ENV est posée par le réglage « Automatically expose System Environment Variables ».
  // Désactivé, elle manque PARTOUT, production comprise : sans ce garde-fou la production ne migrerait plus, sans erreur.
  if (env.VERCEL === "1" && (env.VERCEL_ENV === undefined || env.VERCEL_ENV.trim() === "")) {
    return {
      etapes: [],
      message: "VERCEL_ENV absente sur Vercel",
      erreur: "VERCEL_ENV absente sur Vercel : vérifier le réglage « Automatically expose System Environment Variables » (variables système) du projet. Build arrêté.",
    };
  }
  if (env.VERCEL_ENV === "production") {
    return { etapes: [MIGRATION, REPARATION, BUILD], message: "production : migrations et réparation, puis build" };
  }
  return { etapes: [BUILD], message: "préversion : migrations et réparation sautées" };
}

function lancer() {
  const plan = etapesDeBuild(process.env);
  if (plan.erreur) {
    console.error(`[vercel-build] ${plan.erreur}`);
    process.exit(1);
  }
  console.log(`[vercel-build] ${plan.message}`);
  // SonarCloud S4036 : ne JAMAIS laisser un shell chercher `npm` dans PATH (un dossier du PATH modifiable par un
  // autre que son propriétaire permettrait d'y glisser un faux `npm` exécuté à la place du vrai). `vercel-build` est
  // TOUJOURS lancé PAR npm (`npm run vercel-build`, ici comme sur Vercel) : `npm_execpath` est le chemin ABSOLU du
  // VRAI npm-cli.js qui nous exécute, et `process.execPath` celui du VRAI node qui nous exécute — aucun des deux
  // n'est cherché dans PATH, aucun shell n'est invoqué. Échec fermé : sans `npm_execpath`, on s'arrête plutôt que
  // de deviner un `npm` par recherche dans PATH.
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    console.error("[vercel-build] npm_execpath absent : ce script doit être lancé par « npm run vercel-build », pas directement. Build arrêté.");
    process.exit(1);
  }
  for (const etape of plan.etapes) {
    console.log(`[vercel-build] npm ${etape.args.join(" ")}`);
    const r = spawnSync(process.execPath, [npmExecPath, ...etape.args], { stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`[vercel-build] échec de « ${etape.nom} » : build arrêté`);
      process.exit(r.status ?? 1);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) lancer();
