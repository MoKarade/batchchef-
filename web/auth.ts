// auth.ts — Auth.js (NextAuth v5), même pattern que le hub : un seul compte Google admis
// (AUTHORIZED_EMAIL), session JWT, secrets via l'environnement.
//
// En plus du login, on demande le scope Google Tasks (écriture) pour créer une liste de
// courses cochable dans Google Tasks. Le jeton d'accès Google est stocké dans le JWT
// (chiffré, httpOnly) et rafraîchi automatiquement ; il est lu UNIQUEMENT côté serveur
// (Server Actions) — jamais rendu au client (pas de SessionProvider portant le jeton).

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";
import { isAuthorizedEmail } from "@/lib/authorized";
import { cookiesSessionPartagee } from "@/lib/sessionPartagee";

export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

/** Rafraîchit le jeton d'accès Google via le refresh_token. Erreur → marque le token. */
async function refreshGoogleToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) throw new Error("pas de refresh_token");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      error?: string;
    };
    if (!res.ok || !data.access_token) throw new Error(data.error ?? `HTTP ${res.status}`);
    return {
      ...token,
      accessToken: data.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
      refreshToken: data.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: `openid email profile ${TASKS_SCOPE}`,
          access_type: "offline", // → refresh_token
          prompt: "consent", // consentement forcé une fois pour obtenir le refresh_token
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  // ── CONNEXION UNIQUE ENTRE LES APPS DU HUB ───────────────────────────────────────
  // Avec `AUTH_COOKIE_DOMAIN=.hubperso.com`, le cookie de session est déclaré sur le
  // domaine parent : le navigateur l'envoie à TOUS les sous-domaines. Combiné à un
  // `AUTH_SECRET` IDENTIQUE dans chaque app (le JWT est chiffré avec — sans le même
  // secret, l'app reçoit le cookie mais n'en tire rien), se connecter à une app vaut
  // pour toutes. Corollaire assumé : une DÉCONNEXION vaut aussi pour toutes.
  //
  // ⚠️ BatchChef est la seule app à ne PAS être encore sous `hubperso.com` : tant
  // qu'elle sert `batchchef-glu8-chi.vercel.app`, un cookie de domaine parent y serait
  // rejeté et la variable doit rester vide. C'est sans danger — variable non définie ⇒
  // comportement natif, cookie limité à l'hôte. Voir `lib/sessionPartagee.ts`.
  //
  // ⚠️ Le JWT de BatchChef porte, LUI, les jetons Google (accès + rafraîchissement,
  // scope Tasks). Les partager entre sous-domaines est le but recherché — c'est ce qui
  // évite un second consentement — mais ça élève l'enjeu du cookie : voir la
  // revérification d'adresse dans `jwt` plus bas.
  cookies: cookiesSessionPartagee(process.env.AUTH_COOKIE_DOMAIN),
  // Requis en local/self-hosted (sinon UntrustedHost) ; sans risque, les redirect URIs
  // sont verrouillés côté Google.
  trustHost: true,
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    signIn({ user }) {
      return isAuthorizedEmail(user?.email, process.env.AUTHORIZED_EMAIL);
    },
    async jwt({ token, account, user }) {
      // ⚠️ REVÉRIFICATION À CHAQUE LECTURE — c'est la contrepartie du cookie partagé.
      //
      // `signIn` ne tourne qu'à la CONNEXION. Le cookie devenant lisible par tous les
      // sous-domaines, BatchChef accepterait sans broncher une session fabriquée par
      // une autre app du hub. Aujourd'hui c'est cohérent — les apps partagent la même
      // AUTHORIZED_EMAIL — mais ça ne l'est que par coïncidence de configuration.
      //
      // L'enjeu est plus élevé ici qu'ailleurs : ce jeton porte l'accès Google Tasks
      // ET le refresh_token. Renvoyer `null` INVALIDE la session (Auth.js v5), donc
      // aucune Server Action ne peut lire le jeton. Ce contrôle vient AVANT tout le
      // reste : ne rafraîchissons pas un jeton pour une session qu'on va refuser.
      if (user?.email) token.email = user.email;
      if (!isAuthorizedEmail(token.email, process.env.AUTHORIZED_EMAIL)) return null;

      // Connexion initiale : on capture les jetons Google.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = typeof account.expires_at === "number" ? account.expires_at : undefined;
        token.scope = account.scope;
        token.error = undefined;
        return token;
      }
      // Jeton encore valide (marge 60 s) → on le garde.
      if (token.expiresAt && Date.now() < token.expiresAt * 1000 - 60_000) return token;
      // Expiré → rafraîchit (ou marque l'erreur si pas de refresh_token).
      return await refreshGoogleToken(token);
    },
    async session({ session, token }) {
      // Champs SERVER-SIDE ONLY (lus par les Server Actions via auth()). Le jeton Google
      // est celui de Marc, scoppé Tasks, court (~1 h) — jamais exposé à du JS client.
      session.accessToken = token.accessToken;
      session.hasTasksScope = typeof token.scope === "string" && token.scope.includes(TASKS_SCOPE);
      session.tokenError = token.error;
      return session;
    },
  },
});
