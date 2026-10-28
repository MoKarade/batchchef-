// lib/llm/modele.ts — le modèle réellement appelé : une variable d'environnement peut le
// changer, mais jamais pour un modèle hors de la génération 5.5.
//
// POURQUOI : les variables Vercel `BATCHCHEF_LLM_MODEL*` et `BATCHCHEF_MODELE_ASSISTANT`
// l'emportent sur le code, et leur valeur ne se lit pas depuis l'extérieur. Une ancienne
// valeur oubliée ferait payer Haiku 4.5 au prix d'avant (×10) sans que rien ne le dise.
// Ici elle est écartée, le défaut du code sert, et le journal serveur le dit (id de modèle
// seulement : ce n'est pas un secret).

const FAMILLES_ACCEPTEES = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;

/** `true` si l'identifiant appartient à la génération 5.5 (un identifiant daté passe). */
export function estModele55(id: string): boolean {
  const propre = id.trim().toLowerCase();
  return FAMILLES_ACCEPTEES.some((famille) => propre.startsWith(famille));
}

/** Valeur de la variable si elle est en 5.5, sinon le défaut du code (et une trace au journal). */
export function modeleChoisi(nomVariable: string, valeur: string | undefined, defaut: string): string {
  const brut = valeur?.trim();
  if (!brut) return defaut;
  if (estModele55(brut)) return brut;
  console.warn(`[modele] ${nomVariable}="${brut}" n'est pas en génération 5.5 : ignorée, ${defaut} utilisé.`);
  return defaut;
}
