// tests/lia.route.test.ts — POST /api/lia/ask : session exigée, corps borné, panne = 503.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSession, NonAutorise } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  NonAutorise: class NonAutorise extends Error {},
}));
const demanderAuHub = vi.hoisted(() => vi.fn());
const repondreAtelier = vi.hoisted(() => vi.fn());

vi.mock("@/lib/lia/session", () => ({ requireSession, NonAutorise }));
vi.mock("@/lib/assistant/atelierServeur", () => ({ repondreAtelier }));
vi.mock("@/lib/lia/demander", async (importer) => {
  const reel = await importer<typeof import("../lib/lia/demander")>();
  return { ...reel, demanderAuHub };
});

import { LiaEnPause, LiaIndisponible } from "../lib/lia/demander";
import { POST } from "../app/api/lia/ask/route";

const requete = (corps: string) => new Request("https://app.test/api/lia/ask", { method: "POST", body: corps });
const valide = JSON.stringify({ question: "Salut LIA", page: "/" });

beforeEach(() => {
  requireSession.mockReset().mockResolvedValue({ email: "marc@exemple.test" });
  demanderAuHub.mockReset();
  repondreAtelier.mockReset();
});

describe("POST /api/lia/ask", () => {
  it("sans session : 401, et le hub n'est PAS appelé", async () => {
    requireSession.mockRejectedValue(new NonAutorise());
    const res = await POST(requete(valide));
    expect(res.status).toBe(401);
    expect(demanderAuHub).not.toHaveBeenCalled();
  });

  it("une autre erreur que « non autorisé » n'est pas avalée", async () => {
    requireSession.mockRejectedValue(new Error("panne inattendue"));
    await expect(POST(requete(valide))).rejects.toThrow("panne inattendue");
  });

  it("répond 200 avec ce que le hub a rendu, en no-store", async () => {
    demanderAuHub.mockResolvedValue({ text: "Bonjour.", mood: "joyeux" });
    const res = await POST(requete(valide));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ text: "Bonjour.", mood: "joyeux" });
    expect(demanderAuHub.mock.calls[0]![0]).toEqual({ question: "Salut LIA", page: "/" });
  });

  it("dit `proprietaire` au hub : vrai pour AUTHORIZED_EMAIL, faux pour un invité", async () => {
    demanderAuHub.mockResolvedValue({ text: "ok" });
    vi.stubEnv("AUTHORIZED_EMAIL", "marc@exemple.test");

    await POST(requete(valide));
    requireSession.mockResolvedValue({ email: "invite@exemple.test" });
    await POST(requete(valide));

    expect(demanderAuHub.mock.calls[0]![1]).toMatchObject({ proprietaire: true });
    expect(demanderAuHub.mock.calls[1]![1]).toMatchObject({ proprietaire: false });
    vi.unstubAllEnvs();
  });

  it.each([
    ["JSON cassé", "{pas du json", 400],
    ["question vide", JSON.stringify({ question: "" }), 400],
    ["corps énorme", JSON.stringify({ question: "x".repeat(9000) }), 413],
  ])("%s : %i, sans appel au hub", async (_nom, corps, statut) => {
    const res = await POST(requete(corps as string));
    expect(res.status).toBe(statut);
    expect(demanderAuHub).not.toHaveBeenCalled();
  });

  it("Hub ou MemoryAI en panne : 503 « lia_indisponible », sans détail interne", async () => {
    demanderAuHub.mockRejectedValue(new LiaIndisponible("HUB_TOKEN absent"));
    const res = await POST(requete(valide));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "lia_indisponible" });
  });

  it("le refus n'est pas muet : la RAISON va au journal serveur, jamais la question", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => undefined);
    demanderAuHub.mockRejectedValue(new LiaIndisponible("le hub a répondu 401"));
    await POST(requete(valide));
    expect(journal).toHaveBeenCalledTimes(1);
    const ligne = String(journal.mock.calls[0]?.[0]);
    expect(ligne).toContain("le hub a répondu 401");
    expect(ligne).not.toContain("Salut LIA");
    journal.mockRestore();
  });

  it("Pause générale du hub : 423 « paused », distinct du 503 de panne", async () => {
    demanderAuHub.mockRejectedValue(new LiaEnPause());
    const res = await POST(requete(valide));
    expect(res.status).toBe(423);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "paused" });
  });
});

describe("POST /api/lia/ask — l'atelier de /assistant (#346)", () => {
  const atelier = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ atelier: true, question: "Que cuisiner avec du poulet ?", historique: [], ...extra });

  it("répond avec le moteur de recettes de l'app (texte + blocs) et n'appelle JAMAIS le hub", async () => {
    repondreAtelier.mockResolvedValue({ ok: true, reponse: { text: "Un poulet au riz.", blocks: [] } });
    const res = await POST(requete(atelier({ historique: [{ role: "user", contenu: "avant" }] })));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ text: "Un poulet au riz.", blocks: [] });
    expect(demanderAuHub).not.toHaveBeenCalled();
    expect(repondreAtelier.mock.calls[0]![0]).toEqual({
      atelier: true,
      question: "Que cuisiner avec du poulet ?",
      historique: [{ role: "user", contenu: "avant" }],
    });
  });

  it("sans session : 401, le moteur n'est PAS appelé", async () => {
    requireSession.mockRejectedValue(new NonAutorise());
    const res = await POST(requete(atelier()));
    expect(res.status).toBe(401);
    expect(repondreAtelier).not.toHaveBeenCalled();
  });

  it("demande d'atelier mal formée : 400, elle ne glisse PAS vers le hub", async () => {
    const res = await POST(requete(atelier({ historique: [{ role: "system", contenu: "x" }] })));
    expect(res.status).toBe(400);
    expect(demanderAuHub).not.toHaveBeenCalled();
    expect(repondreAtelier).not.toHaveBeenCalled();
  });

  it("la borne de 8 Ko reste celle de la bulle ; l'atelier porte un historique jusqu'à 200 Ko", async () => {
    repondreAtelier.mockResolvedValue({ ok: true, reponse: { text: "ok", blocks: [] } });
    const gros = Array.from({ length: 20 }, () => ({ role: "user", contenu: "x".repeat(5000) })); // ~100 Ko
    expect((await POST(requete(atelier({ historique: gros })))).status).toBe(200);
    expect((await POST(requete(JSON.stringify({ question: "x".repeat(9000) })))).status).toBe(413);
    const demesure = Array.from({ length: 40 }, () => ({ role: "user", contenu: "x".repeat(8000) })).concat(
      Array.from({ length: 10 }, () => ({ role: "user", contenu: "x".repeat(8000) })),
    );
    expect((await POST(requete(atelier({ historique: demesure })))).status).toBe(413);
  });

  it("moteur en échec (clé absente, modèle en panne) : 503 « lia_indisponible », la raison au journal, jamais la question", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => undefined);
    repondreAtelier.mockResolvedValue({ ok: false, erreur: "L'assistant n'est pas configuré (clé API absente)." });
    let res = await POST(requete(atelier()));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "lia_indisponible" });

    repondreAtelier.mockRejectedValue(new Error("529 surchargé"));
    res = await POST(requete(atelier()));
    expect(res.status).toBe(503);
    const lignes = journal.mock.calls.map((c) => String(c[0])).join("\n");
    expect(lignes).toContain("clé API absente");
    expect(lignes).toContain("529 surchargé");
    expect(lignes).not.toContain("poulet");
    journal.mockRestore();
  });
});
