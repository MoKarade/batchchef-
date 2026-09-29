// Verrou du socle visuel : les couleurs vivent dans `app/globals.css`, en variables, et
// NULLE PART ailleurs (docs/claude/02-conventions.md, « Direction visuelle »).
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
// raconte le bug (ce fichier, et la leçon de docs/claude/02-conventions.md). Cousin du garde de JobAI qui
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

/**
 * Fichiers qui portent leur PROPRE palette, parce qu'ils sont servis hors du React et ne
 * chargent donc pas `globals.css`. Ils ne sont PAS exemptés du garde : la vérification
 * change de référentiel — chaque `var(--x)` doit être défini DANS le fichier, en clair ET
 * en sombre. Le défaut visé reste le même (un nom mal orthographié hérite en silence, et
 * une couleur oubliée en sombre redonne du blanc sur blanc) ; seule la source de vérité
 * diffère. Exempter tout court aurait rendu ces pages invérifiables.
 */
const PALETTES_AUTONOMES = ["app/api/mcp/oauth/authorize/route.ts"];

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
      if (PALETTES_AUTONOMES.includes(fichier)) continue; // vérifié contre lui-même plus bas
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

  it("une page à palette autonome définit chaque jeton qu'elle cite, dans les DEUX thèmes", () => {
    // Même défaut que partout ailleurs, autre référentiel. Le volet sombre compte autant
    // que le clair : c'est la couleur oubliée en sombre qui produit « blanc sur blanc ».
    for (const fichier of PALETTES_AUTONOMES) {
      expect(fichiers, `${fichier} n'est plus dans le périmètre scanné`).toContain(fichier);
      const source = lire(fichier);
      const cites = new Set(
        [...source.matchAll(/var\(\s*(--[a-z-]+)/g)]
          .map((m) => m[1])
          .filter((j): j is string => j !== undefined),
      );
      expect(cites.size, `${fichier} : aucun jeton cité, le test serait vide`).toBeGreaterThan(3);

      const sombre = source.slice(source.indexOf("prefers-color-scheme: dark"));
      expect(sombre.length, `${fichier} : aucun bloc sombre`).toBeGreaterThan(0);

      const manquants: string[] = [];
      for (const jeton of cites) {
        const declare = new RegExp(`${jeton}\\s*:`, "g");
        if (!declare.test(source)) manquants.push(`${jeton} (jamais défini)`);
        else if (!new RegExp(`${jeton}\\s*:`).test(sombre)) manquants.push(`${jeton} (absent du thème sombre)`);
      }
      expect(manquants, `${fichier} :\n${manquants.join("\n")}`).toEqual([]);
    }
  });
});

