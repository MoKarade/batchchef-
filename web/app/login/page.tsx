// /login — page publique : bouton Google + message honnête sur refus.
import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-2xl border border-[var(--bordure)] bg-white p-8 text-center shadow-sm  ">
      <h1 className="text-xl font-bold">BatchChef</h1>
      <p className="mt-2 text-sm doux">
        App privée — connexion Google requise.
      </p>
      {params.error === "AccessDenied" && (
        <p className="mt-3 rounded-lg erreur p-2 text-sm">
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
          className="mt-5 w-full rounded-xl px-4 py-3 font-medium text-white"
          style={{ backgroundColor: "var(--accent)" }}
        >
          Se connecter avec Google
        </button>
      </form>
    </div>
  );
}
