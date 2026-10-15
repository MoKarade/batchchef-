import { describe, expect, it } from "vitest";
import { fail, messageSimple } from "@/lib/actionsInternes/commun";

describe("messageSimple", () => {
  it("traduit les erreurs réseau anglaises", () => {
    expect(messageSimple("Failed to fetch")).toMatch(/connexion/);
    expect(messageSimple("TypeError: fetch failed")).toMatch(/connexion/);
  });

  it("traduit une URL invalide", () => {
    expect(messageSimple("Invalid URL")).toMatch(/lien/);
  });

  it("traduit les erreurs de base de données", () => {
    expect(messageSimple("Failed query: select 1")).toMatch(/base de données/);
  });

  it("laisse intact un message déjà en français", () => {
    expect(messageSimple("Recette introuvable.")).toBe("Recette introuvable.");
  });
});

describe("fail", () => {
  it("applique la traduction à une exception", () => {
    expect(fail(new Error("Failed to fetch"))).toEqual({
      ok: false,
      error: messageSimple("Failed to fetch"),
    });
  });

  it("garde un message français tel quel", () => {
    expect(fail(new Error("Titre manquant"))).toEqual({ ok: false, error: "Titre manquant" });
  });
});
