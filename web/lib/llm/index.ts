// lib/llm/index.ts — les deux usages LLM de la Phase 1, côté serveur uniquement.
//
// 1. parseRecipeFromUrl : page de recette (n'importe quel site) → JSON structuré validé
//    (titre, portions, ingrédients aux unités NORMALISÉES g/ml/unite, instructions).
// 2. estimateShoppingCosts : liste d'épicerie → coûts ESTIMÉS (épicerie à Québec, CAD),
//    toujours marqués « estime » — jamais présentés comme des prix réels (no-fake-data).
//
// Réponses validées par Zod : un JSON hors schéma → erreur honnête, jamais un état sale.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const MODEL = process.env.BATCHCHEF_LLM_MODEL || "claude-haiku-4-5-20251001";

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY manquant : configure la clé (cf. .env.example).");
  }
  return new Anthropic({ apiKey });
}

/** Extrait le premier objet JSON d'une réponse texte (tolère les ```json fences). */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Réponse LLM sans objet JSON.");
  return JSON.parse(raw.slice(start, end + 1));
}

// ── 1. Parse de recette ────────────────────────────────────────────────────────

export const ParsedRecipeSchema = z.object({
  title: z.string().min(1).max(200),
  servings: z.number().int().min(1).max(50),
  imageUrl: z.string().url().nullable(),
  instructions: z.string().max(20000).nullable(),
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        canonical: z.string().min(1).max(80),
        qty: z.number().positive().nullable(),
        unit: z.enum(["g", "ml", "unite"]).nullable(),
        note: z.string().max(200).nullable(),
      }),
    )
    .min(1)
    .max(60),
});
export type ParsedRecipe = z.infer<typeof ParsedRecipeSchema>;

const PARSE_SYSTEM = `Tu extrais une recette de cuisine depuis le texte d'une page web, en JSON strict.

Règles :
- "servings" : le nombre de portions de RÉFÉRENCE de la page (défaut 4 si absent).
- Chaque ingrédient : "name" (fr, tel qu'affiché), "canonical" (minuscules, singulier,
  sans adjectifs de préparation — ex. "poitrine de poulet", "oignon", "riz basmati"),
  "qty" + "unit" NORMALISÉS : masses en "g" (1 kg → 1000), volumes en "ml" (1 L → 1000,
  1 tasse → 250, 1 c. à soupe → 15, 1 c. à thé → 5), pièces en "unite" (2 oignons → 2).
  Quantité introuvable ou "au goût" → qty: null, unit: null. Précision utile dans "note".
- "instructions" : les étapes, texte simple, ou null si absentes.
- "imageUrl" : l'URL absolue de la photo principale si évidente dans le texte, sinon null.
- Tu n'INVENTES rien : ce qui n'est pas dans la page reste null.

Réponds UNIQUEMENT avec l'objet JSON.`;

/** Convertit une page HTML en texte brut borné (le LLM n'a pas besoin du markup). */
export function htmlToText(html: string, maxChars = 60000): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Préserve les URLs d'images candidates (photo de recette) avant de jeter les tags.
    .replace(/<img[^>]*src="([^"]{1,300})"[^>]*>/gi, " [image: $1] ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&quot;|&#39;|&lt;|&gt;/g, (m) =>
      ({ "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" })[m] ?? " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxChars);
}

export async function parseRecipeFromPage(pageText: string): Promise<ParsedRecipe> {
  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: PARSE_SYSTEM,
    messages: [{ role: "user", content: `Texte de la page :\n\n${pageText}` }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Réponse LLM vide.");
  return ParsedRecipeSchema.parse(extractJson(block.text));
}

// ── 2. Estimation de budget ────────────────────────────────────────────────────

export const CostEstimateSchema = z.object({
  items: z
    .array(
      z.object({
        canonical: z.string().min(1),
        /** Coût estimé CAD pour la quantité demandée ; null si trop incertain. */
        estCost: z.number().min(0).max(500).nullable(),
      }),
    )
    .max(80),
});
export type CostEstimate = z.infer<typeof CostEstimateSchema>;

const ESTIMATE_SYSTEM = `Tu estimes le coût d'achat d'articles d'épicerie à Québec (Canada), en CAD, prix réguliers de supermarché (type Maxi), taxes EXCLUES.

Pour chaque article : le coût pour la QUANTITÉ demandée (pas le prix du format vendu).
Sois réaliste et plutôt conservateur. Article trop ambigu → estCost: null (tu n'inventes pas).

Réponds UNIQUEMENT avec l'objet JSON : {"items":[{"canonical":"...","estCost":1.23}, ...]}`;

export async function estimateShoppingCosts(
  items: Array<{ canonical: string; qty: number | null; unit: string | null }>,
): Promise<CostEstimate> {
  const list = items
    .map((i) => `- ${i.canonical} : ${i.qty === null ? "quantité au goût" : `${i.qty} ${i.unit}`}`)
    .join("\n");
  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: ESTIMATE_SYSTEM,
    messages: [{ role: "user", content: `Articles :\n${list}` }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Réponse LLM vide.");
  return CostEstimateSchema.parse(extractJson(block.text));
}
