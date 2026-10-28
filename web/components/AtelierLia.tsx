"use client";

// components/AtelierLia.tsx — /assistant : LIA en pleine page (mode `atelier` de lia-ui), tâche #346.
//
// Marc, 28/10/2026 : tout écran « assistant » d'une app est LIA, avec son interface. Il n'y a plus de chat propre à l'app : la
// discussion est celle de LIA. Le MOTEUR reste celui de l'app (la boucle qui fouille les recettes et le catalogue) : la route
// /api/lia/ask le sert quand la demande porte `atelier: true`, les autres pages parlant toujours au hub.
//
// UNE SEULE LIA : la bulle (démarrée avant l'hydratation, `lib/lia/demarrage.ts`) ne l'est pas sur ce chemin ; en arrivant ici par
// la navigation de l'app on la retire avant de monter l'atelier, et au départ on la remet. `<Lia/>` n'est monté nulle part ailleurs
// (verrou `tests/liaReglages.test.ts`). Le conteneur doit exister avant le montage : `atelier` est lu au montage seulement.

import { Lia } from "@mokarade/lia-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { dessinerBlocs } from "@/components/BlocsAtelier";
import { creerDiscussions, historiqueEnvoye } from "@/lib/assistant/discussions";
import { demanderAtelier } from "@/lib/lia/client";
import { arreterBulle, demarrerBulle, optionsLiaApp } from "@/lib/lia/demarrage";

// Remise de la bulle au départ de la page : différée d'un tour pour passer APRÈS le démontage de l'atelier, et annulée si la page
// revient aussitôt (rendu double de React en développement) — sinon la bulle repartirait par-dessus l'atelier.
let remiseBulle: number | undefined;

export function AtelierLia({ configure }: { configure: boolean }) {
  const page = useRef<HTMLDivElement>(null);
  const [conteneur, setConteneur] = useState<HTMLElement | null>(null);
  const discussions = useMemo(() => creerDiscussions(), []);

  useEffect(() => {
    if (!configure) return;
    window.clearTimeout(remiseBulle);
    arreterBulle();
    setConteneur(page.current);
    return () => {
      setConteneur(null);
      remiseBulle = window.setTimeout(demarrerBulle, 0);
    };
  }, [configure]);

  if (!configure) {
    return (
      <p className="bandeau alerte">
        L’assistant n’est pas activé pour le moment. Ce n’est pas une panne : il faut simplement le brancher côté serveur pour
        pouvoir lui poser des questions.
      </p>
    );
  }

  const reglages = optionsLiaApp();
  return (
    <>
      <div ref={page} className="h-[max(28rem,calc(100dvh-16rem))]" />
      {conteneur && reglages && (
        <Lia
          {...reglages}
          atelier={{
            conteneur,
            titre: "Assistant",
            historique: {
              liste: () => discussions.liste(),
              ouvrir: (id) => discussions.ouvrir(id),
              nouveau: () => discussions.nouveau(),
            },
          }}
          ask={async (question, signal) => {
            const reponse = await demanderAtelier(question, historiqueEnvoye(discussions.courante()), signal);
            discussions.noter(question, reponse.text);
            return { text: reponse.text, blocks: reponse.blocks };
          }}
          renderBlocks={dessinerBlocs}
        />
      )}
    </>
  );
}
