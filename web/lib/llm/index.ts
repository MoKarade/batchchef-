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
import { normalizeQty } from "../units";

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

// Schéma TOLÉRANT de la sortie LLM : `unit` est libre (« g », « cl », « c. à soupe »,
// « tasse », « unité »…) et TOUT champ « vide » peut être null OU absent (`nullish`). La
// normalisation vers g/ml/unite est faite APRÈS, en code (`normalizeQty`) — on ne compte
// pas sur le LLM pour normaliser parfaitement (il glisse toujours), ce qui rendait l'import
// fragile (un « c. à soupe » ou une clé `note` omise faisait planter tout l'import).
export const RawParsedRecipeSchema = z.object({
  title: z.string().min(1).max(200),
  servings: z.number().int().min(1).max(50).nullish(),
  imageUrl: z.string().url().nullish(),
  instructions: z.string().max(20000).nullish(),
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        canonical: z.string().min(1).max(80).nullish(),
        qty: z.number().positive().nullish(),
        unit: z.string().max(30).nullish(),
        note: z.string().max(200).nullish(),
      }),
    )
    .min(1)
    .max(80),
});

/** Recette NORMALISÉE (unités en g/ml/unite) — le format consommé par le reste de l'app. */
export interface ParsedIngredient {
  name: string;
  canonical: string;
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
  note: string | null;
}
export interface ParsedRecipe {
  title: string;
  servings: number;
  imageUrl: string | null;
  instructions: string | null;
  ingredients: ParsedIngredient[];
}

/** Convertit la sortie LLM brute en recette normalisée (unités → g/ml/unite). */
export function normalizeParsedRecipe(raw: z.infer<typeof RawParsedRecipeSchema>): ParsedRecipe {
  return {
    title: raw.title,
    servings: raw.servings && raw.servings > 0 ? raw.servings : 4,
    imageUrl: raw.imageUrl ?? null,
    instructions: raw.instructions ?? null,
    ingredients: raw.ingredients.map((i) => {
      // Le texte de désambiguïsation des cuillères (thé vs soupe) vit dans unit/note.
      const norm = normalizeQty(i.qty ?? null, i.unit ?? null, `${i.unit ?? ""} ${i.note ?? ""}`);
      const canonical = (i.canonical ?? i.name).toLowerCase().trim();
      return {
        name: i.name,
        canonical: canonical || i.name.toLowerCase().trim(),
        qty: norm.qty,
        unit: norm.unit,
        note: i.note ?? null,
      };
    }),
  };
}

const PARSE_SYSTEM = `Tu extrais une recette de cuisine depuis le texte d'une page web, en JSON strict.

Règles :
- "servings" : le nombre de portions de RÉFÉRENCE de la page (défaut 4 si absent).
- Chaque ingrédient : "name" (fr, tel qu'affiché), "canonical" (minuscules, singulier,
  sans adjectifs de préparation — ex. "poitrine de poulet", "oignon", "riz basmati"),
  "qty" (nombre) et "unit" tels que dans la recette : "g", "kg", "ml", "cl", "l",
  "c. à soupe", "c. à thé", "tasse", ou "unite" pour les pièces (2 oignons → qty 2, unit "unite").
  Ne convertis PAS toi-même : donne la quantité et l'unité NATURELLES. Quantité absente ou
  "au goût" → qty: null, unit: null. Une précision (facultative) va dans "note".
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
  return normalizeParsedRecipe(RawParsedRecipeSchema.parse(extractJson(block.text)));
}

const VERIFY_SYSTEM = `Tu es un vérificateur de recettes minutieux. On te donne le TEXTE d'une page de
recette et une extraction JSON préliminaire. Corrige l'extraction pour qu'elle colle EXACTEMENT au texte.

