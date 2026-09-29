// Boutons d'authentification (Server Actions Auth.js). « Reconnecter Google » relance le
// flux OAuth (prompt: consent) pour accorder de nouveaux scopes — ex. Google Tasks — sans
// devoir se déconnecter d'abord. « Déconnexion » ferme la session.

import { signIn, signOut } from "@/auth";

export function ReconnectGoogleButton({ redirectTo = "/" }: { redirectTo?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo });
      }}
    >
      <button
        type="submit"
        className="bouton bouton-second w-full"
      >
        Reconnecter Google (autoriser l’accès à Tasks)
      </button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button type="submit" className="nav-outil">
        Déconnexion
      </button>
    </form>
  );
}
