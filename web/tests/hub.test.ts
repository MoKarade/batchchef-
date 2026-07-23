// Endpoint hub : conformité du summary au contrat + jeton à temps constant.

import { describe, expect, it } from "vitest";
import { composeBatchchefSummary } from "../lib/hubSummary";
import { hubTokensMatch } from "../lib/hubToken";

const BASE = "https://batchchef.example.com";

describe("composeBatchchefSummary (conforme au contrat)", () => {
  it("base vide → status 'building' (jamais des 0 qui font croire à un état 'ok')", () => {
    const s = composeBatchchefSummary(
      { recipes: 0, batches: 0, activeBatches: 0, toBuy: 0, budgetRemaining: 0 },
      BASE,
    );
    expect(s.status).toBe("building");
    expect(s.app.id).toBe("batchchef");
    expect(s.contractVersion).toBe(1);
  });

  it("avec des données → status 'ok', 4 métriques, action d'ouverture", () => {
    const s = composeBatchchefSummary(
      { recipes: 12, batches: 3, activeBatches: 2, toBuy: 7, budgetRemaining: 41.239 },
      BASE,
    );
    expect(s.status).toBe("ok");
    expect(s.metrics).toHaveLength(4);
    // budget arrondi au cent (jamais un flottant qui bave)
    expect(s.metrics.find((m) => m.label.startsWith("Budget"))?.value).toBe(41.24);
    expect(s.actions[0]).toMatchObject({ kind: "link", href: BASE });
  });

  it("articles à acheter → alerte info + sévérité warn sur la métrique", () => {
    const s = composeBatchchefSummary(
      { recipes: 5, batches: 1, activeBatches: 1, toBuy: 4, budgetRemaining: 10 },
      BASE,
    );
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0]).toMatchObject({ severity: "info", href: `${BASE}/batchs` });
    expect(s.metrics.find((m) => m.label === "Articles à acheter")?.severity).toBe("warn");
  });

  it("rien à acheter → aucune alerte, sévérité 'ok'", () => {
    const s = composeBatchchefSummary(
      { recipes: 5, batches: 1, activeBatches: 0, toBuy: 0, budgetRemaining: 0 },
      BASE,
    );
    expect(s.alerts).toHaveLength(0);
    expect(s.metrics.find((m) => m.label === "Articles à acheter")?.severity).toBe("ok");
  });
});

describe("hubTokensMatch (temps constant, fail-closed)", () => {
  it("accepte deux jetons identiques", () => {
    expect(hubTokensMatch("s3cr3t-token", "s3cr3t-token")).toBe(true);
  });
  it("refuse un jeton différent (même longueur ou non)", () => {
    expect(hubTokensMatch("s3cr3t-token", "autre-token!!")).toBe(false);
    expect(hubTokensMatch("court", "beaucoup-plus-long")).toBe(false);
  });
  it("refuse un jeton vide (jamais « vide == vide »)", () => {
    expect(hubTokensMatch("", "")).toBe(false);
    expect(hubTokensMatch("", "attendu")).toBe(false);
    expect(hubTokensMatch("fourni", "")).toBe(false);
  });
});
