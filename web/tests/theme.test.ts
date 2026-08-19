// Verrou du socle visuel : les couleurs vivent dans `app/globals.css`, en variables, et
// NULLE PART ailleurs (CLAUDE.md, « Direction visuelle »).
//
// Pourquoi ce fichier existe — incident du 2026-08-14, signalé par Marc : « le texte est
// blanc sur blanc parfois alors que ça doit pas, c'est illisible ». Ma passe de refonte
// avait remplacé les variantes `dark:bg-stone-900` par des jetons tout en LAISSANT le
// `bg-white` figé qu'elles corrigeaient : en thème sombre, fond blanc en dur sous un texte
// clair hérité. Vingt-et-un endroits, aucun test rouge, aucune erreur — seul l'œil de Marc
// l'a vu, sur son téléphone.
//
// Le défaut n'est pas rattrapable par la relecture : une couleur figée est parfaitement
// lisible dans le thème pour lequel elle a été écrite. Il faut une machine qui les compte.
//
// ⚠️ Ne pas s'alarmer en lisant le CSS servi : il contient des règles `.bg-white` et
// `.dark\:bg-stone-900` que PLUS AUCUN balisage n'utilise. Tailwind v4 balaie tout le dépôt,
// commentaires et Markdown compris — les deux noms ci-dessus sont générés par la PROSE qui
// raconte le bug (ce fichier, et la leçon de CLAUDE.md). Cousin du garde de JobAI qui
// bloquait sur la chaîne prouvant qu'il détectait quelque chose : il détectait le détecteur.
// Inerte (quelques dizaines d'octets), et la vérification qui tranche reste le balisage —
// le HTML servi, jamais la présence d'une règle dans la feuille.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Ce qu'un `git add -A` emporterait : le suivi ET le neuf non ignoré.
 *
 * Un garde limité à `git ls-files` arrive UN COMMIT TROP TARD — un fichier neuf n'y figure
 * qu'une fois la faute déjà dans l'historique (leçon JobAI, 2026-08-05 : gate local vert
 * avant le commit, CI rouge juste après, le fichier fautif déjà en ligne). L'état le plus
 * courant du dépôt est justement celui-là : juste avant le commit.
 *
 * Échoue si git est indisponible : « je ne peux pas vérifier » n'est pas « c'est bon ».
 */
function fichiersAConsiderer(prefixes: string[]): string[] {
  const suivis = execFileSync("git", ["ls-files", "--", ...prefixes], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const neufs = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "--", ...prefixes],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const tous = [...suivis.split("\n"), ...neufs.split("\n")].filter(Boolean);
  return [...new Set(tous)].filter((f) => f.endsWith(".tsx") || f.endsWith(".ts")).sort();
}

/**
 * PÉRIMÈTRE POSITIF : les trois dossiers qui produisent du balisage.
 *
 * Ce n'est pas « tout sauf les tests » — un garde qui s'exclut d'un dossier entier s'en
 * exclut pour toujours et laisse un angle mort permanent que plus rien ne signale. Ici la
 * question posée est « ce qui s'affiche suit-il le thème ? », et seuls ces dossiers
 * s'affichent. `tests/` n'est pas exempté : il est hors sujet.
 */
const DOSSIERS_RENDUS = ["app", "components", "lib"];

/** Palettes Tailwind : elles ne connaissent pas `prefers-color-scheme`. */
const PALETTES =
  "white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PROPRIETES =
  "bg|text|border|placeholder|ring|from|to|via|divide|decoration|outline|accent|caret|fill|stroke|shadow";

const COULEUR_FIGEE = new RegExp(
  `\\b(?:${PROPRIETES})-(?:${PALETTES})(?:-\\d{2,3})?(?:/\\d{1,3})?\\b`,
  "g",
);

/**
 * Les exceptions, nommées ici plutôt que dans une liste de fichiers exclus.
 *
 * Exempter un fichier l'exempte aussi pour la ligne qu'on y ajoutera demain. On exempte
 * donc des CLASSES précises, dans un fichier précis, avec le motif écrit : le reste du
 * fichier reste gardé.
 *
 * Le point commun des deux : ces couleurs ne se jouent PAS contre une surface du thème
 * (une photo, la page assombrie). C'est le seul motif admis — « c'était plus simple » n'en
 * est pas un. Le 19/08, ce garde a attrapé le voile de la modale que je venais d'écrire :
 * il fonctionne sur du code neuf, pas seulement sur l'historique qui l'a fait naître.
 */
const EXCEPTIONS: { fichier: string; classes: string[]; pourquoi: string }[] = [
  {
    fichier: "components/FicheRecetteModale.tsx",
    classes: ["bg-black/50"],
    pourquoi:
      "Voile (`::backdrop`) d'une modale : il assombrit la PAGE, pas une surface du thème. " +
      "Un noir translucide fait le même travail en clair et en sombre — c'est le contraste " +
      "avec la page qu'il crée, pas avec `--fond`.",
  },
  {
    fichier: "components/CatalogueGrid.tsx",
    classes: ["border-white/80", "bg-black/30", "bg-black/50"],
    pourquoi:
      "Case de sélection posée SUR la photo de la recette : son contraste se joue contre " +
      "l'image, jamais contre `--fond`. Un jeton de thème y serait invisible une fois sur deux.",
  },
];

function exceptionsPour(fichier: string): string[] {
  return EXCEPTIONS.filter((e) => fichier.endsWith(e.fichier)).flatMap((e) => e.classes);
}

