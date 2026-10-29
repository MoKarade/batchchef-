// app/api/sante/route.ts — sonde de santé publique, pour la vigie de l'Atelier.
// Modèle : CarAI #204 (commit eaab5b4), adapté à BatchChef.
//
// ⚠️ SANS authentification, délibérément (exemptée par ÉGALITÉ STRICTE dans
// `lib/authGuard.ts`). Sous la garde de session, la vigie recevrait une redirection vers
// /login (307) au lieu du JSON et ne verrait JAMAIS une panne de base — c'est ce qui s'est
// passé le 29/09/2026 : Neon refusait tout, et l'accueil répondait quand même 307.
//
// Elle ne rend jamais de donnée métier ni de message d'erreur brut : seulement
// {"ok": true} ou 503 {"ok": false, "cause": "base"}, plus `commit` (7 premiers caractères
// de `VERCEL_GIT_COMMIT_SHA`, absent en local) pour voir quel commit le domaine sert. Le
// détail d'une panne part au journal serveur.
//
// Différence avec CarAI : pas de `baseConfiguree()` ni de cooldown de migrations ici.
// `lib/db` est PARESSEUX et lève à la première requête si `DATABASE_URL` manque — le même
// `try` couvre donc la base absente ET la base injoignable. Une sonde horaire fait un seul
// `SELECT 1` : aucun risque de marteler une base en panne.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { commitServi } from "@/lib/commitServi";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(): Promise<Response> {
  const commit = commitServi(process.env);
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, ...(commit && { commit }) }, { headers: NO_STORE });
  } catch (err) {
    // Journalisé, JAMAIS renvoyé : un message brut peut porter un nom d'hôte ou un détail
    // de connexion, et la vigie n'a besoin que de « ok / pas ok ».
    console.error("[sante] base indisponible", err);
    return Response.json(
      { ok: false, cause: "base", ...(commit && { commit }) },
      { status: 503, headers: NO_STORE },
    );
  }
}
