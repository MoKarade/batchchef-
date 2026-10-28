// tests/assistantAtelierServeur.test.ts — l'assistant derrière l'atelier : la boucle et la base sont simulées.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { repondre, lignes } = vi.hoisted(() => ({
  repondre: vi.fn(),
  lignes: { catalogue: [] as Array<{ id: number; titre: string }>, miennes: [] as Array<{ id: number; titre: string }> },
}));

vi.mock("@/lib/assistant/boucle", () => ({ repondre }));
vi.mock("drizzle-orm", () => ({ inArray: vi.fn((col: unknown, ids: unknown) => ({ col, ids })) }));
vi.mock("@/lib/db", () => {
  const catalogue = { id: "cat.id", title: "cat.title" };
  const recettes = { id: "rec.id", title: "rec.title" };
  return {
    schema: { catalogRecipes: catalogue, recipes: recettes },
    db: {
      select: () => ({
        from: (table: unknown) => ({ where: async () => (table === catalogue ? lignes.catalogue : lignes.miennes) }),
      }),
    },
  };
});

import { repondreAtelier, titresDesReferences } from "../lib/assistant/atelierServeur";

beforeEach(() => {
  repondre.mockReset();
  lignes.catalogue = [];
  lignes.miennes = [];
});

describe("titresDesReferences", () => {
  it("rend le titre de chaque recette citée, par source, et rien pour une recette absente", async () => {
    lignes.catalogue = [{ id: 482, titre: "Poulet au riz" }];
    lignes.miennes = [{ id: 7, titre: "Chili maison" }];
    const t = await titresDesReferences("[catalogue #482] [catalogue #999] [mes-recettes #7]");
    expect([...t.entries()]).toEqual([
      ["catalogue#482", "Poulet au riz"],
      ["mes-recettes#7", "Chili maison"],
    ]);
  });

  it("sans référence, aucune requête", async () => {
    expect((await titresDesReferences("Rien à citer.")).size).toBe(0);
  });
});

describe("repondreAtelier", () => {
  it("envoie l'historique puis la question à la boucle, et rend le texte sans marqueurs avec ses blocs", async () => {
    lignes.catalogue = [{ id: 482, titre: "Poulet au riz" }];
    repondre.mockResolvedValue({ ok: true, texte: "Essaie ça [catalogue #482].", toursOutils: 1, borneAtteinte: false, coupeeEnCours: false });
    const r = await repondreAtelier({
      question: "  Que faire ? ",
      historique: [
        { role: "user", contenu: "avant" },
        { role: "assistant", contenu: "  " }, // un message vide ne part pas au modèle
        { role: "assistant", contenu: "réponse" },
      ],
    });
    expect(repondre).toHaveBeenCalledWith([
      { role: "user", contenu: "avant" },
      { role: "assistant", contenu: "réponse" },
      { role: "user", contenu: "Que faire ?" },
    ]);
    expect(r).toEqual({
      ok: true,
      reponse: { text: "Essaie ça .", blocks: [{ type: "recette", source: "catalogue", id: 482, titre: "Poulet au riz" }] },
    });
  });

  it("⚠️ un échec du moteur (clé absente) est rendu avec sa raison, jamais comme une réponse", async () => {
    repondre.mockResolvedValue({ ok: false, texte: "L'assistant n'est pas configuré (clé API absente).", toursOutils: 0, borneAtteinte: false, coupeeEnCours: false });
    expect(await repondreAtelier({ question: "?", historique: [] })).toEqual({
      ok: false,
      erreur: "L'assistant n'est pas configuré (clé API absente).",
    });
  });

  it("une question trop longue est refusée en disant la limite, sans appeler le modèle", async () => {
    const r = await repondreAtelier({ question: "x".repeat(4001), historique: [] });
    expect(r.ok).toBe(false);
    expect(repondre).not.toHaveBeenCalled();
  });
});
