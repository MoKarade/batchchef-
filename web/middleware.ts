// middleware.ts — garde global : BatchChef est privé (données perso). Fail-closed si
// l'auth n'est pas configurée ; sinon décision pure via decideGuard (testée).

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { decideGuard } from "@/lib/authGuard";
import { isAuthConfigured } from "@/lib/authConfigured";

export default auth((req) => {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      {
        error: "auth_unconfigured",
        message:
          "Authentification non configurée (AUTH_SECRET / AUTHORIZED_EMAIL manquants). Accès refusé.",
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
