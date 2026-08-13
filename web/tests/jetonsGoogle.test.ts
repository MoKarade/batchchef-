// Les jetons Google portés par le JWT de session partagé.
//
// Ce fichier doit rester identique dans les quatre apps Auth.js : c'est le filet qui
// attrape une divergence de portées, laquelle produirait le pire genre de bogue — une
// app qui marche ou non selon celle par laquelle on s'est connecté.

import { describe, expect, it } from "vitest";
import {
  MARGE_EXPIRATION_MS,
  PARAMS_AUTORISATION,
  PORTEE_TASKS,
  PORTEES_GOOGLE,
  jetonExpire,
  majJetonsGoogle,
} from "@/lib/jetonsGoogle";

describe("portées demandées à Google", () => {
  it("inclut l'identité ET Tasks", () => {
    expect(PORTEES_GOOGLE).toContain("openid");
    expect(PORTEES_GOOGLE).toContain("email");
    expect(PORTEES_GOOGLE).toContain(PORTEE_TASKS);
  });

  it("ne demande NI Drive, NI Agenda, NI Gmail", () => {
    // DriveAI et FinanceAI n'utilisent pas ce cookie : leur ajouter leurs portées ici
    // n'apporterait rien et multiplierait par quatre les portes vers un Drive complet.
    for (const interdite of ["drive", "calendar", "gmail", "spreadsheets"]) {
      expect(PORTEES_GOOGLE).not.toContain(interdite);
    }
  });

  it("force le consentement hors ligne — sans quoi pas de refresh_token", () => {
    // Google n'émet un refresh_token qu'à la PREMIÈRE autorisation d'un couple
    // client + compte, sauf consentement forcé. Le client étant partagé, cette première
    // autorisation est déjà faite : sans ces deux paramètres, une connexion rendrait un
    // jeton d'une heure et rien pour le renouveler.
    expect(PARAMS_AUTORISATION.access_type).toBe("offline");
    expect(PARAMS_AUTORISATION.prompt).toBe("consent");
    expect(PARAMS_AUTORISATION.scope).toBe(PORTEES_GOOGLE);
  });
});

describe("jetonExpire", () => {
  const maintenant = 1_700_000_000_000;

  it("traite une échéance inconnue comme expirée", () => {
    // On ne parie pas sur un jeton dont on ignore la durée de vie.
    expect(jetonExpire(undefined, maintenant)).toBe(true);
  });

  it("garde un jeton encore valide au-delà de la marge", () => {
    const dans10min = Math.floor(maintenant / 1000) + 600;
    expect(jetonExpire(dans10min, maintenant)).toBe(false);
  });

  it("renouvelle DANS la marge, pas seulement après expiration", () => {
    // Un appel lancé juste avant la limite arriverait après : on prend de l'avance.
    const dans30s = Math.floor(maintenant / 1000) + 30;
    expect(MARGE_EXPIRATION_MS).toBeGreaterThan(30_000);
    expect(jetonExpire(dans30s, maintenant)).toBe(true);
  });

  it("renouvelle un jeton déjà expiré", () => {
    const ilYA1h = Math.floor(maintenant / 1000) - 3600;
    expect(jetonExpire(ilYA1h, maintenant)).toBe(true);
  });
});

describe("majJetonsGoogle", () => {
  it("capture les jetons à la connexion", async () => {
    const token = await majJetonsGoogle({ email: "marc@example.com" }, {
      provider: "google",
      type: "oidc",
      providerAccountId: "1",
      access_token: "acces",
      refresh_token: "rafraichissement",
      expires_at: 1_800_000_000,
      scope: PORTEES_GOOGLE,
    });
    expect(token.accessToken).toBe("acces");
    expect(token.refreshToken).toBe("rafraichissement");
    expect(token.expiresAt).toBe(1_800_000_000);
    expect(token.error).toBeUndefined();
    // L'identité déjà présente n'est pas écrasée.
    expect(token.email).toBe("marc@example.com");
  });

  it("garde un jeton encore valide sans appeler Google", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const token = await majJetonsGoogle(
      { accessToken: "encore-bon", refreshToken: "r", expiresAt },
      null,
    );
    expect(token.accessToken).toBe("encore-bon");
    expect(token.error).toBeUndefined();
  });

  it("marque l'erreur plutôt que d'inventer un jeton quand il n'y a rien à renouveler", async () => {
    // Cas d'une session mintée avant ce changement, ou par une app sans portée Google.
    // BatchChef traduit cette erreur par « clique Reconnecter Google ».
    const token = await majJetonsGoogle({ email: "marc@example.com" }, null);
    expect(token.error).toBe("RefreshAccessTokenError");
    expect(token.accessToken).toBeUndefined();
  });
});
