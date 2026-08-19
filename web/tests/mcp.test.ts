// Le serveur MCP : protocole, et le verrou qui empêche mes constantes de vieillir.
//
// Le SDK officiel est en devDependency (jamais en production : il embarque express, hono,
// cors et jose — 8,7 Mo — pour un transport à sessions dont une fonction serverless n'a que
// faire). Il sert ici de VÉRITÉ : si ses versions de protocole bougent et que les nôtres ne
// suivent pas, ce fichier échoue. Sans ce verrou, une constante recopiée dérive en silence.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  JSONRPC_VERSION,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ERREUR,
  VERSION_JSONRPC,
  VERSION_PROTOCOLE,
  VERSIONS_SUPPORTEES,
  erreur,
  estNotification,
  estRequeteValide,
  negocierVersion,
  reponse,
  resultatOutil,
} from "../lib/mcp/protocole";
import { OUTILS_MCP } from "../lib/mcp/declarations";

describe("tripwire : nos constantes contre le SDK officiel", () => {
  it("la version de protocole suit celle du SDK", () => {
    expect(VERSION_PROTOCOLE).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("la liste des versions supportées suit celle du SDK", () => {
    expect([...VERSIONS_SUPPORTEES]).toEqual([...SUPPORTED_PROTOCOL_VERSIONS]);
  });

  it("la version JSON-RPC suit celle du SDK", () => {
    expect(VERSION_JSONRPC).toBe(JSONRPC_VERSION);
  });
});

describe("estRequeteValide", () => {
  it("accepte une requête conforme", () => {
    expect(estRequeteValide({ jsonrpc: "2.0", id: 1, method: "ping" })).toBe(true);
  });

  it("refuse ce qui n'est pas du JSON-RPC 2.0", () => {
    expect(estRequeteValide({ jsonrpc: "1.0", method: "ping" })).toBe(false);
    expect(estRequeteValide({ method: "ping" })).toBe(false);
    expect(estRequeteValide({ jsonrpc: "2.0" })).toBe(false);
    expect(estRequeteValide(null)).toBe(false);
    expect(estRequeteValide("ping")).toBe(false);
  });
});

describe("estNotification", () => {
  it("une requête SANS `id` est une notification", () => {
    // `notifications/initialized` arrive juste après la poignée de main. Y répondre — même
    // un succès vide — est une violation que certains clients traitent en erreur.
    expect(estNotification({ jsonrpc: "2.0", method: "notifications/initialized" })).toBe(true);
  });

  it("`id: null` n'est PAS une notification", () => {
    // `null` est un identifiant JSON-RPC valide : le discriminant est l'ABSENCE de la clé.
    expect(estNotification({ jsonrpc: "2.0", id: null, method: "ping" })).toBe(false);
  });

  it("`id: 0` n'est pas une notification non plus", () => {
    // Piège classique : 0 est falsy. Le test doit porter sur la présence, pas la vérité.
    expect(estNotification({ jsonrpc: "2.0", id: 0, method: "ping" })).toBe(false);
  });
});

describe("negocierVersion", () => {
  it("rend la version DEMANDÉE quand on la connaît", () => {
    // Imposer la nôtre couperait un client plus ancien : le protocole prévoit qu'on négocie.
    for (const v of SUPPORTED_PROTOCOL_VERSIONS) {
      expect(negocierVersion(v), v).toBe(v);
    }
  });

  it("retombe sur la nôtre si la demande est inconnue ou absente", () => {
    expect(negocierVersion("1999-01-01")).toBe(VERSION_PROTOCOLE);
    expect(negocierVersion(undefined)).toBe(VERSION_PROTOCOLE);
    expect(negocierVersion(42)).toBe(VERSION_PROTOCOLE);
  });
});

describe("enveloppes JSON-RPC", () => {
  it("une réponse porte le même id que la requête", () => {
    expect(reponse(7, { ok: true })).toEqual({ jsonrpc: "2.0", id: 7, result: { ok: true } });
  });

  it("une erreur porte son code et son message", () => {
    expect(erreur(3, ERREUR.methodeInconnue, "Méthode inconnue.")).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32601, message: "Méthode inconnue." },
    });
  });
});

describe("resultatOutil", () => {
  it("un échec d'outil est `isError`, PAS une erreur de protocole", () => {
    // Un outil qui échoue n'est pas un transport cassé : le modèle reçoit le motif et peut
    // reformuler, là où une erreur JSON-RPC interromprait la conversation.
    const r = resultatOutil("Aucune recette #999.", true);
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([{ type: "text", text: "Aucune recette #999." }]);
  });

  it("un succès n'est pas marqué en erreur", () => {
    expect(resultatOutil("ok").isError).toBe(false);
  });
});

describe("déclaration des outils", () => {
  it("chaque outil a un nom, une description et un schéma d'objet", () => {
    expect(OUTILS_MCP.length).toBeGreaterThan(0);
    for (const o of OUTILS_MCP) {
      expect(o.name, o.name).toMatch(/^batchchef_[a-z_]+$/);
      expect(o.description.length, o.name).toBeGreaterThan(30);
      expect(o.inputSchema.type, o.name).toBe("object");
    }
  });

  it("aucun nom d'outil en double", () => {
    const noms = OUTILS_MCP.map((o) => o.name);
    expect(new Set(noms).size).toBe(noms.length);
  });

  it("les outils qui ÉCRIVENT l'annoncent dans leur description", () => {
    // Claude choisit sur la description : un outil qui modifie les données de Marc sans le
    // dire serait appelé comme s'il était inoffensif.
    const ecrivains = ["batchchef_creer_batch", "batchchef_ajouter_recette_du_catalogue", "batchchef_cocher_article"];
    for (const nom of ecrivains) {
      const o = OUTILS_MCP.find((x) => x.name === nom);
      expect(o, nom).toBeDefined();
      expect(o!.description, nom).toContain("ÉCRIT");
    }
  });
});

describe("déclaration et exécution ne divergent pas", () => {
  // La séparation des deux fichiers (déclarations pures d'un côté, I/O de l'autre) a un
  // coût : rien n'oblige plus le `switch` à connaître ce que la déclaration annonce. Un
  // outil annoncé sans branche répondrait « Outil inconnu » à Claude, qui l'aurait choisi
  // sur la foi de sa description ; une branche sans déclaration serait du code mort que
  // personne ne peut appeler. On relit donc le SOURCE — l'IMPORTER démarrerait next-auth,
  // ce qui est précisément la raison de la séparation.
  const source = readFileSync(resolve(__dirname, "../lib/mcp/outils.ts"), "utf8");
  const branches = [...source.matchAll(/case "(batchchef_[a-z_]+)":/g)]
    .map((m) => m[1])
    .filter((n): n is string => n !== undefined);

  it("le source de outils.ts est bien lu (sinon le test est vert à vide)", () => {
    expect(branches.length).toBeGreaterThan(0);
  });

  it("chaque outil annoncé a sa branche d'exécution", () => {
    const orphelins = OUTILS_MCP.map((o) => o.name).filter((n) => !branches.includes(n));
    expect(orphelins, `Annoncés sans exécution : ${orphelins.join(", ")}`).toEqual([]);
  });

  it("chaque branche d'exécution est annoncée", () => {
    const noms: string[] = OUTILS_MCP.map((o) => o.name);
    const muettes = branches.filter((b) => !noms.includes(b));
    expect(muettes, `Exécutables mais jamais annoncés : ${muettes.join(", ")}`).toEqual([]);
  });
});
