// tests/lia.contrat.test.ts — le contrat entre l'app, le navigateur et le hub (pur).

import { describe, expect, it } from "vitest";
import { DemandeHub, DemandeLia, QUESTION_MAX, ReponseLiaApp, estProprietaire } from "../lib/lia/contrat";

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
