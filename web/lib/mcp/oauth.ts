// Mini serveur OAuth 2.1 MONO-UTILISATEUR pour brancher le MCP à claude.ai.
//
// POURQUOI, puisque /api/mcp accepte déjà un jeton porteur : l'interface « Add custom
// connector » de claude.ai ne prend QU'UNE URL — aucun champ pour un en-tête. Un serveur
// gardé par un `Authorization` statique y répond 401 sans rien à découvrir, et le
// connecteur échoue sans dire pourquoi. Vérifié le 19/08/2026 en lisant le serveur MCP de
// FinanceAI, qui a rencontré exactement ce mur (son ADR le date du 13/07) et l'a résolu par
// un OAuth 2.1 mono-utilisateur. Ce module en est l'adaptation.
//
// Claude Code, lui, sait poser un en-tête : le jeton direct reste accepté et reste le chemin
// le plus simple. Les deux portes mènent à la même maison.
//
// CONCEPTION SANS ÉTAT — obligatoire en serverless (chaque requête est un processus neuf) :
//   - jetons et codes = charge JSON signée HMAC-SHA256 → n'importe quelle instance vérifie ;
//   - enregistrement dynamique de client SANS base : client_secret = HMAC(client_id) ;
//   - la VRAIE porte est la clé d'accès de Marc (`MCP_TOKEN`), saisie UNE fois sur la page
//     de consentement, comparée en temps constant.
//
// ⚠️ L'usage unique des codes est la SEULE chose qui ne peut pas être sans état. FinanceAI
// le tient en mémoire, ce qui suffit sur une instance Cloud Run chaude ; ici ça ne
// protégerait rien — Vercel démarre des instances à froid et en parallèle, donc un code
// rejoué tomberait presque toujours sur une mémoire vierge. Le `consume` est donc INJECTÉ
// (la base le porte, cf. `lib/mcp/oauthStore.ts`) et ce module reste pur.
//
// Module PUR : aucun réseau, aucune base, aucune horloge implicite (`now` injectable).

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/** Origines EXACTES admises en redirection. Comparaison sur `URL.origin`, jamais un préfixe. */
const ORIGINES_ADMISES = ["https://claude.ai", "https://claude.com"];
const BOUCLE_LOCALE = new Set(["127.0.0.1", "localhost", "::1"]);

const TTL_ACCES_MS = 60 * 60 * 1000; // 1 h
const TTL_RAFRAICHISSEMENT_MS = 30 * 24 * 60 * 60 * 1000; // 30 j
const TTL_CODE_MS = 10 * 60 * 1000; // 10 min

/** Longueur minimale de la clé d'accès. En dessous, elle se devine : l'OAuth refuse de démarrer. */
export const LONGUEUR_MIN_CLE = 16;

export interface ConfigOAuth {
  /** Clé HMAC de signature (≥ 32 caractères). */
  cleSignature: string;
  /** Clé d'accès de Marc — ce qu'il tape sur la page de consentement (`MCP_TOKEN`). */
  cleAcces: string;
  /** URL publique de base, ex. https://batchchef.hubperso.com */
  issuer: string;
  origines?: string[];
  now?: () => number;
}

type TypeJeton = "acces" | "rafraichissement" | "code";

interface Charge {
  t: TypeJeton;
  cid: string; // client_id
  exp: number; // epoch ms
  ru?: string; // redirect_uri (codes seulement)
  cc?: string; // code_challenge S256 (codes seulement)
  jti: string;
}

export interface JeuDeJetons {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
}

export class ErreurOAuth extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "ErreurOAuth";
  }
}

/** Marque un `jti` comme consommé. Rend `false` s'il l'était DÉJÀ (rejeu). */
export type Consommer = (jti: string, expireA: number) => Promise<boolean>;

const b64 = (b: Buffer): string => b.toString("base64url");
const deB64 = (s: string): Buffer => Buffer.from(s, "base64url");

