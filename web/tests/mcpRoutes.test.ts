// Routes MCP et OAuth : réponses HTTP attendues, sans base ni réseau.
// Les effets de bord (jti consommés, plafond de tentatives, outils) sont remplacés par des
// versions en mémoire : on éprouve la ROUTE, pas la base. Aucune donnée métier.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const consommes = new Set<string>();
const etat = { echecs: 0, baseEnPanne: false };

vi.mock("@/lib/mcp/oauthStore", () => ({
  consommerJti: async (jti: string) => {
    if (consommes.has(jti)) return false;
    consommes.add(jti);
    return true;
  },
  purgerJtiExpires: async () => undefined,
}));

vi.mock("@/lib/mcp/oauthPlafond", () => ({
  PLAFOND_ECHECS: 3,
  porteFermee: async () => {
    if (etat.baseEnPanne) throw new Error("base indisponible");
    return etat.echecs >= 3;
  },
  noterEchec: async () => {
    etat.echecs += 1;
  },
}));

vi.mock("@/lib/mcp/outils", () => ({
  executerOutilMcp: vi.fn(async (nom: string) => ({
    content: [{ type: "text", text: `ok:${nom}` }],
  })),
}));

const CLE = "cle-d-acces-de-test-0123456789";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function pkce(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function postJson(url: string, corps: unknown, entetes: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...entetes },
    body: JSON.stringify(corps),
  });
}

function postForm(url: string, champs: Record<string, string>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(champs).toString(),
  });
}

