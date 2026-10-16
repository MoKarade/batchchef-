"use client";

// app/global-error.tsx — dernier filet : une erreur de rendu que rien d'autre n'attrape (le layout
// racine lui-même a planté). Elle est envoyée à Sentry (éteint sans DSN, voir lib/sentryConfig.ts)
// puis l'écran dit honnêtement qu'il y a eu un problème. Aucun détail technique n'est affiché.

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fr-CA">
      <body>
        <main className="carte" role="alert">
          <h1 className="text-xl font-semibold">Un problème est survenu</h1>
          <p className="doux">L&apos;erreur a été signalée. Recharge la page pour réessayer.</p>
        </main>
      </body>
    </html>
  );
}
