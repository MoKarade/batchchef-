// Build Vercel (`vercel-build` dans package.json), avec une GARDE : la base Neon est UNIQUE et partagée par les
// préversions, donc migrer / réparer depuis une préversion écrit dans la PRODUCTION avant tout merge (CLAUDE.md §6).
//
// Règle (échec fermé) : `db:migrate` et `db:reparer-ingredients` ne tournent QUE si VERCEL_ENV vaut exactement
// « production ». (Sur Vercel, VERCEL_ENV absente = build en ERREUR, voir plus bas.) « preview », « development », absente, vide ou inconnue : on saute les deux et on lance seulement le build.
// Fonctionne sous Windows et Linux (Vercel = Linux) : aucune syntaxe shell, seulement `npm run <script>`.
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
  for (const etape of plan.etapes) {
    console.log(`[vercel-build] npm ${etape.args.join(" ")}`);
    // shell : `npm` est `npm.cmd` sous Windows ; les arguments sont des constantes ci-dessus.
    const r = spawnSync("npm", etape.args, { stdio: "inherit", shell: true });
    if (r.status !== 0) {
      console.error(`[vercel-build] échec de « ${etape.nom} » : build arrêté`);
      process.exit(r.status ?? 1);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) lancer();