describe("socle visuel — thème SOMBRE UNIQUE (décision de Marc, 26/09/2026)", () => {
  const css = lire("app/globals.css");

  /**
   * Avant la refonte, ce bloc vérifiait que le thème sombre redéfinissait chaque couleur du
   * thème clair : une couleur oubliée en sombre gardait sa valeur claire, d'où « blanc sur
   * blanc » (incident du 14/08). L'app n'a plus qu'UN thème : cette bifurcation n'existe plus,
   * mais le défaut visé (une couleur qui n'obéit pas au thème) change de forme. On le garde
   * donc verrouillé sous ses nouvelles formes :
   *  1. aucune bifurcation ne revient sans qu'un test s'en aperçoive (`prefers-color-scheme`,
   *     `dark:` dans le balisage) : un second thème ré-ouvrirait exactement le trou d'avant ;
   *  2. chaque couleur est définie UNE fois, en hexadécimal : un doublon ferait gagner la
   *     dernière valeur sans que rien ne le dise ;
   *  3. les couples texte/fond restent lisibles, MESURÉS (WCAG) comme le fait
   *     docs/maquettes/refonte/contrastes.mjs, mais dans la CI et non à l'œil.
   * La garantie « aucune couleur en dur, tout en variables » (tests du dessus) est inchangée.
   */
  const racine = ((): string => {
    const debut = css.indexOf(":root {");
    expect(debut, "bloc :root introuvable").toBeGreaterThan(-1);
    const suite = css.slice(debut + ":root {".length);
    return suite.slice(0, suite.indexOf("\n}"));
  })();

  const couleurs = (source: string): [string, string][] =>
    [...source.matchAll(/^\s+(--[a-z-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gim)].map(
      (m) => [m[1] ?? "", (m[2] ?? "").toLowerCase()] as [string, string],
    );

  it("déclare le thème sombre, et lui seul", () => {
    expect(racine).toMatch(/color-scheme:\s*dark\s*;/);
    expect(css, "globals.css ne doit plus bifurquer selon le thème du système").not.toMatch(
      /prefers-color-scheme/,
    );
  });

  it("aucun composant ne bifurque selon le thème (`dark:`, `prefers-color-scheme`)", () => {
    const fautes: string[] = [];
    for (const fichier of fichiersAConsiderer(DOSSIERS_RENDUS)) {
      if (PALETTES_AUTONOMES.includes(fichier)) continue; // sa page porte sa propre palette
      lire(fichier)
        .split("\n")
        .forEach((ligne, i) => {
          if (/\bdark:|prefers-color-scheme/.test(ligne)) fautes.push(`${fichier}:${i + 1}`);
        });
    }
    expect(fautes, `Bifurcation de thème (il n'y en a qu'un) :\n${fautes.join("\n")}`).toEqual([]);
  });

  it("chaque couleur est définie une seule fois", () => {
    const tous = couleurs(racine);
    expect(tous.length, "trop peu de jetons lus : le garde serait vide").toBeGreaterThan(15);
    const noms = tous.map(([nom]) => nom);
    const doublons = noms.filter((nom, i) => noms.indexOf(nom) !== i);
    expect(doublons, `Jetons définis deux fois : ${doublons.join(", ")}`).toEqual([]);
    // Les jetons dont les écrans dépendent doivent exister (un renommage casserait en silence).
    for (const requis of ["--repere", "--repere-doux", "--bordure-champ", "--accent", "--sur-accent"]) {
      expect(noms, `jeton manquant : ${requis}`).toContain(requis);
    }
  });

  it("les couples texte/fond passent le WCAG (texte 4,5:1 ; contour et focus 3:1)", () => {
    const v = Object.fromEntries(couleurs(racine)) as Record<string, string>;
    const lin = (c: number): number => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const lum = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const ratio = (a: string, b: string): number => {
      const [x = 0, y = 0] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    // [premier plan, arrière-plan, minimum]. 4,5 = texte ; 3 = composant d'interface (1.4.11).
    const couples: [string, string, number][] = [
      ["--texte", "--fond", 4.5],
      ["--texte", "--surface", 4.5],
      ["--texte-doux", "--surface", 4.5],
      ["--texte-doux", "--fond", 4.5],
      ["--texte-doux", "--surface-douce", 4.5],
      ["--sur-accent", "--accent", 4.5],
      ["--sur-accent", "--accent-fonce", 4.5],
      ["--repere", "--fond", 4.5],
      ["--repere", "--surface", 4.5],
      ["--repere", "--repere-doux", 4.5],
      ["--succes-texte", "--succes-fond", 4.5],
      ["--alerte-texte", "--alerte-fond", 4.5],
      ["--erreur-texte", "--erreur-fond", 4.5],
      ["--erreur-texte", "--surface", 4.5],
      ["--texte", "--surface-douce", 4.5],
      ["--fond", "--texte", 4.5],
      ["--bordure-champ", "--surface", 3],
      ["--bordure-champ", "--fond", 3],
      ["--accent", "--fond", 3],
      ["--repere", "--fond", 3],
    ];
    const tropBas: string[] = [];
    for (const [a, b, min] of couples) {
      const fa = v[a];
      const fb = v[b];
      if (!fa || !fb) {
        tropBas.push(`${a} / ${b} : jeton introuvable`);
        continue;
      }
      const r = ratio(fa, fb);
      if (r < min) tropBas.push(`${a} ${fa} / ${b} ${fb} : ${r.toFixed(2)}:1 < ${min}:1`);
    }
    expect(tropBas, `Contrastes insuffisants :\n${tropBas.join("\n")}`).toEqual([]);
  });
});
