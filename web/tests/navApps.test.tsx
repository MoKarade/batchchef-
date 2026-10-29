// tests/navApps.test.tsx — l'onglet « Apps » : rendu serveur du composant et porte de montage.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSession, NonAutorise } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  NonAutorise: class NonAutorise extends Error {},
}));
vi.mock("@/lib/lia/session", () => ({ requireSession, NonAutorise }));

import NavApps from "../components/NavApps";
import { APPS_DU_PARC } from "../lib/appsDuParc";
import { APP_COURANTE, navAppsAutorisee } from "../lib/navAppsMonter";

const html = renderToStaticMarkup(<NavApps courant="batchchef" />);
const liens = [...html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].map((m) => ({ attrs: m[1] ?? "", nom: m[2] ?? "" }));
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

describe("NavApps : rendu serveur", () => {
  it("6 liens, aux adresses de lib/appsDuParc.ts, dans l'ordre et sans l'app courante", () => {
    const attendues = APPS_DU_PARC.filter((a) => a.id !== "batchchef");
    expect(attendues).toHaveLength(6);
    expect(liens.map((l) => l.attrs.match(/href="([^"]*)"/)?.[1])).toEqual(attendues.map((a) => a.adresse));
    expect(liens.map((l) => l.nom)).toEqual(attendues.map((a) => a.nom));
  });

  it("aucun lien vers l'app courante, quelle qu'elle soit", () => {
    for (const courante of APPS_DU_PARC) {
      const rendu = renderToStaticMarkup(<NavApps courant={courante.id} />);
      expect(rendu).not.toContain(`href="${courante.adresse}"`);
      expect(rendu.match(/<a\b/g)).toHaveLength(6);
    }
  });

  it("liens sans target ni donnée dynamique : même onglet, adresse figée", () => {
    for (const { attrs } of liens) {
      expect(attrs).not.toContain("target");
      const href = /href="([^"]*)"/.exec(attrs)?.[1] ?? "";
      expect(href).toMatch(/^https:\/\/[a-z.]+$/);
    }
  });

  it("replié par défaut, résumé nommé, zéro JavaScript", () => {
    expect(html).toMatch(/^<details class="nav-apps">/);
    expect(html).not.toContain(" open");
    expect(html).toMatch(/<summary[^>]*aria-label="[^"]+"/);
    expect(html).not.toContain("<script");
  });

  it("un id inconnu lève (jamais un onglet vide)", () => {
    // @ts-expect-error id volontairement hors AppId
    expect(() => renderToStaticMarkup(<NavApps courant="inconnue" />)).toThrow();
  });

  it("cibles d'au moins 44 px (2.75rem) pour l'onglet et chaque lien", () => {
    for (const classe of ["nav-apps-onglet", "nav-apps-lien"]) {
      const bloc = new RegExp(`\\.${classe}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(bloc, classe).toMatch(/min-height:\s*2\.75rem/);
      expect(bloc, classe).toMatch(/font-size:\s*1rem/);
    }
  });
});

describe("navAppsAutorisee : propriétaire seulement", () => {
  beforeEach(() => {
    requireSession.mockReset();
    process.env.AUTHORIZED_EMAIL = "marc@exemple.test";
  });

  it("l'id courant du squelette est une destination du parc", () => {
    expect(APPS_DU_PARC.map((a) => a.id)).toContain(APP_COURANTE);
  });

  it("propriétaire : vrai (casse et espaces ignorés)", async () => {
    requireSession.mockResolvedValue({ email: " Marc@Exemple.test " });
    expect(await navAppsAutorisee()).toBe(true);
  });

  it("sans session (page de connexion) : faux", async () => {
    requireSession.mockRejectedValue(new NonAutorise());
    expect(await navAppsAutorisee()).toBe(false);
  });

  it("session admise mais pas propriétaire : faux", async () => {
    requireSession.mockResolvedValue({ email: "invite@exemple.test" });
    expect(await navAppsAutorisee()).toBe(false);
  });

  it("AUTHORIZED_EMAIL absent : faux (échec fermé)", async () => {
    delete process.env.AUTHORIZED_EMAIL;
    requireSession.mockResolvedValue({ email: "marc@exemple.test" });
    expect(await navAppsAutorisee()).toBe(false);
  });

  it("toute autre erreur remonte", async () => {
    requireSession.mockRejectedValue(new Error("panne"));
    await expect(navAppsAutorisee()).rejects.toThrow("panne");
  });
});

describe("montage dans app/layout.tsx", () => {
  const layout = readFileSync(join(__dirname, "..", "app", "layout.tsx"), "utf8");
  it("monte NavApps seulement quand navAppsAutorisee() est vrai", () => {
    expect(layout).toContain("navAppsAutorisee()");
    expect(layout).toMatch(/\{navApps \? <NavApps courant=\{APP_COURANTE\} \/> : null\}/);
  });
});
