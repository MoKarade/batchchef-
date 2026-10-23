// instrumentation-client.ts — branche Sentry et monte LIA dans le navigateur (chargé avant l'hydratation).
//
// Le DSN n'est pas un secret (il est lisible par tout navigateur qui charge l'app) : le même
// `SENTRY_DSN` sert aux deux côtés, copié vers `NEXT_PUBLIC_SENTRY_DSN` par next.config.ts.

import * as Sentry from "@sentry/nextjs";
import { demarrerLiaApp } from "@/lib/lia/demarrage";
import { optionsSentry } from "@/lib/sentryConfig";

Sentry.init(optionsSentry(process.env.NEXT_PUBLIC_SENTRY_DSN));

// LIA se pose dans le document avant l'hydratation (voir lib/lia/demarrage.ts).
demarrerLiaApp();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
