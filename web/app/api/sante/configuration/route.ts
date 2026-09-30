// app/api/sante/configuration/route.ts — sonde PUBLIQUE de configuration (F7, INC-16).
//
// Incident INC-16 : la production a répondu 503 parce qu'AUTH_SECRET/AUTHORIZED_EMAIL
// manquaient, et rien ne le disait. `GET /api/sante` vérifie la BASE ; celle-ci vérifie
// que les variables contrôlées (lib/configurationRequise.ts) sont posées :
//   - une REQUISE absente (tout le monde bloqué) → 503 { ok: false, manquantes: N } ;
//   - seulement une DÉGRADANTE absente (invités bloqués, propriétaire OK) → 200
//     { ok: true, degrade: N } ;
//   - tout est là → 200 { ok: true }.
//
// ⚠️ SANS authentification, délibérément, comme /api/sante : exemptée par ÉGALITÉ STRICTE
// dans `lib/authGuard.ts`, et SEULE route à passer le 503 « auth non configurée » du
// middleware — sinon, dans le cas exact d'INC-16, elle ne serait jamais atteinte.
//
// ⚠️ Règle absolue : la réponse ne NOMME JAMAIS une variable (ni valeur) — seulement des
// COMPTES. Nommer publiquement ce qui manque donnerait la carte de ce qu'il faut forcer.
// Les noms réels partent au journal serveur (journaux Vercel), jamais dans la réponse.
//
// Route séparée plutôt qu'un champ de /api/sante : celle-ci ne touche pas la base (réponse
// immédiate, aucun appel réseau), et la vigie distingue « base en panne » de « mal
// configurée » par l'adresse et la `cause`, sans changer le contrat de /api/sante.

import { variablesManquantes } from "@/lib/configurationRequise";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function pluriel(n: number): string {
  return n === 1 ? "1 variable manquante" : `${n} variables manquantes`;
}

export async function GET(): Promise<Response> {
  const { requises, degradantes } = variablesManquantes();
  if (requises.length + degradantes.length > 0) {
    // Journal serveur uniquement : les NOMS, jamais les valeurs.
    console.error(
      `[sante/configuration] manquantes — requises : ${requises.join(", ") || "aucune"} ; ` +
        `dégradantes : ${degradantes.join(", ") || "aucune"}`,
    );
  }
  const degrade = degradantes.length > 0 ? { degrade: degradantes.length } : {};
  if (requises.length === 0) {
    return Response.json({ ok: true, ...degrade }, { headers: NO_STORE });
  }
  return Response.json(
    {
      ok: false,
      cause: "configuration",
      manquantes: requises.length,
      ...degrade,
      message: `configuration incomplète : ${pluriel(requises.length)}`,
    },
    { status: 503, headers: NO_STORE },
  );
}
