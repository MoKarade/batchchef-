// auth.ts — Auth.js (NextAuth v5), même pattern que le hub : un seul compte Google admis
// (AUTHORIZED_EMAIL), session JWT, secrets via l'environnement.
//
// En plus du login, on demande le scope Google Tasks (écriture) pour créer une liste de
// courses cochable dans Google Tasks. Le jeton d'accès Google est stocké dans le JWT
// (chiffré, httpOnly) et rafraîchi automatiquement ; il est lu UNIQUEMENT côté serveur
// (Server Actions) — jamais rendu au client (pas de SessionProvider portant le jeton).
//
// Les portées et la mécanique des jetons vivent dans `lib/jetonsGoogle.ts`, partagé avec
// HUBPERSO — et avec lui seul depuis le 14/08 : JobAI et CarAI ont cessé de parler à
// Google (étape 1 de l'ADR 0001) et n'en ont plus besoin. Le fichier doit rester
// rigoureusement identique dans les deux dépôts qui le gardent.
//
// Raison d'être : le cookie de session est partagé, donc c'est la DERNIÈRE app où l'on
// s'est connecté qui décide du contenu du jeton. Si BatchChef était seule à demander
// Tasks, se connecter par le hub la laisserait connectée mais sans droit d'écriture. Le
// hub demande donc la même portée et rafraîchit le jeton pour elle.

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAuthorizedEmail } from "@/lib/authorized";
import { cookiesSessionPartagee } from "@/lib/sessionPartagee";
import {
  PARAMS_AUTORISATION,
  PORTEE_TASKS,
  majJetonsGoogle,
} from "@/lib/jetonsGoogle";

/** Conservé sous son ancien nom : `lib/googleTasks.ts` et les tests s'en servent. */
export const TASKS_SCOPE = PORTEE_TASKS;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Portées et paramètres IDENTIQUES dans les quatre apps Auth.js : c'est ce qui
      // permet à n'importe laquelle de minter un jeton utilisable par les autres.
      authorization: { params: PARAMS_AUTORISATION },
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
  // Depuis le 14/08, BatchChef sert `batchchef.hubperso.com` : elle peut donc enfin
  // recevoir le cookie partagé, ce que son ancienne adresse `.vercel.app` interdisait
  // (un cookie ne franchit pas la frontière entre deux domaines). Voir
  // `lib/sessionPartagee.ts`.
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

      // Capture à la connexion, renouvellement ensuite. Logique partagée par les
      // quatre apps : celle par laquelle on passe rafraîchit pour toutes.
      return await majJetonsGoogle(token, account);
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