export function creerFournisseurOAuth(config: ConfigOAuth) {
  if (config.cleSignature.length < 32) {
    throw new Error("Clé de signature OAuth : 32 caractères minimum.");
  }
  if (config.cleAcces.length < LONGUEUR_MIN_CLE) {
    throw new Error(`MCP_TOKEN : ${LONGUEUR_MIN_CLE} caractères minimum pour servir de clé d'accès OAuth.`);
  }
  const now = config.now ?? (() => Date.now());
  const origines = config.origines ?? ORIGINES_ADMISES;

  const hmac = (data: string): Buffer =>
    createHmac("sha256", config.cleSignature).update(data).digest();

  const signer = (charge: Charge): string => {
    const corps = b64(Buffer.from(JSON.stringify(charge), "utf8"));
    return `bc1.${corps}.${b64(hmac(corps))}`;
  };

  /** Vérifie signature, TYPE et expiration. Le type interdit qu'un code serve de jeton d'accès. */
  const verifier = (jeton: string, type: TypeJeton): Charge => {
    const p = jeton.split(".");
    if (p.length !== 3 || p[0] !== "bc1" || !p[1] || !p[2]) {
      throw new ErreurOAuth("invalid_token", "Format de jeton invalide.", 401);
    }
    const attendu = hmac(p[1]);
    const fourni = deB64(p[2]);
    if (fourni.length !== attendu.length || !timingSafeEqual(fourni, attendu)) {
      throw new ErreurOAuth("invalid_token", "Signature de jeton invalide.", 401);
    }
    let charge: Charge;
    try {
      charge = JSON.parse(deB64(p[1]).toString("utf8")) as Charge;
    } catch {
      throw new ErreurOAuth("invalid_token", "Charge de jeton illisible.", 401);
    }
    if (charge.t !== type) {
      throw new ErreurOAuth("invalid_token", `Jeton de type ${charge.t} là où ${type} est attendu.`, 401);
    }
    if (now() >= charge.exp) throw new ErreurOAuth("invalid_token", "Jeton expiré.", 401);
    return charge;
  };

  /** client_secret DÉRIVÉ : HMAC(client_id). Aucune base, vérifiable par toute instance. */
  const secretDuClient = (clientId: string): string => b64(hmac(`client:${clientId}`));

  const egalTempsConstant = (a: string, b: string): boolean => {
    const da = createHash("sha256").update(a, "utf8").digest();
    const db = createHash("sha256").update(b, "utf8").digest();
    return timingSafeEqual(da, db);
  };

  /**
   * ⚠️ Compare l'ORIGINE EXACTE, jamais un préfixe de chaîne, et rejette tout userinfo
   * embarqué : `https://claude.ai@evil.com` a pour host `evil.com` mais commence bien par
   * `https://claude.ai`. Un `startsWith` ici livrerait le code d'autorisation à l'attaquant.
   */
  const redirectionAdmise = (uri: string): boolean => {
    let u: URL;
    try {
      u = new URL(uri);
    } catch {
      return false;
    }
    if (u.username !== "" || u.password !== "") return false;
    if (BOUCLE_LOCALE.has(u.hostname) && (u.protocol === "http:" || u.protocol === "https:")) return true;
    return origines.includes(u.origin);
  };

  const emettre = (clientId: string): JeuDeJetons => ({
    access_token: signer({ t: "acces", cid: clientId, exp: now() + TTL_ACCES_MS, jti: randomUUID() }),
    token_type: "Bearer",
    expires_in: Math.floor(TTL_ACCES_MS / 1000),
    refresh_token: signer({
      t: "rafraichissement",
      cid: clientId,
      exp: now() + TTL_RAFRAICHISSEMENT_MS,
      jti: randomUUID(),
    }),
  });

  return {
    /** RFC 8414 — métadonnées du serveur d'autorisation. */
    metadonneesServeur: () => ({
      issuer: config.issuer,
      authorization_endpoint: `${config.issuer}/api/mcp/oauth/authorize`,
      token_endpoint: `${config.issuer}/api/mcp/oauth/token`,
      registration_endpoint: `${config.issuer}/api/mcp/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
      scopes_supported: ["batchchef"],
    }),

    /** RFC 9728 — métadonnées de la ressource protégée (ce que le 401 fait découvrir). */
    metadonneesRessource: () => ({
      resource: `${config.issuer}/api/mcp`,
      authorization_servers: [config.issuer],
      bearer_methods_supported: ["header"],
    }),

    urlMetadonneesRessource: () => `${config.issuer}/.well-known/oauth-protected-resource`,

    /** RFC 7591 — enregistrement dynamique, SANS stockage (le secret est dérivé de l'id). */
    enregistrerClient: (redirectUris: string[]) => {
      if (!redirectUris.length || !redirectUris.every(redirectionAdmise)) {
        throw new ErreurOAuth(
          "invalid_redirect_uri",
          `redirect_uris hors allowlist (origines admises : ${origines.join(", ")}, ou boucle locale).`,
        );
      }
      const clientId = randomUUID();
      return {
        client_id: clientId,
        client_secret: secretDuClient(clientId),
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code", "refresh_token"],
      };
    },

    /** Validation des paramètres AVANT d'afficher le formulaire de consentement. */
    validerDemandeAutorisation: (q: {
      response_type?: string;
      client_id?: string;
      redirect_uri?: string;
      code_challenge?: string;
      code_challenge_method?: string;
    }): void => {
      if (q.response_type !== "code") {
        throw new ErreurOAuth("unsupported_response_type", "response_type=code requis (OAuth 2.1).");
      }
      if (!q.client_id) throw new ErreurOAuth("invalid_request", "client_id manquant.");
      if (!q.redirect_uri || !redirectionAdmise(q.redirect_uri)) {
        throw new ErreurOAuth("invalid_request", "redirect_uri manquant ou hors allowlist.");
      }
      if (!q.code_challenge || q.code_challenge_method !== "S256") {
        throw new ErreurOAuth(
          "invalid_request",
          "PKCE S256 obligatoire (code_challenge + code_challenge_method=S256).",
        );
      }
    },

    /** Après saisie de la clé : émet le code, LIÉ au client, au redirect_uri et au PKCE. */
    autoriser: (p: {
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      cleFournie: string;
    }): string => {
      // Ceinture et bretelles : on re-vérifie l'allowlist ici, sans dépendre de la
      // discipline de l'appelant. Un « JAMAIS » promis par un plan doit avoir une ligne
      // qui le re-vérifie juste avant l'écriture.
      if (!redirectionAdmise(p.redirectUri)) {
        throw new ErreurOAuth("invalid_request", "redirect_uri hors allowlist.");
      }
      if (!egalTempsConstant(p.cleFournie, config.cleAcces)) {
        throw new ErreurOAuth("access_denied", "Clé d'accès invalide.", 403);
      }
      return signer({
        t: "code",
        cid: p.clientId,
        exp: now() + TTL_CODE_MS,
        ru: p.redirectUri,
        cc: p.codeChallenge,
        jti: randomUUID(),
      });
    },

    /** grant_type=authorization_code — code + PKCE + client, puis émission. */
    echangerCode: async (
      p: { code: string; clientId: string; clientSecret?: string; redirectUri: string; codeVerifier: string },
      consommer: Consommer,
    ): Promise<JeuDeJetons> => {
      const charge = verifier(p.code, "code");
      // OAuth 2.1 : un code est à USAGE UNIQUE.
      if (!(await consommer(charge.jti, charge.exp))) {
        throw new ErreurOAuth("invalid_grant", "Code déjà utilisé.");
      }
      if (charge.cid !== p.clientId) throw new ErreurOAuth("invalid_grant", "Code émis pour un autre client.");
      if (charge.ru !== p.redirectUri) {
        throw new ErreurOAuth("invalid_grant", "redirect_uri différent de celui du code.");
      }
      if (p.clientSecret != null && !egalTempsConstant(p.clientSecret, secretDuClient(p.clientId))) {
        throw new ErreurOAuth("invalid_client", "client_secret invalide.", 401);
      }
      const defi = b64(createHash("sha256").update(p.codeVerifier, "utf8").digest());
      if (defi !== charge.cc) throw new ErreurOAuth("invalid_grant", "Vérification PKCE échouée.");
      return emettre(p.clientId);
    },

    /** grant_type=refresh_token — avec ROTATION (l'ancien est invalidé). */
    rafraichir: async (
      p: { refreshToken: string; clientId: string; clientSecret?: string },
      consommer: Consommer,
    ): Promise<JeuDeJetons> => {
      const charge = verifier(p.refreshToken, "rafraichissement");
      if (charge.cid !== p.clientId) {
        throw new ErreurOAuth("invalid_grant", "Jeton de rafraîchissement émis pour un autre client.");
      }
      if (p.clientSecret != null && !egalTempsConstant(p.clientSecret, secretDuClient(p.clientId))) {
        throw new ErreurOAuth("invalid_client", "client_secret invalide.", 401);
      }
      if (!(await consommer(charge.jti, charge.exp))) {
        throw new ErreurOAuth("invalid_grant", "Jeton de rafraîchissement déjà utilisé (rotation).");
      }
      return emettre(charge.cid);
    },

    /** Garde de /api/mcp : jette une ErreurOAuth(401) si le Bearer est absent ou invalide. */
    verifierJetonAcces: (entete: string | undefined): void => {
      // Scheme insensible à la casse (RFC 7235).
      const m = entete?.match(/^Bearer\s+(.+)$/i);
      if (!m?.[1]) throw new ErreurOAuth("invalid_token", "Jeton Bearer requis.", 401);
      verifier(m[1].trim(), "acces");
    },
  };
}

export type FournisseurOAuth = ReturnType<typeof creerFournisseurOAuth>;
