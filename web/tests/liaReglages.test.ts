// tests/liaReglages.test.ts — une seule LIA, identique dans toutes les apps (demande du fil Assistant, 23/10/2026).
// Les réglages communs sont les défauts du paquet `@mokarade/lia-ui` : animations complètes et pastille d'humeur
// dessinée par le paquet. Les surcharger ici ferait dériver BatchChef du hub (même verrou côté Hubperso).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const lire = (chemin: string) => readFileSync(resolve(process.cwd(), chemin), "utf8");

/** Plus petit tag du paquet épinglé (réglages communs : défaut « complet », pastille d'humeur du paquet ; v0.13.0 : ses 39 actions ; v0.14.0 : parole propre et physique ; v0.15.0 : contexte de LIA, tout élément, appui long). */
const TAG_MINIMAL = [0, 15, 0] as const;

function versionDuTag(tag: string): number[] {
  const m = /^github:MoKarade\/lia-ui#v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!m) throw new Error(`épingle lia-ui invalide : ${tag} (attendu un tag vX.Y.Z, jamais une branche)`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function auMoins(version: number[], minimum: readonly number[]): boolean {
  for (let i = 0; i < minimum.length; i++) {
    const a = version[i] ?? 0;
    const b = minimum[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

describe("LIA : mêmes réglages que le hub", () => {
  const source = lire("components/LiaMontee.tsx");

  it("ne règle ni le mouvement réduit ni la pastille d'humeur (défauts du paquet)", () => {
    expect(source).not.toContain("quandMouvementReduit");
    expect(source).not.toContain("humeurVisible");
    // Parole propre (v0.14.0) : défaut du paquet, vraie par construction (jamais rien sur Marc ni sur ses apps).
    expect(source).not.toContain("parolePropre");
    expect(source).not.toContain("onSpontane");
  });

  it("une seule LIA : le composant est monté dans le layout", () => {
    expect(lire("app/layout.tsx")).toContain("<LiaMontee />");
  });

  it("paquet épinglé par tag, au moins v0.15.0, dans package.json et dans le lock", () => {
    const pkg = JSON.parse(lire("package.json")) as { dependencies: Record<string, string> };
    const lock = JSON.parse(lire("package-lock.json")) as {
      packages: Record<string, { version?: string; resolved?: string; dependencies?: Record<string, string> }>;
    };
    const epingle = pkg.dependencies["@mokarade/lia-ui"] ?? "";
    expect(auMoins(versionDuTag(epingle), TAG_MINIMAL)).toBe(true);
    expect(lock.packages[""]?.dependencies?.["@mokarade/lia-ui"]).toBe(epingle);
    const entree = lock.packages["node_modules/@mokarade/lia-ui"];
    expect(`github:MoKarade/lia-ui#v${entree?.version}`).toBe(epingle);
    expect(entree?.resolved).toMatch(/lia-ui\.git#[0-9a-f]{40}$/);
  });
});
