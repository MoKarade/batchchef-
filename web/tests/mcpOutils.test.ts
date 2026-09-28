// Outils MCP : validation des arguments et rendu des pannes, sans base.
// Les fonctions de TRAVAIL (`*Interne`) sont remplacées : on éprouve ce que l'outil leur
// transmet et ce qu'il refuse AVANT de les appeler. Aucune donnée métier.

import { beforeEach, describe, expect, it, vi } from "vitest";

const creerBatchInterne = vi.fn();
const ajouterDuCatalogueInterne = vi.fn();
const cocherArticleInterne = vi.fn();

vi.mock("@/lib/actions", () => ({
  creerBatchInterne: (...a: unknown[]) => creerBatchInterne(...a),
  ajouterDuCatalogueInterne: (...a: unknown[]) => ajouterDuCatalogueInterne(...a),
  cocherArticleInterne: (...a: unknown[]) => cocherArticleInterne(...a),
}));

import { executerOutilMcp } from "../lib/mcp/outils";

const texte = (r: Record<string, unknown>): string =>
  ((r.content as Array<{ text: string }>)[0] as { text: string }).text;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("executerOutilMcp", () => {
  it("un outil inconnu est rendu comme erreur d'outil, pas lancé", async () => {
    const r = await executerOutilMcp("outil_fantome", {});
    expect(r.isError).toBe(true);
    expect(texte(r)).toContain("Outil inconnu");
  });

  it("une recherche sans critère demande de préciser (sans toucher la base)", async () => {
    const r = await executerOutilMcp("batchchef_chercher_recettes", {});
    expect(texte(r)).toContain("Donne des ingrédients ou un texte");
  });

  it("un identifiant se REFUSE, il ne se borne pas", async () => {
    for (const id of [0, -3, 1.5, "abc", null, undefined]) {
      const r = await executerOutilMcp("batchchef_lire_recette", { id });
      expect(texte(r).length).toBeGreaterThan(0);
    }
    const liste = await executerOutilMcp("batchchef_lire_liste_epicerie", { batchId: -1 });
    expect(texte(liste)).toContain("Identifiant de batch invalide");
  });

  describe("batchchef_creer_batch", () => {
    it("refuse un nom vide, l'absence de recette et une recette mal formée", async () => {
      expect((await executerOutilMcp("batchchef_creer_batch", { nom: " " })).isError).toBe(true);
      expect((await executerOutilMcp("batchchef_creer_batch", { nom: "n" })).isError).toBe(true);
      const mal = await executerOutilMcp("batchchef_creer_batch", {
        nom: "n",
        recettes: [{ id: 1, portions: 0 }],
      });
      expect(mal.isError).toBe(true);
      expect(creerBatchInterne).not.toHaveBeenCalled();
    });

    it("transmet des sélections entières à la fonction de travail", async () => {
      creerBatchInterne.mockResolvedValue({ ok: true, id: 7 });
      const r = await executerOutilMcp("batchchef_creer_batch", {
        nom: " Semaine ",
        recettes: [{ id: "2", portions: 4 }],
      });
      expect(creerBatchInterne).toHaveBeenCalledWith({
        name: "Semaine",
        selections: [{ recipeId: 2, portions: 4 }],
      });
      expect(r.isError).toBeFalsy();
      expect(texte(r)).toContain("#7");
    });

    it("rend l'échec du travail tel quel, et signale une estimation de secours", async () => {
      creerBatchInterne.mockResolvedValueOnce({ ok: false, error: "refusé" });
      const a = await executerOutilMcp("batchchef_creer_batch", { nom: "n", recettes: [{ id: 1, portions: 1 }] });
      expect(a.isError).toBe(true);
      expect(texte(a)).toBe("refusé");

      creerBatchInterne.mockResolvedValueOnce({ ok: true, id: 8, estimationError: "panne" });
      const b = await executerOutilMcp("batchchef_creer_batch", { nom: "n", recettes: [{ id: 1, portions: 1 }] });
      expect(texte(b)).toContain("panne");
    });
  });

  describe("batchchef_ajouter_recette_du_catalogue", () => {
    it("refuse sans identifiant valide", async () => {
      const r = await executerOutilMcp("batchchef_ajouter_recette_du_catalogue", { ids: [0, "x"] });
      expect(r.isError).toBe(true);
      expect(ajouterDuCatalogueInterne).not.toHaveBeenCalled();
    });

    it("n'envoie que les identifiants valides et rapporte les chiffres réels", async () => {
      ajouterDuCatalogueInterne.mockResolvedValue({ ok: true, added: 1, skipped: 2 });
      const r = await executerOutilMcp("batchchef_ajouter_recette_du_catalogue", { ids: [3, "x", 4, -1] });
      expect(ajouterDuCatalogueInterne).toHaveBeenCalledWith([3, 4]);
      expect(texte(r)).toContain("1 recette(s) ajoutée(s)");
      expect(texte(r)).toContain("2 déjà présente(s)");
    });
  });

  describe("batchchef_cocher_article", () => {
    it("exige un identifiant valide et un booléen strict", async () => {
      expect((await executerOutilMcp("batchchef_cocher_article", { articleId: 0, pris: true })).isError).toBe(true);
      expect((await executerOutilMcp("batchchef_cocher_article", { articleId: 1, pris: "oui" })).isError).toBe(true);
      expect(cocherArticleInterne).not.toHaveBeenCalled();
    });

    it("coche et décoche", async () => {
      cocherArticleInterne.mockResolvedValue({ ok: true });
      expect(texte(await executerOutilMcp("batchchef_cocher_article", { articleId: 5, pris: true }))).toContain("pris");
      expect(texte(await executerOutilMcp("batchchef_cocher_article", { articleId: 5, pris: false }))).toContain("à prendre");
      expect(cocherArticleInterne).toHaveBeenCalledWith(5, false);
    });

    it("une panne de la fonction de travail devient une erreur d'outil", async () => {
      cocherArticleInterne.mockRejectedValue(new Error("base indisponible"));
      const r = await executerOutilMcp("batchchef_cocher_article", { articleId: 5, pris: true });
      expect(r.isError).toBe(true);
      expect(texte(r)).toContain("base indisponible");
    });
  });
});
