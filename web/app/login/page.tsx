// /login — page publique : bouton Google + message honnête sur refus.
import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="carte mx-auto mt-16 max-w-sm p-8 text-center">
      <p className="surtitre">Connexion</p>
      <h1 className="mt-1 text-2xl font-bold">BatchChef</h1>
      <p className="doux mt-2">
        App privée — connexion Google requise.
      </p>
      {params.error === "AccessDenied" && (
        <p className="bandeau erreur mt-3 text-left" role="alert">
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
