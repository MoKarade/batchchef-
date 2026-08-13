// Partage Android (Web Share Target) : démêlage des champs reçus, et verrous sur les trois
// fichiers qui doivent rester d'accord (manifeste, service worker, code applicatif).

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  CACHE_PARTAGE,
  CHEMIN_PARTAGE,
  CLE_CAPTURE_PREFIXE,
  CLE_META,
  CLE_VIDEO,
  doitIntercepterPartage,
  normaliserPartage,
} from "../lib/partage";

function lire(chemin: string): string {
  return readFileSync(resolve(process.cwd(), chemin), "utf8");
}

/**
 * Fichiers RÉELLEMENT suivis par git sous un chemin donné.
 *
 * Vécu le 2026-08-12 : `.gitignore` héritait de Gatsby une règle `public`, qui chez Next
 * exclut des fichiers SOURCE. Le manifeste, le service worker et les icônes existaient sur
 * le disque — gate local vert — sans jamais entrer dans le dépôt : la fonctionnalité aurait
 * été mergée puis absente de la production, sans une seule erreur. Un garde qui regarde le
 * disque ne voit pas ça ; celui-ci regarde ce que git emporte.
 *
 * Échoue si git est indisponible : « je ne peux pas vérifier » n'est pas « c'est bon ».
 */
