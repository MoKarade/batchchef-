// tests/lia.client.test.ts — le `ask` du navigateur : tout échec devient un rejet.

import { describe, expect, it, vi } from "vitest";
import { demanderLia, lirePauseServeur } from "../lib/lia/client";

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
