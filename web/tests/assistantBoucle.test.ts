// La boucle agentique de l'assistant (`lib/assistant/boucle.ts`), avec un modèle SIMULÉ.
//
// ⚠️ Aucun appel réseau : le SDK Anthropic est remplacé. Les réponses simulées n'imitent
// que la FORME d'une réponse de l'API (blocs `text` / `tool_use`, `stop_reason`, `usage`) ;
// leurs textes sont des marqueurs de test (« réponse-finale »), jamais un contenu présenté
// comme venant de la vraie base. Les outils et la mesure du coût sont remplacés aussi : on
// éprouve ce que la boucle en fait, pas ce qu'ils font.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const construit = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...a: unknown[]) => create(...a) };
    constructor(options: unknown) {
      construit(options);
    }
  },
}));

const recordLlmUsage = vi.fn();
vi.mock("@/lib/llmUsage", () => ({
  recordLlmUsage: (...a: unknown[]) => recordLlmUsage(...a),
}));

const executerOutil = vi.fn();
const compterCatalogue = vi.fn();
vi.mock("@/lib/assistant/outils", () => ({
  OUTILS: [{ name: "outil-de-test", input_schema: { type: "object", properties: {} } }],
  executerOutil: (...a: unknown[]) => executerOutil(...a),
  compterCatalogue: () => compterCatalogue(),
}));

import { repondre } from "@/lib/assistant/boucle";
import {
  BUDGET_MS,
  MAX_MESSAGES_HISTORIQUE,
  MAX_TOURS_OUTILS,
  promptSysteme,
  type Message,
} from "@/lib/assistant/protocole";

const USAGE = { input_tokens: 1, output_tokens: 1 };

type Bloc =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input?: unknown };

function reponse(content: Bloc[], stop_reason: string = content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn") {
  return { content, stop_reason, usage: USAGE };
}

const texte = (t: string): Bloc => ({ type: "text", text: t });
const appel = (id: string, name = "outil-de-test", input: unknown = { cle: "valeur" }): Bloc => ({
  type: "tool_use",
  id,
  name,
  input,
});

/** Les arguments de chaque appel au modèle, COPIÉS au moment de l'appel (la boucle mute `messages`). */
const appels: Array<{ model: string; system: string; messages: Array<{ role: string; content: unknown }> }> = [];

const QUESTION: Message[] = [{ role: "user", contenu: "question-de-test" }];

