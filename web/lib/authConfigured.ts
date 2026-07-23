// lib/authConfigured.ts — fail-closed : sans AUTH_SECRET/AUTHORIZED_EMAIL, Auth.js
// laisse passer en logguant MissingSecret (constaté sur le hub). App privée → sans
// config d'auth complète, on ne sert RIEN de protégé.

type Env = Record<string, string | undefined>;

export function isAuthConfigured(env: Env = process.env): boolean {
  return Boolean(env.AUTH_SECRET?.trim() && env.AUTHORIZED_EMAIL?.trim());
}
