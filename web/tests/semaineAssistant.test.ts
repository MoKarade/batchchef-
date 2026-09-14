// Verrou du changement de semaine par l'assistant (SEM-03).
//
// Tout ce lot fait des I/O (base, appel LLM) : aucun test unitaire ne l'exécute ici. Ce qui
// se vérifie est la SURFACE et l'ACCORD entre les pièces — et c'est précisément ce qui casse
// en silence, parce qu'un marqueur qui ne se parse plus ne lève rien : il ne produit juste
// plus aucun bouton.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decouperReponse, propositionsDe } from "../lib/assistant/protocole";
import { OUTILS } from "../lib/assistant/outils";

const lire = (chemin: string) => readFileSync(resolve(process.cwd(), chemin), "utf8");

/** Une source décommentée — un commentaire ne satisfait aucune garde. */
const decommente = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("le prompt et le parseur parlent du MÊME marqueur", () => {
  it("⚠️ le format annoncé à l'assistant est bien celui que l'app sait lire", () => {
    // Le risque de ce lot n'est pas qu'une pièce soit fausse, c'est qu'elles DIVERGENT :
    // un prompt qui enseigne « [semaine 2 : catalogue 9] » et un parseur qui attend autre
    // chose ne lèvent rien du tout — l'assistant répond bien, et aucun bouton n'apparaît
    // jamais. Le test prend le format écrit DANS le prompt et le fait parser pour de vrai.
    const prompt = lire("lib/assistant/boucle.ts");
    const gabarit = /\[semaine PLACE[^\]]*\]/.exec(prompt)?.[0];
    expect(gabarit, "le prompt doit montrer le gabarit du marqueur").toBeTruthy();

    const exemple = (gabarit ?? "").replace("PLACE", "2").replace("#ID", "#9").replace("ID", "9");
    expect(propositionsDe(`voici ${exemple}`), exemple).toEqual([{ place: 2, id: 9 }]);
  });

  it("le prompt dit que les places vont de 1 à 4, comme le parseur l'exige", () => {
    const prompt = lire("lib/assistant/boucle.ts");
    expect(prompt).toContain("de 1 à 4");
    // Et la borne haute du parseur est bien 4 : au-delà, aucune carte.
    expect(propositionsDe("[semaine 4 ← catalogue #1]")).toHaveLength(1);
    expect(propositionsDe("[semaine 5 ← catalogue #1]")).toHaveLength(0);
  });
});

describe("l'outil qui lit la semaine LIT, il ne la fabrique pas", () => {
  it("`lire_semaine` est déclaré ET exécuté", () => {
    // Un outil déclaré sans exécuteur rend « Outil inconnu » à chaque appel ; un exécuteur
    // sans déclaration n'est jamais appelé. Les deux sens, comme pour le serveur MCP.
    const noms = OUTILS.map((o) => o.name);
    expect(noms).toContain("lire_semaine");
    const src = decommente(lire("lib/assistant/outils.ts"));
    for (const nom of noms) expect(src, nom).toContain(`nom === "${nom}"`);
  });

  it("⚠️ il appelle `lireSemaine`, JAMAIS `semaineCourante`", () => {
    // `semaineCourante` FABRIQUE la proposition quand elle manque, avec un delete + insert.
    // Appelée depuis un outil, elle créerait la semaine de Marc au détour d'une question —
    // et effacerait la précédente. Le hub a exactement la même règle, pour la même raison.
    const src = decommente(lire("lib/assistant/outils.ts"));
    expect(src, "l'outil doit lire").toMatch(/lireSemaine\s*\(/);
    expect(src, "l'outil ne doit jamais fabriquer la semaine").not.toMatch(/semaineCourante\s*\(/);
  });
});

describe("le placement est revalidé côté serveur", () => {
  const corps = () => {
    const brut = lire("lib/semaineDb.ts");
    const bloc = /export async function placerRecette[\s\S]*?\n\}/.exec(brut)?.[0];
    expect(bloc, "placerRecette doit exister").toBeTruthy();
    return decommente(bloc ?? "");
  };

  it("la place et la recette sont revérifiées, jamais crues sur parole", () => {
    // Le marqueur qui produit le bouton vient d'un MODÈLE, et la Server Action est un point
    // d'entrée POST atteignable sans passer par le chat. Cacher le bouton ne garde rien.
    const code = corps();
    expect(code.length, "le décommentage ne doit pas avoir tout mangé").toBeGreaterThan(300);
    expect(code, "la place passe par la conversion unique").toMatch(/positionEnBase\s*\(/);
    expect(code, "l'existence de la recette est revérifiée").toMatch(/apercuPlacement\s*\(/);
  });

  it("⚠️ le rôle de la place n'est PAS un refus — il est AFFICHÉ avant le clic", () => {
    // Arbitrage de Marc (14/09) : il peut mettre deux desserts s'il le demande. Ce qui est
    // non négociable, c'est que la carte l'ait dit — son clic vaut demande explicite, et il
    // ne peut la valoir que s'il sait ce qu'il demande.
    const code = corps();
    expect(code, "aucun refus sur le rôle").not.toMatch(/casseComposition\s*\)?\s*return\s*\{\s*ok:\s*false/);
    const carte = decommente(lire("components/Conversation.tsx"));
    expect(carte, "la carte doit afficher l'avertissement").toMatch(/casseComposition/);
  });
});

describe("regénérer la semaine entière", () => {
  const corps = () => {
    const brut = lire("lib/semaineDb.ts");
    const bloc = /export async function regenererSemaine[\s\S]*?\n\}/.exec(brut)?.[0];
    expect(bloc, "regenererSemaine doit exister").toBeTruthy();
    return decommente(bloc ?? "");
  };

  it("⚠️ la graine CHANGE à chaque appel, sinon le bouton rend les mêmes quatre recettes", () => {
    // `choisirQuatre` est déterministe par conception : la semaine ne doit pas bouger d'un
    // affichage à l'autre. Rejouer avec la graine de la semaine rendrait exactement le même
    // tirage, et le bouton aurait l'air cassé sans qu'aucune erreur n'apparaisse.
    const code = corps();
    expect(code, "la graine doit être dérivée d'autre chose que la seule semaine").toMatch(
      /graine\s*=\s*`\$\{semaine\}[^`]*\$\{?Date\.now/,
    );
    expect(code, "et c'est CETTE graine qui est tirée").toMatch(/candidates\(graine/);
  });

  it("le retrait et la pose sont dans la MÊME transaction", () => {
    // Une coupure entre les deux laisserait Marc sans aucune proposition — pire que
    // l'ancienne. `db.batch` est une vraie transaction sur le pilote Neon HTTP.
    const code = corps();
    const iBatch = code.indexOf("db.batch");
    expect(iBatch, "l'écriture doit passer par db.batch").toBeGreaterThan(-1);
    const bloc = code.slice(iBatch, code.indexOf("]", iBatch));
    expect(bloc).toContain("delete");
    expect(bloc).toContain("insert");
  });
});

describe("les segments d'une réponse restent exhaustifs", () => {
  it("texte, référence et proposition — et rien d'autre", () => {
    const segs = decouperReponse("A [catalogue #1] B [semaine 2 ← catalogue #3] C");
    expect(segs.map((s) => s.type)).toEqual([
      "texte",
      "reference",
      "texte",
      "proposition",
      "texte",
    ]);
  });
});
