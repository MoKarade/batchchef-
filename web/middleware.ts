// middleware.ts — garde global : BatchChef est privé (données perso). Fail-closed si
// l'auth n'est pas configurée ; sinon décision pure via decideGuard (testée).

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { contourneAuthNonConfiguree, decideGuard } from "@/lib/authGuard";
import { variablesAuthManquantes } from "@/lib/authConfigured";

export default auth((req) => {
  // Exception unique : la sonde de configuration doit répondre justement dans ce cas-là.
  const manquantes = variablesAuthManquantes();
  if (manquantes.length > 0 && !contourneAuthNonConfiguree(req.nextUrl.pathname)) {
    // Les NOMS au journal serveur seulement ; la réponse publique reste générique (F7) :
    // nommer ce qui manque donnerait la carte de ce qu'il faut forcer.
    console.error(`[middleware] authentification non configurée : ${manquantes.join(", ")}`);
    return NextResponse.json(
      {
        error: "auth_unconfigured",
        message: "Authentification non configurée. Accès refusé.",
      },
      { status: 503 },
    );
  }

  const decision = decideGuard({
    isAuthenticated: Boolean(req.auth),
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
  });

  switch (decision.type) {
    case "next":
      return;
    case "unauthorized":
      return NextResponse.json(
        { error: "unauthenticated", message: "Authentification requise." },
        { status: 401 },
      );
    case "redirect":
      return NextResponse.redirect(new URL(decision.location, req.nextUrl.origin));
  }
});

export const config = {
  // Garde tout sauf les assets ; /login et /api/auth/* sont laissés passer par
  // isPublicPath (JAMAIS ajouter de route de données ici).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest).*)"],
};
