// Plancher de version des dépendances porteuses d'une faille corrigée. Discriminant :
// redescendre `drizzle-orm` sous 0.45.2 rouvre l'injection SQL GHSA-gpj5-g38j-94v9 (HIGH),
// et rien dans le code applicatif ne le signalerait — l'app compile et les tests passent.
//
// Une promesse de verrou écrite dans un commentaire de `package.json` n'est pas un verrou :
// elle se contourne par un `npm install` distrait ou une régénération de lockfile. Ce test
// en est un.
//
// PORTÉE, écrite ici : il vérifie une BORNE INFÉRIEURE de version, rien d'autre. Il ne
// détecte pas une nouvelle faille dans une version plus récente — c'est le rôle de
// `npm audit --omit=dev`, à relancer, pas à remplacer par ce fichier.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Vitest tourne depuis `web/` : `import.meta.url` n'est pas de scheme file après transform. */
function lireJson(chemin: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), chemin), "utf8")) as Record<
    string,
    unknown
  >;
}

/** Compare deux versions x.y.z. Rend un nombre négatif si `a` est antérieure à `b`. */
function comparerVersions(a: string, b: string): number {
  const na = a.split(".").map(Number);
  const nb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Planchers, avec la raison de chacun. Une valeur sans motif finit par être relâchée
 * « parce qu'elle bloquait » — le motif est ce qui permet de refuser.
 */
const PLANCHERS: readonly { paquet: string; minimum: string; faille: string }[] = [
  {
    paquet: "drizzle-orm",
    minimum: "0.45.2",
    faille: "GHSA-gpj5-g38j-94v9 — injection SQL par identifiants mal échappés (HIGH)",
  },
  {
    paquet: "postcss",
    minimum: "8.5.24",
    faille: "GHSA-qx2v-qp2m-jg93 / GHSA-6g55-p6wh-862q — XSS et lecture de fichier arbitraire",
  },
  {
    paquet: "sharp",
    minimum: "0.35.3",
    faille: "GHSA-f88m-g3jw-g9cj — failles libvips héritées (HIGH)",
  },
  {
    paquet: "nanoid",
    minimum: "3.3.17",
    faille:
      "GHSA-2v37-7h3g-55p8 — un générateur personnalisé boucle indéfiniment quand size vaut 0 (HIGH). Tiré par postcss, lui-même tiré par Next.",
  },
];

const pkg = lireJson("package.json");
const lock = lireJson("package-lock.json");
const paquetsInstalles = (lock.packages ?? {}) as Record<string, { version?: string }>;

describe("le scan lit bien quelque chose", () => {
  it("trouve un package.json et un lockfile peuplés", () => {
    // Sans cette assertion, un mauvais `cwd` viderait le test de sa substance en silence :
    // aucune version trouvée, donc aucun plancher violé, donc tout vert.
    expect(Object.keys(pkg)).toContain("dependencies");
    expect(Object.keys(paquetsInstalles).length).toBeGreaterThan(100);
  });

  it("retrouve chaque paquet surveillé dans l'arbre installé", () => {
    for (const { paquet } of PLANCHERS) {
      const trouves = Object.keys(paquetsInstalles).filter((c) =>
        c.endsWith(`node_modules/${paquet}`),
      );
      expect(trouves.length, `« ${paquet} » absent du lockfile`).toBeGreaterThan(0);
    }
  });
});

describe("planchers de sécurité", () => {
  for (const { paquet, minimum, faille } of PLANCHERS) {
    it(`aucune copie de « ${paquet} » sous ${minimum}`, () => {
      // TOUTES les copies, pas seulement celle du premier niveau : Next embarquait sa
      // propre `postcss` 8.4.31 dans `node_modules/next/node_modules/` — vulnérable, et
      // invisible pour qui ne regarde que la racine. C'est ce que ferme l'`overrides`.
      const copies = Object.entries(paquetsInstalles).filter(([c]) =>
        c.endsWith(`node_modules/${paquet}`),
      );
      for (const [chemin, infos] of copies) {
        const v = infos.version ?? "0.0.0";
        expect(
          comparerVersions(v, minimum),
          `${chemin} est en ${v} — sous le plancher ${minimum}. ${faille}`,
        ).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it("la plage déclarée pour drizzle-orm ne permet pas de redescendre", () => {
    // Le lockfile peut être régénéré ; la plage de `package.json` est ce qui gouverne.
    const deps = pkg.dependencies as Record<string, string>;
    expect(deps["drizzle-orm"]).toBe("^0.45.2");
  });
});