Contrôles prioritaires (source d'erreurs) :
- "servings" : le vrai nombre de portions annoncé sur la page (« pour X personnes / parts »). Corrige-le
  s'il est faux ; c'est capital car les quantités s'entendent pour ce nombre de portions.
- chaque ingrédient : vérifie le NOMBRE et l'UNITÉ contre le texte. Corrige toute valeur erronée.
  Unités : "g", "kg", "ml", "cl", "l", "c. à soupe", "c. à thé", "tasse", ou "unite" pour les pièces.
  Quantité absente / « au goût » → qty null, unit null. N'INVENTE aucune quantité.
- garde les ingrédients réels du texte ; n'en ajoute pas d'imaginaires, n'en retire pas de vrais.

Réponds UNIQUEMENT avec l'objet JSON corrigé, même structure que l'extraction fournie.`;

/** Convertit une recette normalisée en objet « brut » (pour la repasser au vérificateur). */
function draftToRaw(r: ParsedRecipe): unknown {
  return {
    title: r.title,
    servings: r.servings,
    imageUrl: r.imageUrl,
    instructions: r.instructions,
    ingredients: r.ingredients.map((i) => ({
      name: i.name,
      canonical: i.canonical,
      qty: i.qty,
      unit: i.unit,
      note: i.note,
    })),
  };
}

/**
 * Deuxième passe : re-vérifie quantités et portions contre le texte de la page et corrige.
 * C'est l'« analyse plus poussée » avant la validation manuelle. Best-effort : à la moindre
 * anomalie (LLM muet, JSON hors schéma), on retombe sur le brouillon — jamais un plantage.
 */
export async function verifyParsedRecipe(pageText: string, draft: ParsedRecipe): Promise<ParsedRecipe> {
  try {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: VERIFY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `TEXTE DE LA PAGE :\n${pageText}\n\nEXTRACTION À VÉRIFIER :\n${JSON.stringify(draftToRaw(draft))}`,
        },
      ],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return draft;
    return normalizeParsedRecipe(RawParsedRecipeSchema.parse(extractJson(block.text)));
  } catch {
    return draft; // la vérification ne doit jamais bloquer l'import
  }
}

// ── 2. Estimation de budget ────────────────────────────────────────────────────

// Réponse INDEXÉE : le LLM renvoie un coût par index d'article (pas par nom). Le matching
// par index élimine toute perte due à un canonical reformulé (accent, pluriel, synonyme) —
// c'était la cause de « presque aucun article n'a de prix ».
export const CostEstimateSchema = z.object({
  items: z
    .array(
      z.object({
        i: z.number().int().min(0),
        /** Coût estimé CAD pour la quantité demandée ; null seulement si vraiment inclassable. */
        estCost: z.number().min(0).max(500).nullable(),
      }),
    )
    .max(200),
});
export type CostEstimate = z.infer<typeof CostEstimateSchema>;

/** Réaligne la réponse indexée du LLM sur la liste d'entrée (longueur n). Index hors borne ignoré. */
export function alignCosts(parsed: CostEstimate, n: number): Array<number | null> {
  const out: Array<number | null> = new Array(n).fill(null);
  for (const it of parsed.items) {
    if (it.i >= 0 && it.i < n) out[it.i] = it.estCost;
  }
  return out;
}

const ESTIMATE_SYSTEM = `Tu estimes le coût d'achat d'articles d'épicerie à Québec (Canada), en CAD, prix réguliers de supermarché (type Maxi), taxes EXCLUES.

On te donne une liste NUMÉROTÉE d'ingrédients de cuisine courants. Pour CHAQUE numéro, donne
le coût pour la QUANTITÉ demandée (pas le prix du format entier vendu en magasin).

Ce sont des ingrédients ordinaires : tu SAIS les estimer. Donne TOUJOURS un prix réaliste.
N'utilise estCost: null que si l'article est vraiment inclassable (nom incompréhensible) —
ce doit être rarissime. Une quantité « au goût » (sel, poivre, épices) → estime la petite
portion réellement utilisée (quelques cents à ~1 $), pas null.

Réponds UNIQUEMENT avec le JSON, un objet par article avec son index i :
{"items":[{"i":0,"estCost":4.50},{"i":1,"estCost":0.60}, ...]}`;

/**
 * Estime le coût de chaque article. Retourne un tableau ALIGNÉ sur `items` (même longueur,
 * même ordre) : `number` (CAD) ou `null` (inclassable). Best-effort — l'appelant décide
 * quoi faire d'un null (jamais un chiffre inventé côté app).
 */
export async function estimateShoppingCosts(
  items: Array<{ canonical: string; name?: string; qty: number | null; unit: string | null }>,
): Promise<Array<number | null>> {
  if (items.length === 0) return [];
  const list = items
    .map((it, idx) => {
      const label =
        it.name && it.name.toLowerCase() !== it.canonical.toLowerCase()
          ? `${it.canonical} (${it.name})`
          : it.canonical;
      const qty = it.qty === null ? "quantité au goût" : `${it.qty} ${it.unit ?? ""}`.trim();
      return `${idx}. ${label} : ${qty}`;
    })
    .join("\n");
  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: ESTIMATE_SYSTEM,
    messages: [{ role: "user", content: `Articles :\n${list}` }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Réponse LLM vide.");
  return alignCosts(CostEstimateSchema.parse(extractJson(block.text)), items.length);
}