function fichiersSuivisParGit(prefixe: string): string[] {
  const sortie = execFileSync("git", ["ls-files", "--", prefixe], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return sortie.split("\n").filter(Boolean);
}

describe("normaliserPartage", () => {
  it("utilise le champ `url` quand l'app source le remplit", () => {
    expect(
      normaliserPartage({ url: "https://www.instagram.com/reel/ABC/", texte: "Poulet au miel" }),
    ).toEqual({ lien: "https://www.instagram.com/reel/ABC/", description: "Poulet au miel" });
  });

  it("sort l'URL du texte quand Android met tout dans `text` (cas Instagram)", () => {
    // Sans ça, l'URL partirait au LLM comme si elle faisait partie de la recette.
    expect(
      normaliserPartage({ texte: "Regarde ça https://www.instagram.com/reel/ABC/ trop bon" }),
    ).toEqual({ lien: "https://www.instagram.com/reel/ABC/", description: "Regarde ça  trop bon" });
  });

  it("un partage réduit à l'URL seule ne laisse aucune description", () => {
    expect(normaliserPartage({ texte: "https://www.instagram.com/reel/ABC/" })).toEqual({
      lien: "https://www.instagram.com/reel/ABC/",
      description: "",
    });
  });

  it("sans lien, TOUT le texte est gardé comme description (c'est peut-être la recette)", () => {
    const texte = "500 g de poulet\n2 c. à soupe de miel";
    expect(normaliserPartage({ texte })).toEqual({ lien: null, description: texte });
  });

  it("ne retient qu'un lien http(s) — même garde que côté serveur", () => {
    expect(normaliserPartage({ url: "javascript:alert(1)" }).lien).toBeNull();
    expect(normaliserPartage({ url: "ftp://exemple.com/x" }).lien).toBeNull();
  });

  it("n'empile pas un titre qui répète déjà le texte", () => {
    expect(normaliserPartage({ titre: "Poulet", texte: "Poulet au miel" }).description).toBe(
      "Poulet au miel",
    );
    expect(normaliserPartage({ titre: "Poulet", texte: "500 g" }).description).toBe("Poulet\n500 g");
  });

  it("un partage vide reste vide (jamais de contenu inventé)", () => {
    expect(normaliserPartage({})).toEqual({ lien: null, description: "" });
  });
});

describe("doitIntercepterPartage", () => {
  const partageAndroid = { method: "POST", pathname: CHEMIN_PARTAGE, mode: "navigate" };

  it("intercepte le partage Android, qui est une NAVIGATION", () => {
    expect(doitIntercepterPartage(partageAndroid)).toBe(true);
    expect(doitIntercepterPartage({ ...partageAndroid, method: "post" })).toBe(true);
  });

  it("LAISSE PASSER une Server Action, qui poste vers la MÊME url en fetch()", () => {
    // Le bug vécu le 13/08/2026, et la seule raison d'être de cette fonction : l'analyse
    // de la vidéo tourne sur /partage, donc sa Server Action poste vers /partage. Un
    // worker qui ne teste que « POST + /partage » lui répond une redirection 303 à la
    // place du résultat. Les deux modes qu'un fetch() de même origine peut porter.
    expect(doitIntercepterPartage({ ...partageAndroid, mode: "cors" })).toBe(false);
    expect(doitIntercepterPartage({ ...partageAndroid, mode: "same-origin" })).toBe(false);
  });

  it("ignore tout ce qui n'est pas un POST vers le chemin de partage", () => {
    expect(doitIntercepterPartage({ ...partageAndroid, method: "GET" })).toBe(false);
    expect(doitIntercepterPartage({ ...partageAndroid, pathname: "/recettes" })).toBe(false);
    // Un sous-chemin n'est pas la cible de partage : seule l'égalité stricte compte.
    expect(doitIntercepterPartage({ ...partageAndroid, pathname: "/partage/autre" })).toBe(false);
  });
});

describe("verrous entre le service worker et le code applicatif", () => {
  // Un service worker est un fichier statique : il ne peut rien importer de `lib/`. Les
  // clés de cache y sont donc DUPLIQUÉES, et une divergence casserait le partage en
  // silence — la page ne trouverait rien à lire. Ce test est ce qui l'interdit.
  const sw = lire("public/sw.js");

  it("le worker utilise exactement les clés de cache de lib/partage.ts", () => {
    expect(sw).toContain(`"${CACHE_PARTAGE}"`);
    expect(sw).toContain(`"${CLE_VIDEO}"`);
    expect(sw).toContain(`"${CLE_META}"`);
    expect(sw).toContain(`"${CLE_CAPTURE_PREFIXE}"`);
  });

  it("le worker ne met en cache QUE le partage (aucun cache hors-ligne de pages privées)", () => {
    // BatchChef affiche des données personnelles derrière une session : un cache de
    // réponses les laisserait sur l'appareil et servirait des écrans périmés.
    const misesEnCache = sw.match(/cache\.put\(/g) ?? [];
    expect(misesEnCache.length).toBe(3); // vidéo, captures, métadonnées — rien d'autre
    expect(sw).not.toContain("addAll");
  });

  it("le worker LAISSE PASSER les Server Actions, qui postent vers la même URL", () => {
    // Le bug du 13/08 : une Server Action de Next poste vers l'URL de la page courante,
    // donc vers /partage quand on est sur /partage. Le worker l'avalait et répondait une
    // redirection 303 — « An unexpected response was received from the server », et zéro
    // trace côté serveur puisque la réponse était fabriquée dans le téléphone.
    // Le discriminant standard est `mode` : un Web Share Target NAVIGUE, un fetch() non.
    expect(sw).toContain('event.request.mode !== "navigate"');
  });

  it("le worker trie les fichiers par TYPE, pas par nom de champ", () => {
    // Android range parfois une image dans le champ « video » : se fier au nom du champ
    // traiterait la capture comme une vidéo illisible et perdrait le texte.
    expect(sw).toContain('startsWith("image/")');
  });

  it("le worker purge les captures du partage précédent", () => {
    // Sans ça, deux publications successives se mélangeraient dans une même recette.
    expect(sw).toMatch(/cache\.delete\(cle\)/);
  });
});

describe("verrous du manifeste PWA", () => {
  const manifeste = JSON.parse(lire("public/manifest.webmanifest")) as {
    icons?: { src: string }[];
    share_target?: {
      action?: string;
      method?: string;
      enctype?: string;
      params?: { files?: { name: string; accept: string[] }[] };
    };
  };

  it("déclare une cible de partage POST multipart acceptant vidéos ET images", () => {
    // Sans method POST + multipart, Android ne transmet AUCUN fichier : le partage se
    // réduirait à une URL, et l'app n'aurait rien à analyser. Sans `image/*`, BatchChef
    // n'apparaîtrait pas quand on partage une CAPTURE D'ÉCRAN de la légende.
    expect(manifeste.share_target?.method).toBe("POST");
    expect(manifeste.share_target?.enctype).toBe("multipart/form-data");
    const champs = manifeste.share_target?.params?.files ?? [];
    const accepts = champs.flatMap((c) => c.accept);
    expect(champs.map((c) => c.name)).toEqual(["video", "captures"]);
    expect(accepts).toContain("video/*");
    expect(accepts).toContain("image/*");
  });

  it("la page visée par le partage existe vraiment", () => {
    // Renommer la page sans toucher au manifeste enverrait chaque partage sur un 404.
    expect(manifeste.share_target?.action).toBe("/partage");
    expect(existsSync(resolve(process.cwd(), "app/partage/page.tsx"))).toBe(true);
  });

  it("les icônes déclarées existent sur le disque", () => {
    // Une icône manquante rend la PWA non installable — donc pas de partage du tout.
    const icones = manifeste.icons ?? [];
    expect(icones.length).toBeGreaterThan(0);
    for (const icone of icones) {
      expect(
        existsSync(resolve(process.cwd(), "public", icone.src.replace(/^\//, ""))),
        `icône ${icone.src} absente de public/`,
      ).toBe(true);
    }
  });
});

describe("les assets PWA sont VERSIONNÉS, pas seulement présents", () => {
  // Le vrai risque n'est pas qu'un fichier manque sur ma machine : c'est qu'il y soit et
  // n'entre jamais dans le dépôt. Un `.gitignore` trop large suffit, et rien ne le signale.
  const suivis = fichiersSuivisParGit("public");

  it("git suit le manifeste, le service worker et les icônes", () => {
    for (const attendu of [
      "public/manifest.webmanifest",
      "public/sw.js",
      "public/icone-192.png",
      "public/icone-512.png",
    ]) {
      expect(
        suivis,
        `${attendu} n'est pas suivi par git — il ne sera pas déployé, et le partage sera mort en silence`,
      ).toContain(attendu);
    }
  });
});
