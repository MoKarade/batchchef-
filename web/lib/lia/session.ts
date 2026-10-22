// lib/lia/session.ts — la garde de session de la route et du montage de LIA.
//
// BatchChef n'a pas de `lib/session.ts` : ses Server Actions utilisent `requireSession()` de
// `lib/actionsInternes/session.ts`, qui lève une `Error` ordinaire. LIA a besoin de deux
// choses de plus : distinguer « pas de session » (401, LIA absente) d'une vraie panne, et
// connaître l'adresse de la session (pour dire au hub si c'est le propriétaire).

import { auth } from "@/auth";

export class NonAutorise extends Error {
  constructor() {
    super("Authentification requise.");
    this.name = "NonAutorise";
  }
}

/** Rend l'adresse de la session, ou lève `NonAutorise`. */
export async function requireSession(): Promise<{ email: string }> {
  const session = await auth();
  if (!session?.user) throw new NonAutorise();
  return { email: session.user.email ?? "" };
}
