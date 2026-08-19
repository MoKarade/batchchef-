// Résolution du fournisseur OAuth depuis l'environnement.
//
// UN SEUL SECRET À POSER : `MCP_TOKEN`. Il sert deux fois — jeton porteur direct pour
// Claude Code, et clé d'accès que Marc tape sur la page de consentement pour claude.ai.
// La clé de SIGNATURE en est dérivée par HMAC quand `MCP_OAUTH_SIGNING_KEY` est absente :
// ce sont deux usages distincts d'une même racine, jamais la même valeur en clair.
//
// Pourquoi laisser la signature surchargeable : c'est le KILL-SWITCH. Changer la clé de
// signature invalide TOUTES les connexions existantes sans changer la clé que Marc tape.
// Sans surcharge, la seule façon de tout révoquer est de changer `MCP_TOKEN` — ce qui
// oblige aussi à reconfigurer Claude Code. Deux gestes de gravité différente méritent deux
// leviers.

import { createHmac } from "node:crypto";
import { publicUrl } from "@/lib/hubSummary";
import { creerFournisseurOAuth, LONGUEUR_MIN_CLE, type FournisseurOAuth } from "./oauth";

export interface EtatOAuth {
  /** Le fournisseur, ou `null` si l'OAuth ne peut pas démarrer. */
  fournisseur: FournisseurOAuth | null;
  /** Pourquoi il ne démarre pas — DIT, jamais silencieux. */
  motif: string | null;
}

/**
 * ⚠️ Rend un motif LISIBLE plutôt que `null` muet. « Pas configuré » et « configuré mais
 * clé trop courte » appellent deux gestes opposés, et un connecteur qui échoue sans rien
 * dire est exactement ce qui a coûté cette session-ci.
 */
export function etatOAuth(): EtatOAuth {
  const jeton = process.env.MCP_TOKEN?.trim();
  if (!jeton) {
    return { fournisseur: null, motif: "MCP_TOKEN non configuré côté BatchChef." };
  }
  if (jeton.length < LONGUEUR_MIN_CLE) {
    return {
      fournisseur: null,
      motif:
        `MCP_TOKEN fait ${jeton.length} caractères ; il en faut au moins ${LONGUEUR_MIN_CLE} ` +
        "pour servir de clé d'accès OAuth (c'est la seule porte du connecteur, elle ne doit " +
        "pas se deviner). Le jeton porteur direct, lui, continue de fonctionner.",
    };
  }
  const surcharge = process.env.MCP_OAUTH_SIGNING_KEY?.trim();
  const cleSignature =
    surcharge && surcharge.length >= 32
      ? surcharge
      : createHmac("sha256", jeton).update("batchchef:oauth:signature:v1").digest("base64url");

  return {
    fournisseur: creerFournisseurOAuth({
      cleSignature,
      cleAcces: jeton,
      issuer: publicUrl(),
    }),
    motif: null,
  };
}
