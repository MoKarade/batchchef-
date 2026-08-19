// Le mini serveur OAuth 2.1 qui rend le MCP branchable depuis claude.ai.
//
// Ce qui est testé ici est ce qui, mal fait, LIVRE l'accès : l'allowlist de redirection,
// PKCE, l'usage unique des codes, et le fait qu'un code ne puisse pas servir de jeton
// d'accès. Le module est pur — `now` est injecté, le `consommer` aussi — donc tout se
// vérifie sans base ni réseau.

import { describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { creerFournisseurOAuth, ErreurOAuth, type Consommer } from "../lib/mcp/oauth";
import { fenetreDe, PLAFOND_ECHECS } from "../lib/mcp/oauthPlafond";

const CLE_SIGNATURE = "a".repeat(48);
const CLE_ACCES = "cle-d-acces-de-marc-assez-longue";
const ISSUER = "https://batchchef.hubperso.com";

/** Un `consommer` en mémoire : suffisant pour un test, jamais pour la production. */
function consommeurDeTest(): Consommer {
  const vus = new Set<string>();
  return async (jti) => {
    if (vus.has(jti)) return false;
    vus.add(jti);
    return true;
  };
}

function fournisseur(now?: () => number) {
  return creerFournisseurOAuth({
    cleSignature: CLE_SIGNATURE,
    cleAcces: CLE_ACCES,
    issuer: ISSUER,
    ...(now ? { now } : {}),
  });
}

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "verificateur-pkce-suffisamment-long-1234567890";
const DEFI = createHash("sha256").update(VERIFIER, "utf8").digest("base64url");

/** Le parcours complet, tel que Claude l'exécute. */
async function parcoursComplet(f = fournisseur(), consommer = consommeurDeTest()) {
  const client = f.enregistrerClient([REDIRECT]);
  const code = f.autoriser({
    clientId: client.client_id,
    redirectUri: REDIRECT,
    codeChallenge: DEFI,
    cleFournie: CLE_ACCES,
  });
  const jetons = await f.echangerCode(
    {
      code,
      clientId: client.client_id,
      clientSecret: client.client_secret,
      redirectUri: REDIRECT,
      codeVerifier: VERIFIER,
    },
    consommer,
  );
  return { f, client, code, jetons, consommer };
}

describe("configuration", () => {
  it("refuse de démarrer avec une clé de signature trop courte", () => {
    expect(() =>
      creerFournisseurOAuth({ cleSignature: "court", cleAcces: CLE_ACCES, issuer: ISSUER }),
    ).toThrow(/32 caractères/);
  });

  it("refuse une clé d'accès trop courte — c'est la seule porte devinable", () => {
    expect(() =>
      creerFournisseurOAuth({ cleSignature: CLE_SIGNATURE, cleAcces: "trop-court", issuer: ISSUER }),
    ).toThrow(/16 caractères/);
  });
});

describe("documents de découverte", () => {
  it("le serveur d'autorisation annonce PKCE S256 et les deux grants", () => {
    const m = fournisseur().metadonneesServeur();
    expect(m.issuer).toBe(ISSUER);
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(m.authorization_endpoint).toBe(`${ISSUER}/api/mcp/oauth/authorize`);
    expect(m.token_endpoint).toBe(`${ISSUER}/api/mcp/oauth/token`);
    expect(m.registration_endpoint).toBe(`${ISSUER}/api/mcp/oauth/register`);
  });

  it("la ressource protégée pointe /api/mcp et son serveur d'autorisation", () => {
    const m = fournisseur().metadonneesRessource();
    expect(m.resource).toBe(`${ISSUER}/api/mcp`);
    expect(m.authorization_servers).toEqual([ISSUER]);
  });

  it("l'URL de découverte est celle que le 401 devra citer", () => {
    expect(fournisseur().urlMetadonneesRessource()).toBe(
      `${ISSUER}/.well-known/oauth-protected-resource`,
    );
  });
});

describe("allowlist de redirection", () => {
  const f = fournisseur();
  const admise = (uri: string): boolean => {
    try {
      f.enregistrerClient([uri]);
      return true;
    } catch {
      return false;
    }
  };

  it("accepte claude.ai, claude.com et la boucle locale", () => {
    expect(admise("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(admise("https://claude.com/x")).toBe(true);
    expect(admise("http://127.0.0.1:6274/callback")).toBe(true);
    expect(admise("http://localhost:1234/cb")).toBe(true);
  });

  it("REFUSE un domaine qui COMMENCE par une origine admise", () => {
    // Le cas qui coûte l'accès : `https://claude.ai@evil.com` a pour host `evil.com`, et
    // `https://claude.ai.evil.com` commence bien par `https://claude.ai`. Un `startsWith`
    // livrerait le code d'autorisation à l'attaquant.
    expect(admise("https://claude.ai@evil.com/cb")).toBe(false);
    expect(admise("https://claude.ai.evil.com/cb")).toBe(false);
    expect(admise("https://evil.com/?x=https://claude.ai")).toBe(false);
  });

  it("refuse le http nu vers une origine publique, et ce qui n'est pas une URL", () => {
    expect(admise("http://claude.ai/cb")).toBe(false);
    expect(admise("pas-une-url")).toBe(false);
    expect(admise("")).toBe(false);
  });

  it("refuse une liste vide (aucun redirect_uri)", () => {
    expect(() => f.enregistrerClient([])).toThrow(ErreurOAuth);
  });

  it("refuse la redirection À L'AUTORISATION aussi, pas seulement à l'enregistrement", () => {
    // Ceinture ET bretelles : le garde ne doit pas dépendre de la discipline de l'appelant.
    expect(() =>
      f.autoriser({
        clientId: "x",
        redirectUri: "https://evil.com/cb",
        codeChallenge: DEFI,
        cleFournie: CLE_ACCES,
      }),
    ).toThrow(/allowlist/);
  });
});

describe("validation de la demande d'autorisation", () => {
  const f = fournisseur();
  const base = {
    response_type: "code",
    client_id: "abc",
    redirect_uri: REDIRECT,
    code_challenge: DEFI,
    code_challenge_method: "S256",
  };

  it("accepte une demande conforme", () => {
    expect(() => f.validerDemandeAutorisation(base)).not.toThrow();
  });

  it("exige PKCE S256 — pas de `plain`, pas d'absence", () => {
    expect(() => f.validerDemandeAutorisation({ ...base, code_challenge_method: "plain" })).toThrow(/PKCE/);
    expect(() => f.validerDemandeAutorisation({ ...base, code_challenge: undefined })).toThrow(/PKCE/);
  });

  it("exige response_type=code et un client_id", () => {
    expect(() => f.validerDemandeAutorisation({ ...base, response_type: "token" })).toThrow();
    expect(() => f.validerDemandeAutorisation({ ...base, client_id: undefined })).toThrow(/client_id/);
  });
});

describe("clé d'accès", () => {
  it("une clé fausse est refusée en 403", () => {
    try {
      fournisseur().autoriser({
        clientId: "x",
        redirectUri: REDIRECT,
        codeChallenge: DEFI,
        cleFournie: "mauvaise-cle-mais-assez-longue",
      });
      throw new Error("aurait dû échouer");
    } catch (err) {
      expect(err).toBeInstanceOf(ErreurOAuth);
      expect((err as ErreurOAuth).status).toBe(403);
      expect((err as ErreurOAuth).code).toBe("access_denied");
    }
  });
});

describe("parcours complet", () => {
  it("enregistrement → autorisation → jetons, et le jeton d'accès est accepté", async () => {
    const { f, jetons } = await parcoursComplet();
    expect(jetons.token_type).toBe("Bearer");
    expect(jetons.expires_in).toBe(3600);
    expect(() => f.verifierJetonAcces(`Bearer ${jetons.access_token}`)).not.toThrow();
  });

  it("le scheme Bearer est insensible à la casse (RFC 7235)", async () => {
    const { f, jetons } = await parcoursComplet();
    expect(() => f.verifierJetonAcces(`bearer ${jetons.access_token}`)).not.toThrow();
  });

  it("un en-tête absent ou malformé est refusé en 401", () => {
    const f = fournisseur();
    for (const entete of [undefined, "", "Basic abc", "Bearer", "Bearer "]) {
      expect(() => f.verifierJetonAcces(entete), String(entete)).toThrow(ErreurOAuth);
    }
  });
});

describe("échange de code — ce qui doit échouer", () => {
  it("un code ne sert QU'UNE fois", async () => {
    const { f, client, code, consommer } = await parcoursComplet();
    await expect(
      f.echangerCode(
        { code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER },
        consommer,
      ),
    ).rejects.toThrow(/déjà utilisé/);
  });

  it("un mauvais code_verifier échoue la vérification PKCE", async () => {
    const f = fournisseur();
    const client = f.enregistrerClient([REDIRECT]);
    const code = f.autoriser({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: DEFI,
      cleFournie: CLE_ACCES,
    });
    await expect(
      f.echangerCode(
        { code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: "mauvais" },
        consommeurDeTest(),
      ),
    ).rejects.toThrow(/PKCE/);
  });

  it("un redirect_uri différent de celui du code est refusé", async () => {
    const f = fournisseur();
    const client = f.enregistrerClient([REDIRECT]);
    const code = f.autoriser({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: DEFI,
      cleFournie: CLE_ACCES,
    });
    await expect(
      f.echangerCode(
        {
          code,
          clientId: client.client_id,
          redirectUri: "https://claude.ai/autre",
          codeVerifier: VERIFIER,
        },
        consommeurDeTest(),
      ),
    ).rejects.toThrow(/redirect_uri/);
  });

  it("un code émis pour un autre client est refusé", async () => {
    const f = fournisseur();
    const code = f.autoriser({
      clientId: "client-a",
      redirectUri: REDIRECT,
      codeChallenge: DEFI,
      cleFournie: CLE_ACCES,
    });
    await expect(
      f.echangerCode(
        { code, clientId: "client-b", redirectUri: REDIRECT, codeVerifier: VERIFIER },
        consommeurDeTest(),
      ),
    ).rejects.toThrow(/autre client/);
  });

  it("un client_secret faux est refusé en 401", async () => {
    const f = fournisseur();
    const client = f.enregistrerClient([REDIRECT]);
    const code = f.autoriser({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: DEFI,
      cleFournie: CLE_ACCES,
    });
    await expect(
      f.echangerCode(
        {
          code,
          clientId: client.client_id,
          clientSecret: "faux",
          redirectUri: REDIRECT,
          codeVerifier: VERIFIER,
        },
        consommeurDeTest(),
      ),
    ).rejects.toThrow(/client_secret/);
  });

  it("un CODE ne peut pas servir de jeton d'accès", async () => {
    // Le type est DANS la charge signée : sans lui, un code d'autorisation — qui transite
    // en clair dans une URL de redirection — ouvrirait /api/mcp.
    const f = fournisseur();
    const code = f.autoriser({
      clientId: "x",
      redirectUri: REDIRECT,
      codeChallenge: DEFI,
      cleFournie: CLE_ACCES,
    });
    expect(() => f.verifierJetonAcces(`Bearer ${code}`)).toThrow(/type code/);
  });

  it("un jeton signé par une AUTRE clé est refusé", async () => {
    const { jetons } = await parcoursComplet();
    const autre = creerFournisseurOAuth({
      cleSignature: "b".repeat(48),
      cleAcces: CLE_ACCES,
      issuer: ISSUER,
    });
    expect(() => autre.verifierJetonAcces(`Bearer ${jetons.access_token}`)).toThrow(/Signature/);
  });

  it("une charge modifiée invalide la signature", async () => {
    const { f, jetons } = await parcoursComplet();
    const [prefixe, corps, sig] = jetons.access_token.split(".");
    const altere = Buffer.from(
      JSON.stringify({ t: "acces", cid: "moi", exp: Date.now() + 9e6, jti: randomUUID() }),
      "utf8",
    ).toString("base64url");
    expect(corps).not.toBe(altere);
    expect(() => f.verifierJetonAcces(`Bearer ${prefixe}.${altere}.${sig}`)).toThrow(/Signature/);
  });
});

describe("expiration", () => {
  it("un jeton d'accès expire au bout d'une heure", async () => {
    let t = 1_000_000;
    const f = fournisseur(() => t);
    const { jetons } = await parcoursComplet(f);
    t += 3600_000 - 1;
    expect(() => f.verifierJetonAcces(`Bearer ${jetons.access_token}`)).not.toThrow();
    t += 2;
    expect(() => f.verifierJetonAcces(`Bearer ${jetons.access_token}`)).toThrow(/expiré/);
  });

  it("un code expire au bout de dix minutes", async () => {
    let t = 1_000_000;
    const f = fournisseur(() => t);
    const code = f.autoriser({
      clientId: "x",
      redirectUri: REDIRECT,
      codeChallenge: DEFI,
      cleFournie: CLE_ACCES,
    });
    t += 600_000 + 1;
    await expect(
      f.echangerCode(
        { code, clientId: "x", redirectUri: REDIRECT, codeVerifier: VERIFIER },
        consommeurDeTest(),
      ),
    ).rejects.toThrow(/expiré/);
  });
});

describe("rafraîchissement", () => {
  it("rend un nouveau jeu, et l'ancien refresh est INVALIDÉ (rotation OAuth 2.1)", async () => {
    const { f, client, jetons, consommer } = await parcoursComplet();
    const neufs = await f.rafraichir(
      { refreshToken: jetons.refresh_token, clientId: client.client_id },
      consommer,
    );
    expect(neufs.access_token).not.toBe(jetons.access_token);
    expect(() => f.verifierJetonAcces(`Bearer ${neufs.access_token}`)).not.toThrow();
    await expect(
      f.rafraichir({ refreshToken: jetons.refresh_token, clientId: client.client_id }, consommer),
    ).rejects.toThrow(/déjà utilisé/);
  });

  it("un jeton d'ACCÈS ne peut pas servir de jeton de rafraîchissement", async () => {
    const { f, client, jetons, consommer } = await parcoursComplet();
    await expect(
      f.rafraichir({ refreshToken: jetons.access_token, clientId: client.client_id }, consommer),
    ).rejects.toThrow(/type acces/);
  });
});

describe("plafond de tentatives", () => {
  it("la fenêtre est horaire, et dérive de l'instant passé (jamais de l'horloge)", () => {
    expect(fenetreDe(new Date("2026-08-19T16:42:00Z"))).toBe("2026-08-19T16");
    expect(fenetreDe(new Date("2026-08-19T16:59:59Z"))).toBe("2026-08-19T16");
    expect(fenetreDe(new Date("2026-08-19T17:00:00Z"))).not.toBe("2026-08-19T16");
  });

  it("le plafond est un nombre utilisable, pas zéro ni l'infini", () => {
    expect(PLAFOND_ECHECS).toBeGreaterThan(0);
    expect(PLAFOND_ECHECS).toBeLessThan(100);
  });
});
