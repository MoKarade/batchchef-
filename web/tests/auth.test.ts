// Auth pure (pattern hub) : allowlist mono-adresse, garde de chemins, fail-closed.

import { describe, expect, it } from "vitest";
import { isAuthorizedEmail } from "../lib/authorized";
import { decideGuard, isPublicPath } from "../lib/authGuard";
import { isAuthConfigured } from "../lib/authConfigured";

describe("isAuthorizedEmail", () => {
  it("admet uniquement l'adresse configurée (case/trim insensible)", () => {
    expect(isAuthorizedEmail(" Marc@Example.com ", "marc@example.com")).toBe(true);
    expect(isAuthorizedEmail("autre@example.com", "marc@example.com")).toBe(false);
  });
  it("refuse si l'allowlist n'est pas configurée (jamais fail-open)", () => {
    expect(isAuthorizedEmail("marc@example.com", "")).toBe(false);
    expect(isAuthorizedEmail("marc@example.com", undefined)).toBe(false);
  });
});

describe("garde des chemins", () => {
  it("routes publiques : login, api/auth, assets", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/auth/callback/google")).toBe(true);
    expect(isPublicPath("/manifest.webmanifest")).toBe(true);
    expect(isPublicPath("/recettes")).toBe(false);
    expect(isPublicPath("/courses/3")).toBe(false);
  });
  it("l'endpoint hub est public (gardé par jeton dans la route, pas par session)", () => {
    expect(isPublicPath("/api/hub/summary")).toBe(true);
    // mais pas les autres routes /api (elles exigent une session)
    expect(isPublicPath("/api/hub/other")).toBe(false);
  });
  it("l'endpoint MCP est public, et SEUL lui — jamais son préfixe", () => {
    // Même raison que le hub : c'est une machine qui appelle, elle n'a pas de cookie.
    // Laissé sous la garde de session, Claude recevrait une redirection HTML vers /login
    // au lieu du JSON-RPC — un serveur muet, sans qu'aucune erreur ne le dise.
    expect(isPublicPath("/api/mcp")).toBe(true);
    // L'exemption est une ÉGALITÉ : la route qu'on écrira demain sous ce préfixe doit
    // retomber du côté gardé tant que personne n'a décidé le contraire. Le mauvais côté
    // de l'oubli doit être le côté sûr (règle héritée de CarAI).
    expect(isPublicPath("/api/mcp/outils")).toBe(false);
    expect(isPublicPath("/api/mcp-admin")).toBe(false);
  });
  it("non authentifié : page → redirect login, API → 401", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/batchs" })).toEqual({
      type: "redirect",
      location: "/login?callbackUrl=%2Fbatchs",
    });
    expect(decideGuard({ isAuthenticated: false, pathname: "/api/x" })).toEqual({
      type: "unauthorized",
    });
    expect(decideGuard({ isAuthenticated: true, pathname: "/batchs" })).toEqual({
      type: "next",
    });
  });
});

describe("isAuthConfigured", () => {
  it("exige secret ET allowlist", () => {
    expect(isAuthConfigured({ AUTH_SECRET: "s", AUTHORIZED_EMAIL: "a@b.c" })).toBe(true);
    expect(isAuthConfigured({ AUTH_SECRET: "s" })).toBe(false);
    expect(isAuthConfigured({ AUTH_SECRET: " ", AUTHORIZED_EMAIL: "a@b.c" })).toBe(false);
  });
});
