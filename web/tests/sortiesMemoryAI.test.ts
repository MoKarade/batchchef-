// Sorties de BatchChef vers MemoryAI (batchchef-#320) : constructeurs purs et envoi.
// Valeurs de test neutres : aucun jeton réel, aucune donnée de Marc.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  construireRef,
  envoyerSorties,
  evenementBatchCree,
  evenementListeTerminee,
  evenementRecetteAjoutee,
  lignePropre,
  type EvenementSortie,
} from "@/lib/sortiesMemoryAI";

const MAINTENANT = new Date("2026-10-26T16:30:00-04:00");
const JETON_TEST = "jeton-de-test-neutre";
const ENV = { MEMORYAI_SORTIES_TOKEN: JETON_TEST };
const TITRE = /^[^\r\n]{1,120}$/;
const REF = /^[\x21-\x7E]{1,80}$/;

function evenementValide(): EvenementSortie {
  const e = evenementBatchCree({ id: 12, nom: "batch-test", recettes: 2, articles: 9 }, MAINTENANT);
  if (!e) throw new Error("événement de test invalide");
  return e;
}

afterEach(() => vi.restoreAllMocks());

describe("lignePropre", () => {
  it("ramène espaces et retours à la ligne à une seule espace, sans balise", () => {
    expect(lignePropre("  a\n\n b\t<b>c</b>  ", 50)).toBe("a b bc/b");
  });
  it("coupe par point de code, jamais au milieu d'un caractère", () => {
    const coupe = lignePropre("😀".repeat(100), 120);
    expect(coupe.length).toBeLessThanOrEqual(120);
    expect([...coupe].every((c) => c === "😀")).toBe(true);
  });
});

describe("constructeurs d'événements", () => {
  it("batch créé : type, date ISO avec décalage, titre d'une ligne, ref stable", () => {
    const e = evenementBatchCree({ id: 12, nom: "batch-test", recettes: 2, articles: 9 }, MAINTENANT);
    expect(e).toEqual({
      type: "batch_cree",
      date: "2026-10-26T20:30:00.000Z",
      titre: "Batch créé · batch-test",
      resume: "2 recettes, 9 articles sur la liste d'épicerie.",
      ref: "batchchef-batch-12",
    });
    expect(e?.titre).toMatch(TITRE);
    expect(e?.ref).toMatch(REF);
  });

  it("recette ajoutée : une ref par recette", () => {
    const e = evenementRecetteAjoutee({ id: 7, titre: "recette-test" }, MAINTENANT);
    expect(e).toMatchObject({
      type: "recette_ajoutee",
      titre: "Recette ajoutée · recette-test",
      ref: "batchchef-recette-7",
    });
  });

  it("liste terminée : ref par batch, au singulier quand il y a un seul article", () => {
    const e = evenementListeTerminee({ batchId: 3, nom: "batch-test", articles: 1 }, MAINTENANT);
    expect(e).toMatchObject({
      type: "liste_terminee",
      resume: "1 article cochés.",
      ref: "batchchef-liste-3",
    });
  });

  it("un nom très long est coupé à 120 caractères et reste sur une ligne", () => {
    const e = evenementBatchCree(
      { id: 1, nom: `ligne un\nligne deux ${"x".repeat(300)}`, recettes: 1, articles: 1 },
      MAINTENANT,
    );
    expect(e?.titre).toMatch(TITRE);
    expect(e?.titre.length).toBeLessThanOrEqual(120);
  });

  it("refuse un identifiant invalide ou un titre vide au lieu d'inventer", () => {
    expect(construireRef("batch", -1)).toBeNull();
    expect(construireRef("batch", 1.5)).toBeNull();
    expect(evenementRecetteAjoutee({ id: 1, titre: "<>" }, MAINTENANT)).toMatchObject({
      titre: "Recette ajoutée ·",
    });
    expect(evenementBatchCree({ id: -1, nom: "x", recettes: 1, articles: 1 }, MAINTENANT)).toBeNull();
    expect(
      evenementBatchCree({ id: 1, nom: "x", recettes: 1, articles: 1 }, new Date("pas une date")),
    ).toBeNull();
  });
});

describe("envoyerSorties", () => {
  it("n'envoie rien sans jeton", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await envoyerSorties([evenementValide()], { fetchImpl, env: {} });
    await envoyerSorties([evenementValide()], { fetchImpl, env: { MEMORYAI_SORTIES_TOKEN: "  " } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("envoie le contrat : URL par défaut, jeton en Bearer, corps sans clé app", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await envoyerSorties([evenementValide()], { fetchImpl, env: ENV });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://memoryai.hubperso.com/api/sorties");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${JETON_TEST}`,
      "Content-Type": "application/json",
    });
    const corps = JSON.parse(String(init?.body));
    expect(corps.source).toBe("sorties");
    expect(corps.evenements).toHaveLength(1);
    expect(corps).not.toHaveProperty("app");
    expect(corps.evenements[0]).not.toHaveProperty("app");
  });

  it("MEMORYAI_URL remplace le défaut, sans double barre", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await envoyerSorties([evenementValide()], {
      fetchImpl,
      env: { ...ENV, MEMORYAI_URL: "https://memoire.exemple.test//" },
    });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://memoire.exemple.test/api/sorties");
  });

  it("refuse une URL qui n'est pas en https", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await envoyerSorties([evenementValide()], {
      fetchImpl,
      env: { ...ENV, MEMORYAI_URL: "http://exemple.test" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("une réponse 500 ne lève pas et le journal ne contient ni jeton, ni titre, ni texte de réponse", async () => {
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("texte-de-reponse-confidentiel", { status: 500 }),
    );
    await expect(envoyerSorties([evenementValide()], { fetchImpl, env: ENV })).resolves.toBeUndefined();
    const journal = JSON.stringify(avertir.mock.calls);
    expect(journal).toContain("reponse_http");
    expect(journal).toContain("500");
    expect(journal).not.toContain(JETON_TEST);
    expect(journal).not.toContain("batch-test");
    expect(journal).not.toContain("texte-de-reponse-confidentiel");
  });

  it("une erreur réseau ne lève pas et ne journalise pas son message", async () => {
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error(`secret ${JETON_TEST} batch-test`);
    });
    await expect(envoyerSorties([evenementValide()], { fetchImpl, env: ENV })).resolves.toBeUndefined();
    const journal = JSON.stringify(avertir.mock.calls);
    expect(journal).toContain("reseau");
    expect(journal).not.toContain(JETON_TEST);
    expect(journal).not.toContain("batch-test");
  });

  it("un délai dépassé est absorbé et dit « délai »", async () => {
    vi.useFakeTimers();
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>(
      (_u, init) =>
        new Promise<Response>((_ok, rejeter) => {
          init?.signal?.addEventListener("abort", () => rejeter(new Error("coupé")), { once: true });
        }),
    );
    const envoi = envoyerSorties([evenementValide()], { fetchImpl, env: ENV });
    await vi.advanceTimersByTimeAsync(2_600);
    await expect(envoi).resolves.toBeUndefined();
    expect(JSON.stringify(avertir.mock.calls)).toContain("delai_depasse");
    vi.useRealTimers();
  });

  it("n'envoie pas plus de 50 événements d'un coup ni une liste vide", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await envoyerSorties([], { fetchImpl, env: ENV });
    await envoyerSorties(Array.from({ length: 51 }, evenementValide), { fetchImpl, env: ENV });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
