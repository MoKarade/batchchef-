// lib/commitServi.ts — les 7 premiers caractères du commit que ce déploiement sert.
//
// Pure : rend `undefined` plutôt qu'une valeur inventée (variable absente, comme en local,
// ou valeur qui n'est pas un sha hexadécimal). Public : un sha de commit n'est ni un secret
// ni une donnée de recette. Sert à `/api/sante`, pour voir quel commit un domaine sert
// après un retour en arrière (alias Vercel figé).

const SHA_HEXADECIMAL = /^[0-9a-f]{7,64}$/i;

export function commitServi(env: Record<string, string | undefined>): string | undefined {
  const brut = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (!brut || !SHA_HEXADECIMAL.test(brut)) return undefined;
  return brut.slice(0, 7).toLowerCase();
}
