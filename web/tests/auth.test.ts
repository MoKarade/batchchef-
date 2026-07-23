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
