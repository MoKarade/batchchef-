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
        className="w-full rounded-xl border px-4 py-3 text-sm font-medium"
        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
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
      <button
        type="submit"
        className="rounded-lg px-3 py-2 text-sm font-medium doux hover:bg-[var(--surface-douce)]"
      >
        Déconnexion
      </button>
    </form>
  );
}
