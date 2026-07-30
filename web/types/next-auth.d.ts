// Augmentation des types Auth.js : jetons Google portés par le JWT + champs server-side
// exposés à la session (lus UNIQUEMENT côté serveur, cf. auth.ts).

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    /** Jeton d'accès Google (server-side only). */
    accessToken?: string;
    /** Le scope Google Tasks a-t-il été accordé ? */
    hasTasksScope?: boolean;
    /** Erreur de rafraîchissement du jeton (ex. "RefreshAccessTokenError"). */
    tokenError?: string;
    user?: DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    /** Epoch secondes d'expiration du access_token. */
    expiresAt?: number;
    scope?: string;
    error?: string;
  }
}
