// app/api/sante/configuration/route.ts — sonde PUBLIQUE de configuration (F7, INC-16).
//
// Incident INC-16 : la production a répondu 503 parce qu'AUTH_SECRET/AUTHORIZED_EMAIL
// manquaient, et rien ne le disait. `GET /api/sante` vérifie la BASE ; celle-ci vérifie
// que les variables REQUISES (lib/configurationRequise.ts) sont posées.
//
// ⚠️ SANS authentification, délibérément, comme /api/sante : exemptée par ÉGALITÉ STRICTE
// dans `lib/authGuard.ts`, et SEULE route à passer le 503 « auth non configurée » du
// middleware — sinon, dans le cas exact d'INC-16, elle ne serait jamais atteinte.
//
// ⚠️ Règle absolue : la réponse ne NOMME JAMAIS une variable (ni valeur) — seulement un
// COMPTE. Nommer publiquement ce qui manque donnerait la carte de ce qu'il faut forcer.
// Les noms réels partent au journal serveur (journaux Vercel), jamais dans la réponse.
//
// Route séparée plutôt qu'un champ de /api/sante : celle-ci ne touche pas la base (réponse
// immédiate, aucun appel réseau), et la vigie distingue « base en panne » de « mal
// configurée » par l'adresse et la `cause`, sans changer le contrat de /api/sante.

import { variablesManquantes } from "@/lib/configurationRequise";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(): Promise<Response> {
  const manquantes = variablesManquantes();
  if (manquantes.length === 0) {
    return Response.json({ ok: true }, { headers: NO_STORE });
  }
  // Journal serveur uniquement : les NOMS, jamais les valeurs.
  console.error(
    `[sante/configuration] variables requises manquantes : ${manquantes.join(", ")}`,
  );
  const n = manquantes.length;
  const libelle = n === 1 ? "1 variable manquante" : `${n} variables manquantes`;
  return Response.json(
    { ok: false, cause: "configuration", manquantes: n, message: `configuration incomplète : ${libelle}` },
    { status: 503, headers: NO_STORE },
  );
}
