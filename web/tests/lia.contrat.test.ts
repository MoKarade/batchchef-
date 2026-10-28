// tests/lia.contrat.test.ts — le contrat entre l'app, le navigateur et le hub (pur).

import { describe, expect, it } from "vitest";
import { DemandeAtelier, DemandeHub, DemandeLia, QUESTION_MAX, ReponseAtelier, ReponseLiaApp, estProprietaire } from "../lib/lia/contrat";

describe("DemandeLia", () => {
  it("accepte une question, rognée, avec la page courante", () => {
    expect(DemandeLia.parse({ question: "  Quel est mon solde ?  ", page: "/budget" })).toEqual({
      question: "Quel est mon solde ?",
      page: "/budget",
    });
  });

  it.each([
    ["vide", { question: "   " }],
    ["trop longue", { question: "x".repeat(QUESTION_MAX + 1) }],
    ["page qui n'est pas un chemin", { question: "ok", page: "https://ailleurs.test/" }],
    ["absente", {}],
  ])("rejette une question %s", (_nom, corps) => {
    expect(DemandeLia.safeParse(corps).success).toBe(false);
  });
});

describe("DemandeHub et estProprietaire", () => {
  it("le saut app → hub exige `proprietaire` (booléen)", () => {
    expect(DemandeHub.parse({ question: "ok", proprietaire: false })).toEqual({ question: "ok", proprietaire: false });
    expect(DemandeHub.safeParse({ question: "ok" }).success).toBe(false);
    expect(DemandeHub.safeParse({ question: "ok", proprietaire: "oui" }).success).toBe(false);
  });

  it.each([
    ["marc@exemple.test", "marc@exemple.test", true],
    ["  Marc@Exemple.TEST ", "marc@exemple.test", true],
    ["invite@exemple.test", "marc@exemple.test", false],
    ["marc@exemple.test", undefined, false],
    ["marc@exemple.test", "  ", false],
    ["", "", false],
  ])("`%s` face à AUTHORIZED_EMAIL `%s` : %s", (email, attendu, rendu) => {
    expect(estProprietaire(email, attendu)).toBe(rendu);
  });
});

describe("ReponseLiaApp", () => {
  it("rend le texte, les puces et l'humeur, et STRIPPE les blocs et tout champ inconnu", () => {
    const lue = ReponseLiaApp.parse({
      text: "Voici.",
      chips: [{ id: "a", label: "Détails" }],
      mood: "curieux",
      blocks: [{ type: "carte", html: "<img src=x onerror=alert(1)>" }],
      secret: "x",
    });
    expect(lue).toEqual({ text: "Voici.", chips: [{ id: "a", label: "Détails" }], mood: "curieux" });
  });

  it.each([
    ["texte vide", { text: "" }],
    ["humeur inconnue", { text: "ok", mood: "furieux" }],
    ["trop de puces", { text: "ok", chips: Array.from({ length: 7 }, (_, i) => ({ id: `${i}`, label: "x" })) }],
    ["texte absent", { mood: "calme" }],
  ])("rejette une réponse avec %s", (_nom, corps) => {
    expect(ReponseLiaApp.safeParse(corps).success).toBe(false);
  });
});

describe("l'atelier de /assistant (#346)", () => {
  it("DemandeAtelier : drapeau obligatoire, historique borné et à rôles connus", () => {
    const ok = DemandeAtelier.safeParse({ atelier: true, question: "  Que cuisiner ? ", historique: [{ role: "user", contenu: "a" }] });
    expect(ok.success && ok.data.question).toBe("Que cuisiner ?");
    expect(DemandeAtelier.parse({ atelier: true, question: "?" }).historique).toEqual([]);
    expect(DemandeAtelier.safeParse({ question: "?" }).success).toBe(false); // sans drapeau : ce n'est pas l'atelier
    expect(DemandeAtelier.safeParse({ atelier: false, question: "?" }).success).toBe(false);
    expect(DemandeAtelier.safeParse({ atelier: true, question: "?", historique: [{ role: "system", contenu: "x" }] }).success).toBe(false);
    expect(
      DemandeAtelier.safeParse({ atelier: true, question: "?", historique: Array.from({ length: 41 }, () => ({ role: "user", contenu: "x" })) }).success,
    ).toBe(false);
  });

  it("ReponseAtelier : texte + blocs d'un catalogue fermé ; un bloc inconnu fait refuser la réponse", () => {
    const bloc = { type: "recette", source: "catalogue", id: 4, titre: "Chili" };
    expect(ReponseAtelier.parse({ text: "Voilà.", blocks: [bloc] }).blocks).toEqual([bloc]);
    expect(ReponseAtelier.parse({ text: "Voilà." }).blocks).toEqual([]);
    expect(ReponseAtelier.safeParse({ text: "Voilà.", blocks: [{ type: "courbe" }] }).success).toBe(false);
    expect(ReponseAtelier.safeParse({ text: "" }).success).toBe(false);
  });
});