beforeEach(() => {
  vi.clearAllMocks();
  appels.length = 0;
  vi.stubEnv("ANTHROPIC_API_KEY", "cle-de-test");
  compterCatalogue.mockResolvedValue(42);
  recordLlmUsage.mockResolvedValue(undefined);
  executerOutil.mockImplementation(async (nom: string) => `resultat-${nom}`);
  create.mockImplementation(async (args: (typeof appels)[number]) => {
    appels.push(structuredClone(args));
    throw new Error("réponse simulée non programmée");
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Programme les réponses successives du modèle simulé. */
function programmer(...reponses: Array<ReturnType<typeof reponse>>): void {
  for (const r of reponses) {
    create.mockImplementationOnce(async (args: (typeof appels)[number]) => {
      appels.push(structuredClone(args));
      return r;
    });
  }
}

describe("repondre — intégration éteinte", () => {
  it("sans clé API : le dit, sans créer de client ni appeler quoi que ce soit", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const r = await repondre(QUESTION);
    expect(r).toEqual({
      ok: false,
      texte: "L'assistant n'est pas configuré (clé API absente).",
      toursOutils: 0,
      borneAtteinte: false,
      coupeeEnCours: false,
    });
    expect(construit).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(compterCatalogue).not.toHaveBeenCalled();
  });
});

describe("repondre — un tour sans outil", () => {
  it("rend le texte du modèle, mesure le coût, et annonce la taille LUE du catalogue", async () => {
    programmer(reponse([texte("réponse-finale")]));
    const r = await repondre(QUESTION);

    expect(r).toEqual({ ok: true, texte: "réponse-finale", toursOutils: 0, borneAtteinte: false, coupeeEnCours: false });
    expect(construit).toHaveBeenCalledWith({ apiKey: "cle-de-test" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(appels[0]!.system).toBe(promptSysteme(42));
    expect(appels[0]!.messages).toEqual([{ role: "user", content: "question-de-test" }]);
    expect(recordLlmUsage).toHaveBeenCalledWith("assistant", USAGE, appels[0]!.model);
    expect(executerOutil).not.toHaveBeenCalled();
  });

  it("compte du catalogue indisponible : le prompt ne l'invente pas", async () => {
    compterCatalogue.mockResolvedValue(null);
    programmer(reponse([texte("ok")]));
    await repondre(QUESTION);
    expect(appels[0]!.system).toBe(promptSysteme(null));
  });

  it("joint plusieurs blocs de texte et ignore les blocs d'un autre type", async () => {
    programmer(reponse([texte("  partie-1"), { type: "thinking", thinking: "x" } as unknown as Bloc, texte("partie-2  ")]));
    expect((await repondre(QUESTION)).texte).toBe("partie-1\npartie-2");
  });

  it("réponse vide : une phrase honnête plutôt qu'une bulle vide", async () => {
    programmer(reponse([texte("   ")]));
    expect((await repondre(QUESTION)).texte).toBe("Je n'ai pas trouvé quoi répondre.");
  });

  it("coupée par le plafond de jetons : le DIT à la suite du texte", async () => {
    programmer(reponse([texte("début-de-réponse")], "max_tokens"));
    const r = await repondre(QUESTION);
    expect(r.coupeeEnCours).toBe(true);
    expect(r.texte).toBe("début-de-réponse\n\n[Réponse coupée : elle était trop longue. Demande-moi la suite.]");
  });
});

describe("repondre — appels d'outils", () => {
  it("exécute l'outil demandé et réinjecte son résultat, rattaché à la bonne demande", async () => {
    const demande = reponse([texte("je-cherche"), appel("appel-1", "outil-de-test", { q: "x" })]);
    programmer(demande, reponse([texte("réponse-finale")]));

    const r = await repondre(QUESTION);
    expect(r).toMatchObject({ ok: true, texte: "réponse-finale", toursOutils: 1, borneAtteinte: false });
    expect(executerOutil).toHaveBeenCalledWith("outil-de-test", { q: "x" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(recordLlmUsage).toHaveBeenCalledTimes(2);

    const second = appels[1]!.messages;
    expect(second).toHaveLength(3);
    expect(second[1]).toEqual({ role: "assistant", content: demande.content });
    expect(second[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "appel-1", content: "resultat-outil-de-test" }],
    });
  });

  it("plusieurs demandes dans une réponse : un résultat par demande, dans l'ordre", async () => {
    programmer(
      reponse([appel("a", "outil-un"), { type: "tool_use", id: "b", name: "outil-deux" }]),
      reponse([texte("fin")]),
    );
    const r = await repondre(QUESTION);
    expect(r.toursOutils).toBe(1);
    // Une demande sans `input` part avec un objet vide, jamais `undefined`.
    expect(executerOutil).toHaveBeenNthCalledWith(2, "outil-deux", {});
    const resultats = appels[1]!.messages[2]!.content as Array<{ tool_use_id: string; content: string }>;
    expect(resultats.map((x) => [x.tool_use_id, x.content])).toEqual([
      ["a", "resultat-outil-un"],
      ["b", "resultat-outil-deux"],
    ]);
  });

  it("borne de tours atteinte : réponse PARTIELLE qui le dit, sans dépasser la borne", async () => {
    create.mockImplementation(async (args: (typeof appels)[number]) => {
      appels.push(structuredClone(args));
      return reponse([appel(`appel-${appels.length}`)]);
    });
    const r = await repondre(QUESTION);
    expect(create).toHaveBeenCalledTimes(MAX_TOURS_OUTILS + 1);
    expect(executerOutil).toHaveBeenCalledTimes(MAX_TOURS_OUTILS);
    expect(r).toEqual({
      ok: true,
      texte:
        `J'ai cherché ${MAX_TOURS_OUTILS} fois dans la base sans arriver à conclure. ` +
        "Reformule en précisant (un ingrédient principal, un type de plat) — je repartirai de là.",
      toursOutils: MAX_TOURS_OUTILS,
      borneAtteinte: true,
      coupeeEnCours: false,
    });
  });

  it("budget de temps épuisé : s'arrête avant d'exécuter l'outil, et le dit", async () => {
    let maintenant = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => maintenant);
    create.mockImplementationOnce(async (args: (typeof appels)[number]) => {
      appels.push(structuredClone(args));
      maintenant += BUDGET_MS + 1;
      return reponse([appel("lent")]);
    });
    const r = await repondre(QUESTION);
    expect(executerOutil).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, toursOutils: 0, borneAtteinte: true, coupeeEnCours: false });
    expect(r.texte).toContain("J'ai manqué de temps");
  });

  it("juste sous le budget : la boucle continue", async () => {
    let maintenant = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => maintenant);
    create.mockImplementationOnce(async (args: (typeof appels)[number]) => {
      appels.push(structuredClone(args));
      maintenant += BUDGET_MS;
      return reponse([appel("a")]);
    });
    programmer(reponse([texte("fin")]));
    expect((await repondre(QUESTION)).toursOutils).toBe(1);
  });
});

describe("repondre — historique", () => {
  it("n'envoie que les MAX_MESSAGES_HISTORIQUE derniers messages, en commençant par Marc", async () => {
    const long: Message[] = Array.from({ length: MAX_MESSAGES_HISTORIQUE + 7 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      contenu: `message-${i}`,
    }));
    programmer(reponse([texte("fin")]));
    await repondre(long);
    const envoyes = appels[0]!.messages;
    expect(envoyes.length).toBeLessThanOrEqual(MAX_MESSAGES_HISTORIQUE);
    expect(envoyes[0]!.role).toBe("user");
    expect(envoyes.at(-1)).toEqual({ role: "user", content: `message-${MAX_MESSAGES_HISTORIQUE + 6}` });
  });
});

describe("repondre — pannes", () => {
  it("une erreur de l'API est PROPAGÉE, jamais avalée, et rien n'est comptabilisé", async () => {
    create.mockRejectedValueOnce(new Error("panne-api-simulée"));
    await expect(repondre(QUESTION)).rejects.toThrow("panne-api-simulée");
    expect(recordLlmUsage).not.toHaveBeenCalled();
  });

  it("une erreur au deuxième tour, après un outil, est propagée aussi", async () => {
    programmer(reponse([appel("a")]));
    create.mockRejectedValueOnce(new Error("panne-au-second-tour"));
    await expect(repondre(QUESTION)).rejects.toThrow("panne-au-second-tour");
    expect(executerOutil).toHaveBeenCalledTimes(1);
  });

  it("une mesure de coût en échec n'est pas masquée", async () => {
    programmer(reponse([texte("fin")]));
    recordLlmUsage.mockRejectedValueOnce(new Error("mesure-impossible"));
    await expect(repondre(QUESTION)).rejects.toThrow("mesure-impossible");
  });
});
