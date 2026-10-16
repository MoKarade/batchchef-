// tests/sentryConfig.test.ts — verrou de la configuration Sentry (tâche #220).
//
// Trois promesses : sans DSN rien ne part (un build sans DSN démarre sans bruit), même avec un DSN
// aucune donnée personnelle ne part, et la CSP laisse le navigateur joindre Sentry (sinon chaque
// envoi serait bloqué en silence).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { optionsSentry, retirerDonneesPersonnelles } from "@/lib/sentryConfig";

describe("optionsSentry", () => {
  it("est éteint sans DSN (absent, vide ou en blancs)", () => {
    for (const dsn of [undefined, "", "   "]) {
      const options = optionsSentry(dsn);
      expect(options.enabled, `dsn = ${JSON.stringify(dsn)}`).toBe(false);
      expect(options.dsn).toBeUndefined();
    }
  });

  it("est allumé avec un DSN, sans traces ni donnée personnelle par défaut", () => {
    const options = optionsSentry("  https://cle@exemple.invalid/1  ");
    expect(options.enabled).toBe(true);
    expect(options.dsn).toBe("https://cle@exemple.invalid/1");
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
  });
});

describe("retirerDonneesPersonnelles", () => {
  it("retire corps, cookies, en-têtes, chaîne de requête et utilisateur, garde le reste", () => {
    const evenement = retirerDonneesPersonnelles({
      message: "Erreur d'essai",
      request: {
        url: "https://exemple.invalid/page",
        data: { courriel: "fictif@exemple.invalid" },
        cookies: { session: "fictif" },
        headers: { authorization: "fictif", "x-forwarded-for": "203.0.113.7" },
        query_string: "jeton=fictif",
      } as Record<string, unknown>,
      user: { ip_address: "203.0.113.7", email: "fictif@exemple.invalid" },
    });
    expect(evenement.request).toEqual({ url: "https://exemple.invalid/page" });
    expect(evenement).not.toHaveProperty("user");
    expect(evenement.message).toBe("Erreur d'essai");
  });

  it("accepte un événement sans requête ni utilisateur", () => {
    expect(retirerDonneesPersonnelles({ message: "seul" })).toEqual({ message: "seul" });
  });

  it("est bien branché dans les options (beforeSend)", () => {
    const options = optionsSentry("https://cle@exemple.invalid/1");
    expect(options.beforeSend({ user: { email: "x" } })).not.toHaveProperty("user");
  });
});

describe("branchement", () => {
  const lire = (chemin: string): string => readFileSync(join(process.cwd(), chemin), "utf8");

  it("aucun fichier ne réactive l'envoi de données personnelles", () => {
    for (const chemin of ["instrumentation.ts", "instrumentation-client.ts", "lib/sentryConfig.ts"]) {
      expect(lire(chemin), chemin).not.toMatch(/sendDefaultPii\s*:\s*true/);
    }
  });

  it("le serveur et le navigateur passent par optionsSentry, jamais par un Sentry.init libre", () => {
    for (const chemin of ["instrumentation.ts", "instrumentation-client.ts"]) {
      expect(lire(chemin), chemin).toMatch(/Sentry\.init\(optionsSentry\(/);
    }
  });

  it("la CSP autorise les hôtes d'ingestion Sentry dans `connect-src`, et eux seuls en plus de 'self'", () => {
    const ligne = lire("next.config.ts")
      .split("\n")
      .find((l) => l.trimStart().startsWith('"connect-src '));
    expect(ligne, "directive connect-src introuvable").toBeDefined();
    const sources = (ligne ?? "").replace(/^\s*"connect-src /, "").replace(/",?\s*$/, "").split(" ");
    expect(sources[0]).toBe("'self'");
    for (const source of sources.slice(1)) {
      expect(source, source).toMatch(/^https:\/\/\*\.ingest(\.[a-z]+)?\.sentry\.io$/);
    }
    expect(sources.length).toBeGreaterThan(1);
  });
});
