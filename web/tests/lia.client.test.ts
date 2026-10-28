// tests/lia.client.test.ts — le `ask` du navigateur : tout échec devient un rejet.

import { describe, expect, it, vi } from "vitest";
import { demanderAtelier, demanderLia, lirePauseServeur } from "../lib/lia/client";

const signal = new AbortController().signal;

describe("demanderLia", () => {
  it("poste sur la route de l'app (même origine) et rend la réponse validée", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ text: "Oui.", chips: [{ id: "x", label: "Voir" }] }));
    const rendu = await demanderLia("Est-ce prêt ?", signal, { fetchImpl, page: "/budget" });
    expect(rendu).toEqual({ text: "Oui.", chips: [{ id: "x", label: "Voir" }] });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/lia/ask");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(init.body as string)).toEqual({ question: "Est-ce prêt ?", page: "/budget" });
  });

  it("statut d'erreur : rejet (LIA dira « indisponible »)", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));
    await expect(demanderLia("?", signal, { fetchImpl })).rejects.toThrow(/503/);
  });

  it("pause générale (423) : rejet « en pause », LIA ne répond pas", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "paused" }, { status: 423 }));
    await expect(demanderLia("?", signal, { fetchImpl })).rejects.toThrow(/en pause/);
  });

  it("réponse non conforme : rejet, jamais du texte inventé", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ mood: "calme" }));
    await expect(demanderLia("?", signal, { fetchImpl })).rejects.toThrow(/non conforme/);
  });
});

describe("demanderAtelier", () => {
  it("poste sur la MÊME route avec le drapeau `atelier` et l'historique, et rend texte et blocs validés", async () => {
    const bloc = { type: "recette", source: "catalogue", id: 4, titre: "Chili" };
    const fetchImpl = vi.fn(async () => Response.json({ text: "Voilà.", blocks: [bloc] }));
    const historique = [{ role: "user" as const, contenu: "avant" }];
    const rendu = await demanderAtelier("Que cuisiner ?", historique, signal, fetchImpl);
    expect(rendu).toEqual({ text: "Voilà.", blocks: [bloc] });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/lia/ask");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(init.body as string)).toEqual({ atelier: true, question: "Que cuisiner ?", historique });
  });

  it("statut d'erreur ou réponse non conforme : rejet, LIA dit « indisponible », rien n'est inventé", async () => {
    await expect(demanderAtelier("?", [], signal, vi.fn(async () => new Response("{}", { status: 503 })))).rejects.toThrow(/503/);
    await expect(
      demanderAtelier("?", [], signal, vi.fn(async () => Response.json({ text: "ok", blocks: [{ type: "courbe" }] }))),
    ).rejects.toThrow(/non conforme/);
  });
});

describe("lirePauseServeur", () => {
  it("lit la route de l'app (même origine, cookie de session, jamais de cache)", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ pause: false }));
    await expect(lirePauseServeur(fetchImpl)).resolves.toBe(false);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/lia/pause");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
  });

  it("503, 401 ou corps illisible : illisible (donc en pause pour LIA)", async () => {
    await expect(lirePauseServeur(vi.fn(async () => Response.json({ error: "x" }, { status: 503 })))).resolves.toBeNull();
    await expect(lirePauseServeur(vi.fn(async () => Response.json({}, { status: 401 })))).resolves.toBeNull();
    await expect(lirePauseServeur(vi.fn(async () => new Response("<html>")))).resolves.toBeNull();
  });
});
