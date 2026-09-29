// /login — page publique : bouton Google + message honnête sur refus.
import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-2xl border border-[var(--bordure)] bg-[var(--surface)] p-8 text-center shadow-sm">
      <h1 className="text-xl font-bold">BatchChef</h1>
      <p className="mt-2 text-sm doux">
        App privée — connexion Google requise.
      </p>
      {params.error === "AccessDenied" && (
        <p className="bandeau erreur text-sm mt-3">
          Accès non autorisé pour ce compte.
        </p>
      )}
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: params.callbackUrl ?? "/" });
        }}
      >
        <button
          type="submit"
          className="bouton bouton-principal mt-5 w-full"
        >
          Se connecter avec Google
        </button>
      </form>
    </div>
  );
}
