// auth.ts — Auth.js (NextAuth v5), même pattern éprouvé que le hub perso : un seul
// compte Google admis (AUTHORIZED_EMAIL), session JWT, secrets via l'environnement.

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAuthorizedEmail } from "@/lib/authorized";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  // Requis en local/self-hosted (sinon UntrustedHost) ; sans risque, les redirect URIs
  // sont verrouillés côté Google.
  trustHost: true,
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    signIn({ user }) {
      return isAuthorizedEmail(user?.email, process.env.AUTHORIZED_EMAIL);
    },
  },
});
