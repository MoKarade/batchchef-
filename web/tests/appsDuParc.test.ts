// Verrou de lib/appsDuParc.ts : la liste figée des destinations du parc (tâche MoKarade/app-template#212, mission MoKarade/.github#846).
import { describe, expect, it } from "vitest";
import { APPS_DU_PARC, autresApps } from "@/lib/appsDuParc";

describe("APPS_DU_PARC : la liste figée", () => {
  it("contient exactement les 7 destinations, dans cet ordre", () => {
    expect(APPS_DU_PARC.map(({ id, nom, adresse }) => [id, nom, adresse])).toEqual([
      ["hub", "Hub", "https://www.hubperso.com"],
      ["financeai", "FinanceAI", "https://finance.hubperso.com"],
      ["driveai", "DriveAI", "https://drive.hubperso.com"],
      ["batchchef", "BatchChef", "https://batchchef.hubperso.com"],
      ["carai", "CarAI", "https://carai.hubperso.com"],
      ["jobai", "JobAI", "https://emploi.hubperso.com"],
      ["memoryai", "MemoryAI", "https://memoryai.hubperso.com"],
    ]);
  });

  it("n'a ni id ni adresse en double", () => {
    expect(new Set(APPS_DU_PARC.map((a) => a.id)).size).toBe(APPS_DU_PARC.length);
    expect(new Set(APPS_DU_PARC.map((a) => a.adresse)).size).toBe(APPS_DU_PARC.length);
  });

  it("n'a que des origines https sans chemin, requête, fragment ni identifiant, sur hubperso.com ou un sous-domaine", () => {
    for (const { adresse } of APPS_DU_PARC) {
      const url = new URL(adresse);
      expect(url.protocol, adresse).toBe("https:");
      expect(url.origin, adresse).toBe(adresse);
      expect(url.pathname, adresse).toBe("/");
      expect(url.search + url.hash, adresse).toBe("");
      expect(url.username + url.password, adresse).toBe("");
      expect(url.port, adresse).toBe("");
      expect(url.hostname === "hubperso.com" || url.hostname.endsWith(".hubperso.com"), adresse).toBe(true);
    }
  });

  it("est gelée : un fork ne la modifie pas par accident", () => {
    expect(Object.isFrozen(APPS_DU_PARC)).toBe(true);
    for (const app of APPS_DU_PARC) expect(Object.isFrozen(app), app.id).toBe(true);
  });
});

describe("autresApps : toutes les destinations sauf l'app courante", () => {
  it("rend 6 entrées sans carai, dans l'ordre de la liste", () => {
    const rendu = autresApps("carai");
    expect(rendu).toHaveLength(6);
    expect(rendu.map((a) => a.id)).toEqual(["hub", "financeai", "driveai", "batchchef", "jobai", "memoryai"]);
  });

  it("rend le hub et 5 apps quand l'app courante est le hub", () => {
    const rendu = autresApps("hub");
    expect(rendu).toHaveLength(6);
    expect(rendu.some((a) => a.id === "hub")).toBe(false);
  });

  it("LÈVE une erreur sur un id inconnu, jamais une liste vide silencieuse", () => {
    expect(() => autresApps("inconnue" as never)).toThrow(/inconnue/);
    expect(() => autresApps("" as never)).toThrow();
  });
});