beforeEach(() => {
  consommes.clear();
  etat.echecs = 0;
  etat.baseEnPanne = false;
  vi.stubEnv("MCP_TOKEN", CLE);
  vi.stubEnv("MCP_OAUTH_SIGNING_KEY", "");
  vi.stubEnv("BATCHCHEF_PUBLIC_URL", "https://batchchef.exemple.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/mcp", () => {
  const appel = async (req: Request) => (await import("../app/api/mcp/route")).POST(req);
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

  it("MCP_TOKEN absent → 503 (jamais ouvert par défaut)", async () => {
    vi.stubEnv("MCP_TOKEN", "");
    const r = await appel(postJson("http://x/api/mcp", ping, { authorization: `Bearer ${CLE}` }));
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toContain("no-store");
  });

  it("sans jeton → 401, avec le pointeur de découverte OAuth", async () => {
    const r = await appel(postJson("http://x/api/mcp", ping));
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("jeton faux → 401", async () => {
    const r = await appel(postJson("http://x/api/mcp", ping, { authorization: "Bearer faux" }));
    expect(r.status).toBe(401);
  });

  it("jeton direct valide → 200 ; l'en-tête de repli x-mcp-token marche aussi", async () => {
    const a = await appel(postJson("http://x/api/mcp", ping, { authorization: `Bearer ${CLE}` }));
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    const b = await appel(postJson("http://x/api/mcp", ping, { "x-mcp-token": CLE }));
    expect(b.status).toBe(200);
  });

  it("un jeton d'accès OAuth signé est accepté, un code d'autorisation ne l'est pas", async () => {
    const { etatOAuth } = await import("../lib/mcp/oauthConfig");
    const f = etatOAuth().fournisseur!;
    const client = f.enregistrerClient([REDIRECT]);
    const verifier = "v".repeat(50);
    const code = f.autoriser({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: pkce(verifier),
      cleFournie: CLE,
    });
    const ok = await appel(postJson("http://x/api/mcp", ping, { authorization: `Bearer ${code}` }));
    expect(ok.status).toBe(401);
    const jetons = await f.echangerCode(
      {
        code,
        clientId: client.client_id,
        clientSecret: client.client_secret,
        redirectUri: REDIRECT,
        codeVerifier: verifier,
      },
      async () => true,
    );
    const r = await appel(
      postJson("http://x/api/mcp", ping, { authorization: `Bearer ${jetons.access_token}` }),
    );
    expect(r.status).toBe(200);
  });

  it("GET → 405", async () => {
    const { GET } = await import("../app/api/mcp/route");
    expect(GET().status).toBe(405);
  });

  it("corps illisible → erreur JSON-RPC de parsing, pas un crash", async () => {
    const req = new Request("http://x/api/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${CLE}` },
      body: "{pas du json",
    });
    const r = await appel(req);
    const corps = await r.json();
    expect(corps.error.code).toBe(-32700);
  });

  it("requête invalide, méthode inconnue, notification, lot, tools/list et tools/call", async () => {
    const h = { authorization: `Bearer ${CLE}` };
    const invalide = await (await appel(postJson("http://x/api/mcp", { foo: 1 }, h))).json();
    expect(invalide.error.code).toBe(-32600);

    const inconnue = await (
      await appel(postJson("http://x/api/mcp", { jsonrpc: "2.0", id: 2, method: "n/existe/pas" }, h))
    ).json();
    expect(inconnue.error.code).toBe(-32601);

    const notif = await appel(
      postJson("http://x/api/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }, h),
    );
    expect(notif.status).toBe(204);

    const lotVide = await appel(
      postJson("http://x/api/mcp", [{ jsonrpc: "2.0", method: "notifications/initialized" }], h),
    );
    expect(lotVide.status).toBe(204);

    const lot = await (
      await appel(
        postJson("http://x/api/mcp", [ping, { jsonrpc: "2.0", id: 3, method: "initialize", params: {} }], h),
      )
    ).json();
    expect(lot).toHaveLength(2);
    expect(lot[1].result.serverInfo.name).toBe("batchchef");

    const liste = await (
      await appel(postJson("http://x/api/mcp", { jsonrpc: "2.0", id: 4, method: "tools/list" }, h))
    ).json();
    expect(liste.result.tools.length).toBeGreaterThan(0);

    const sansNom = await (
      await appel(
        postJson("http://x/api/mcp", { jsonrpc: "2.0", id: 5, method: "tools/call", params: {} }, h),
      )
    ).json();
    expect(sansNom.error.code).toBe(-32602);

    const appelOutil = await (
      await appel(
        postJson(
          "http://x/api/mcp",
          { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "batchchef_lister_batchs" } },
          h,
        ),
      )
    ).json();
    expect(appelOutil.result.content[0].text).toBe("ok:batchchef_lister_batchs");
  });
});

describe("POST /api/mcp/oauth/token", () => {
  const token = async (champs: Record<string, string>) =>
    (await import("../app/api/mcp/oauth/token/route")).POST(postForm("http://x/t", champs));

  async function nouveauCode(verifier = "v".repeat(50)) {
    const { etatOAuth } = await import("../lib/mcp/oauthConfig");
    const f = etatOAuth().fournisseur!;
    const client = f.enregistrerClient([REDIRECT]);
    const code = f.autoriser({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: pkce(verifier),
      cleFournie: CLE,
    });
    return { client, code, verifier };
  }

  it("MCP_TOKEN absent → 503", async () => {
    vi.stubEnv("MCP_TOKEN", "");
    const r = await token({ grant_type: "authorization_code", client_id: "x" });
    expect(r.status).toBe(503);
  });

  it("corps non form-urlencoded → 400", async () => {
    const { POST } = await import("../app/api/mcp/oauth/token/route");
    const r = await POST(
      new Request("http://x/t", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "bonjour",
      }),
    );
    expect(r.status).toBe(400);
  });

  it("client_id manquant, grant inconnu, paramètres manquants → refus explicites", async () => {
    expect((await token({ grant_type: "authorization_code" })).status).toBe(400);
    const inconnu = await token({ grant_type: "password", client_id: "c" });
    expect((await inconnu.json()).error).toBe("unsupported_grant_type");
    const manque = await token({ grant_type: "authorization_code", client_id: "c" });
    expect((await manque.json()).error).toBe("invalid_request");
    const sansRefresh = await token({ grant_type: "refresh_token", client_id: "c" });
    expect(sansRefresh.status).toBe(400);
  });

  it("échange valide, puis le MÊME code est refusé (usage unique en base)", async () => {
    const { client, code, verifier } = await nouveauCode();
    const champs = {
      grant_type: "authorization_code",
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    };
    const ok = await token(champs);
    expect(ok.status).toBe(200);
    const jetons = await ok.json();
    expect(jetons.token_type).toBe("Bearer");
    expect(ok.headers.get("cache-control")).toBe("no-store");

    const rejeu = await token(champs);
    expect(rejeu.status).toBe(400);
    expect((await rejeu.json()).error).toBe("invalid_grant");
  });

  it("mauvais PKCE et redirect_uri différent → invalid_grant", async () => {
    const a = await nouveauCode();
    const pkceFaux = await token({
      grant_type: "authorization_code",
      client_id: a.client.client_id,
      code: a.code,
      redirect_uri: REDIRECT,
      code_verifier: "w".repeat(50),
    });
    expect((await pkceFaux.json()).error).toBe("invalid_grant");

    const b = await nouveauCode();
    const autreUri = await token({
      grant_type: "authorization_code",
      client_id: b.client.client_id,
      code: b.code,
      redirect_uri: "https://claude.com/autre",
      code_verifier: b.verifier,
    });
    expect((await autreUri.json()).error).toBe("invalid_grant");
  });

  it("refresh_token : rotation, l'ancien refresh est refusé au second usage", async () => {
    const { client, code, verifier } = await nouveauCode();
    const premier = await (
      await token({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      })
    ).json();
    const champs = {
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: premier.refresh_token,
    };
    const suite = await token(champs);
    expect(suite.status).toBe(200);
    const rejeu = await token(champs);
    expect(rejeu.status).toBe(400);
    expect((await rejeu.json()).error).toBe("invalid_grant");
  });
});

describe("/api/mcp/oauth/authorize", () => {
  const params = (extra: Record<string, string> = {}) => ({
    response_type: "code",
    client_id: "client-de-test",
    redirect_uri: REDIRECT,
    code_challenge: pkce("v".repeat(50)),
    code_challenge_method: "S256",
    state: "etat-1",
    ...extra,
  });
  const get = async (p: Record<string, string>) =>
    (await import("../app/api/mcp/oauth/authorize/route")).GET(
      new Request(`http://x/a?${new URLSearchParams(p).toString()}`),
    );
  const post = async (p: Record<string, string>) =>
    (await import("../app/api/mcp/oauth/authorize/route")).POST(postForm("http://x/a", p));

  it("GET : affiche le formulaire, et échappe les valeurs hostiles", async () => {
    const r = await get(params({ state: '"><script>alert(1)</script>' }));
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Autoriser");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("GET : redirect_uri hors allowlist, PKCE absent → 400, rien d'affiché", async () => {
    const hors = await get(params({ redirect_uri: "https://claude.ai@evil.example/cb" }));
    expect(hors.status).toBe(400);
    const sansPkce = await get(params({ code_challenge_method: "plain" }));
    expect(sansPkce.status).toBe(400);
  });

  it("POST avec la bonne clé → 302 vers la redirection EXACTE, code et state posés", async () => {
    const r = await post({ ...params(), cle: CLE });
    expect(r.status).toBe(302);
    const cible = new URL(r.headers.get("location")!);
    expect(cible.origin + cible.pathname).toBe(REDIRECT);
    expect(cible.searchParams.get("code")).toMatch(/^bc1\./);
    expect(cible.searchParams.get("state")).toBe("etat-1");
  });

  it("POST : redirect_uri hors allowlist → aucune redirection", async () => {
    const r = await post({ ...params({ redirect_uri: "https://claude.ai.evil.example/cb" }), cle: CLE });
    expect(r.status).toBe(400);
    expect(r.headers.get("location")).toBeNull();
  });

  it("POST avec une fausse clé → 403 et l'échec est compté", async () => {
    const r = await post({ ...params(), cle: "fausse" });
    expect(r.status).toBe(403);
    expect(etat.echecs).toBe(1);
  });

  it("plafond atteint → 429, même avec la BONNE clé", async () => {
    etat.echecs = 3;
    const r = await post({ ...params(), cle: CLE });
    expect(r.status).toBe(429);
    expect(r.headers.get("location")).toBeNull();
  });

  it("base du plafond en panne → 503, la porte reste FERMÉE", async () => {
    etat.baseEnPanne = true;
    const r = await post({ ...params(), cle: CLE });
    expect(r.status).toBe(503);
    expect(r.headers.get("location")).toBeNull();
  });

  it("MCP_TOKEN absent → 503", async () => {
    vi.stubEnv("MCP_TOKEN", "");
    expect((await get(params())).status).toBe(503);
    expect((await post({ ...params(), cle: CLE })).status).toBe(503);
  });
});

describe("/api/mcp/oauth/register", () => {
  const enregistrer = async (corps: unknown) =>
    (await import("../app/api/mcp/oauth/register/route")).POST(postJson("http://x/r", corps));

  it("accepte une redirection Claude, refuse le reste", async () => {
    const ok = await enregistrer({ redirect_uris: [REDIRECT] });
    expect(ok.status).toBe(201);
    expect((await ok.json()).client_secret).toBeTruthy();

    const mal = await enregistrer({ redirect_uris: ["https://evil.example/cb"] });
    expect(mal.status).toBe(400);
    const vide = await enregistrer({});
    expect(vide.status).toBe(400);
  });
});
