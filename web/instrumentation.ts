// instrumentation.ts — branche Sentry côté serveur (Next 16 appelle `register` au démarrage).
//
// Le DSN vient de `SENTRY_DSN` ; absent, `optionsSentry` éteint Sentry et rien ne change.
// Les réglages (aucune donnée personnelle) vivent dans lib/sentryConfig.ts.

import * as Sentry from "@sentry/nextjs";
import { optionsSentry } from "@/lib/sentryConfig";

export function register(): void {
  Sentry.init(optionsSentry(process.env.SENTRY_DSN));
}

// Remonte les erreurs des Server Components, des routes et des Server Actions.
export const onRequestError = Sentry.captureRequestError;
