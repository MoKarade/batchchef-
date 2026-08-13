// Connexion unique entre les apps du hub : ce que le cookie de session doit porter,
// et surtout ce qu'il ne doit PAS porter.

import { describe, expect, it } from "vitest";
import { cookiesSessionPartagee } from "@/lib/sessionPartagee";

describe("cookiesSessionPartagee", () => {
  it("ne configure rien sans domaine — le cookie reste limité à l'hôte", () => {
    // Cas du développement local et des préversions Vercel : un cookie portant
    // Domain=.hubperso.com y serait REJETÉ par le navigateur, donc plus de session.
    expect(cookiesSessionPartagee(undefined)).toBeUndefined();
    expect(cookiesSessionPartagee("")).toBeUndefined();
    expect(cookiesSessionPartagee("   ")).toBeUndefined();
  });

  it("partage la session sur le domaine parent quand il est configuré", () => {
    const cookies = cookiesSessionPartagee(".hubperso.com");
    expect(cookies?.sessionToken?.options?.domain).toBe(".hubperso.com");
    expect(cookies?.sessionToken?.options?.secure).toBe(true);
    expect(cookies?.sessionToken?.options?.httpOnly).toBe(true);
    // `strict` casserait le retour de Google (navigation cross-site).
    expect(cookies?.sessionToken?.options?.sameSite).toBe("lax");
  });

  it("fige le nom du cookie pour que toutes les apps lisent le même", () => {
    // Auth.js ne préfixe `__Secure-` que s'il se croit en HTTPS : dérivé, le nom
    // pourrait différer d'une app à l'autre et le partage échouerait en silence.
    const cookies = cookiesSessionPartagee(".hubperso.com");
    expect(cookies?.sessionToken?.name).toBe("__Secure-authjs.session-token");
  });

  it("ne touche JAMAIS au cookie CSRF", () => {
    // `__Host-authjs.csrf-token` : le préfixe `__Host-` INTERDIT l'attribut Domain.
    // Lui en poser un ferait rejeter le cookie et casserait la connexion partout.
    const cookies = cookiesSessionPartagee(".hubperso.com");
    expect(cookies?.csrfToken).toBeUndefined();
    expect(Object.keys(cookies ?? {})).toEqual(["sessionToken"]);
  });
});
