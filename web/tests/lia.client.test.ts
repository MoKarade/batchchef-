// tests/lia.client.test.ts — le `ask` du navigateur : tout échec devient un rejet.

import { describe, expect, it, vi } from "vitest";
import { demanderLia } from "../lib/lia/client";

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

  it("réponse non conforme : rejet, jamais du texte inventé", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ mood: "calme" }));
    await expect(demanderLia("?", signal, { fetchImpl })).rejects.toThrow(/non conforme/);
  });
});
