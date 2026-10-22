"use client";

// LIA, montée une fois pour toute l'app (l'état du moteur est global : une seule par page).
// Tout ce qui se décide est dans lib/lia/ ; ce composant ne fait que brancher.

import { Lia } from "@mokarade/lia-ui/react";
import { demanderLia } from "@/lib/lia/client";

export default function LiaMontee() {
  return <Lia ask={(question, signal) => demanderLia(question, signal, { page: window.location.pathname })} />;
}