function lire(chemin: string): string {
  return readFileSync(resolve(process.cwd(), chemin), "utf8");
}

describe("socle visuel — aucune couleur figée hors des jetons", () => {
  const fichiers = fichiersAConsiderer(DOSSIERS_RENDUS);

  it("voit bien les fichiers de rendu (sinon le garde est vert à vide)", () => {
    // Un scan qui ne trouve aucun fichier passe tous les tests suivants sans rien vérifier.
    // Le volume se prouve, il ne se suppose pas.
    expect(fichiers.length).toBeGreaterThan(20);
    expect(fichiers).toContain("components/CatalogueGrid.tsx");
  });

  it("aucune classe de palette Tailwind ne survit dans app/, components/ ou lib/", () => {
    const fautes: string[] = [];
    for (const fichier of fichiers) {
      const tolerees = exceptionsPour(fichier);
      lire(fichier)
        .split("\n")
        .forEach((ligne, i) => {
          for (const trouvee of ligne.match(COULEUR_FIGEE) ?? []) {
            if (tolerees.includes(trouvee)) continue;
            fautes.push(`${fichier}:${i + 1} — ${trouvee}`);
          }
        });
    }
    // Le message NOMME chaque faute : « il y en a 21 » n'aide pas à les corriger.
    expect(fautes, `Couleurs figées (utilise un jeton de globals.css) :\n${fautes.join("\n")}`)
      .toEqual([]);
  });

  it("aucune variante appliquée au vocabulaire maison, ni fragment de variante vide", () => {
    // `dark:texte-erreur` ne génère RIEN : `texte-erreur` est une classe CSS ordinaire, pas
    // un utilitaire Tailwind — la variante n'a aucune règle à dupliquer. Et `dark:` seul
    // (fragment laissé par un remplacement) est une classe morte qui se lit comme un
    // correctif présent. Les deux étaient dans CatalogueGrid après ma passe.
    const vocabulaire = [...lire("app/globals.css").matchAll(/^\s{2}\.([a-z-]+)\s*\{/gm)]
      .map((m) => m[1])
      .filter((c): c is string => c !== undefined);
    expect(vocabulaire).toContain("erreur");
    expect(vocabulaire).toContain("succes");

    const motifs = [
      new RegExp(`\\b[a-z-]+:(?:${vocabulaire.join("|")})\\b`, "g"),
      /\b(?:dark|hover|focus|active|disabled):(?=["'\s`])/g,
    ];
    const fautes: string[] = [];
    for (const fichier of fichiers) {
      lire(fichier)
        .split("\n")
        .forEach((ligne, i) => {
          for (const motif of motifs) {
            for (const trouvee of ligne.match(motif) ?? []) {
              fautes.push(`${fichier}:${i + 1} — ${trouvee.trim()}`);
            }
          }
        });
    }
    expect(fautes, `Variantes sans effet :\n${fautes.join("\n")}`).toEqual([]);
  });

  it("chaque `var(--jeton)` cité par un composant est défini dans globals.css", () => {
    // Un nom de jeton mal orthographié ne lève rien : la propriété devient invalide et la
    // couleur est simplement héritée. Silencieux, et joli dans le thème où on l'a écrit.
    const definis = new Set(
      [...lire("app/globals.css").matchAll(/^\s+(--[a-z-]+)\s*:/gm)].map((m) => m[1]),
    );
    const fautes: string[] = [];
    for (const fichier of fichiers) {
      lire(fichier)
        .split("\n")
        .forEach((ligne, i) => {
          for (const trouvee of ligne.match(/var\(\s*(--[a-z-]+)/g) ?? []) {
            const jeton = trouvee.replace(/var\(\s*/, "");
            if (!definis.has(jeton)) fautes.push(`${fichier}:${i + 1} — ${jeton}`);
          }
        });
    }
    expect(fautes, `Jetons inexistants :\n${fautes.join("\n")}`).toEqual([]);
  });
});

describe("socle visuel — les deux thèmes déclarent les mêmes couleurs", () => {
  const css = lire("app/globals.css");

  /**
   * Un jeton de COULEUR défini en clair mais oublié en sombre garde la valeur claire : c'est
   * exactement la forme « blanc sur blanc », déplacée d'un cran. On dérive donc la liste des
   * jetons à vérifier du fichier lui-même (une couleur = une valeur `#…`), jamais d'une
   * liste recopiée qui vieillirait avec le prochain jeton ajouté.
   */
  const bloc = (source: string, apres: string): string => {
    const debut = source.indexOf(apres);
    expect(debut, `bloc introuvable : ${apres}`).toBeGreaterThan(-1);
    const suite = source.slice(debut + apres.length);
    return suite.slice(0, suite.indexOf("}"));
  };

  const jetonsCouleur = (source: string): string[] =>
    [...source.matchAll(/(--[a-z-]+)\s*:\s*#[0-9a-f]{3,8}\s*;/gi)]
      .map((m) => m[1])
      .filter((j): j is string => j !== undefined)
      .sort();

  it("le thème sombre redéfinit chaque couleur du thème clair", () => {
    const clair = jetonsCouleur(bloc(css, ":root {"));
    const sombre = jetonsCouleur(bloc(css, "@media (prefers-color-scheme: dark) {\n  :root {"));
    expect(clair.length).toBeGreaterThan(10);
    const manquants = clair.filter((j) => !sombre.includes(j));
    expect(manquants, `Couleurs figées au thème clair : ${manquants.join(", ")}`).toEqual([]);
  });
});
