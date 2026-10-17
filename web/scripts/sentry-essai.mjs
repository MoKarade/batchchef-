// scripts/sentry-essai.mjs — envoie UNE erreur volontaire à Sentry et dit si elle est partie.
//
// Lancé par `npm run sentry:essai` (en local avec SENTRY_DSN dans l'environnement, ou par le
// workflow « Essai Sentry » qui lit le secret du dépôt). Il passe par les MÊMES réglages que
// l'app (lib/sentryConfig.ts : aucune donnée personnelle), jamais par un Sentry.init libre.
//
// Échec fermé : sans DSN, ou si Sentry n'a pas répondu par un code 2xx, le script sort en erreur.
// Il n'affiche jamais le DSN.

import * as Sentry from "@sentry/node";
// Node 24 lit les .ts directement (retrait des types) ; le fichier n'a aucun import.
import { optionsSentry } from "../lib/sentryConfig.ts";

const options = optionsSentry(process.env.SENTRY_DSN);
if (!options.enabled) {
  console.error("SENTRY_DSN absent : rien envoyé. Définis-le puis relance.");
  process.exit(1);
}

Sentry.init({ ...options, environment: "essai" });

// `Sentry.flush()` rend vrai dès que la file est vide, même quand le réseau a échoué : seul
// l'accusé HTTP de Sentry prouve la livraison.
let codeHttp;
Sentry.getClient()?.on("afterSendEvent", (_evenement, reponse) => {
  codeHttp = reponse?.statusCode;
});

const identifiant = Sentry.captureException(
  new Error("Erreur d'essai volontaire (npm run sentry:essai) : aucune panne réelle."),
);
await Sentry.flush(10_000);

console.log(`Identifiant d'événement : ${identifiant}`);
console.log(`Réponse HTTP de Sentry : ${codeHttp ?? "aucune"}`);
const livre = codeHttp !== undefined && codeHttp >= 200 && codeHttp < 300;
console.log(`Livraison accusée par Sentry : ${livre ? "oui" : "non"}`);
process.exit(livre ? 0 : 1);
