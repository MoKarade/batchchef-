// lib/llm/index.ts — les usages LLM de l'app, côté serveur uniquement.
//
// 1. parseRecipeFromPage : page de recette (n'importe quel site) → JSON structuré validé
//    (titre, portions, ingrédients aux unités NORMALISÉES g/ml/unite, instructions).
// 2. parseRecipeFromMedia : images extraites d'une vidéo (+ description publiée) → même JSON.
// 3. estimateShoppingCosts : liste d'épicerie → coûts ESTIMÉS (épicerie à Québec, CAD),
//    toujours marqués « estime » — jamais présentés comme des prix réels (no-fake-data).
//
// Réponses validées par Zod : un JSON hors schéma → erreur honnête, jamais un état sale.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { normalizeQty } from "../units";
import { recordLlmUsage } from "../llmUsage";

const MODEL = process.env.BATCHCHEF_LLM_MODEL || "claude-haiku-4-5-20251001";
// Lire une vidéo, c'est déchiffrer du texte incrusté sur des images réduites et suivre des
// gestes : nettement plus dur que parser une page HTML. D'où un modèle vision plus capable
// ici. Le surcoût réel est de l'ordre du cent par vidéo (12 images ~768 px ≈ 5 000 tokens),
// et il est publié au hub comme le reste (cf. lib/llmUsage.ts, tarif PAR modèle).
const VISION_MODEL = process.env.BATCHCHEF_LLM_MODEL_VISION || "claude-sonnet-5";

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
  /**
   * `true` quand la source n'annonce AUCUN nombre de portions et qu'on a mis 4 par défaut.
   * Un reel de cuisine ne dit presque jamais « pour 4 personnes » : afficher « 4 » sans le
   * signaler donnerait un chiffre plausible et faux, alors que TOUTES les quantités de la
   * liste d'épicerie sont mises à l'échelle à partir de lui.
   */
  servingsGuessed: boolean;
  imageUrl: string | null;
  instructions: string | null;
  ingredients: ParsedIngredient[];
}

/** Convertit la sortie LLM brute en recette normalisée (unités → g/ml/unite). */
export function normalizeParsedRecipe(raw: z.infer<typeof RawParsedRecipeSchema>): ParsedRecipe {
  const annonce = Boolean(raw.servings && raw.servings > 0);
  return {
    title: raw.title,
    servings: annonce ? (raw.servings as number) : 4,
    servingsGuessed: !annonce,
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
  void recordLlmUsage("parse", response.usage, MODEL);
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
    void recordLlmUsage("verify", response.usage, MODEL);
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return draft;
    return preserveGuessFlag(draft, normalizeParsedRecipe(RawParsedRecipeSchema.parse(extractJson(block.text))));
  } catch {
    return draft; // la vérification ne doit jamais bloquer l'import
  }
}

/**
 * Une 2ᵉ passe qui RECOPIE le nombre de portions du brouillon ne l'a pas lu dans la source :
 * sans ça, un « 4 » deviné à la 1ʳᵉ passe reviendrait vérifié à la 2ᵉ et le drapeau tomberait
 * en silence. Un nombre DIFFÉRENT, lui, vient forcément du texte → drapeau levé.
 */
function preserveGuessFlag(draft: ParsedRecipe, verified: ParsedRecipe): ParsedRecipe {
  if (!draft.servingsGuessed) return verified;
  return { ...verified, servingsGuessed: verified.servings === draft.servings };
}

// ── 1 bis. Recette depuis une vidéo (images + description) ─────────────────────
//
// L'API Anthropic ne lit pas une vidéo : on lui envoie des IMAGES extraites dans le
// navigateur (cf. lib/video/), plus la description publiée avec la vidéo quand Marc l'a
// collée. Aucune des deux sources n'est obligatoire seule — mais il en faut au moins une,
// et c'est l'appelant qui le garantit (cf. la Server Action).

/** Longueur maximale de la description prise en compte (une légende de reel est courte). */
export const MAX_CAPTION_CHARS = 8000;
/** En dessous, la description est trop maigre pour arbitrer quoi que ce soit. */
export const MIN_CAPTION_FOR_VERIFY = 40;

const MEDIA_SYSTEM = `Tu extrais une recette de cuisine depuis une vidéo de réseau social, en JSON strict.

On te donne, dans l'ordre :
- des IMAGES prises à intervalles réguliers dans la vidéo, en ordre chronologique (parfois aucune) ;
- la DESCRIPTION publiée par l'auteur avec la vidéo (parfois absente).

Comment les combiner :
- La DESCRIPTION prime quand les deux se contredisent : c'est l'auteur qui l'a écrite, et
  c'est là que les quantités exactes sont presque toujours données.
- Les IMAGES servent à lire le texte affiché à l'écran (c'est souvent là que sont les
  quantités), à reconnaître les ingrédients et à retrouver l'ORDRE des gestes.

Règles :
- "servings" : le nombre de portions SEULEMENT s'il est annoncé (à l'écran ou dans la
  description). Sinon null — ne devine pas, ne mets pas 4 « pour faire joli ».
- Chaque ingrédient : "name" (fr, tel qu'affiché), "canonical" (minuscules, singulier,
  sans adjectifs de préparation — ex. "poitrine de poulet", "oignon", "riz basmati"),
  "qty" (nombre) et "unit" tels qu'annoncés : "g", "kg", "ml", "cl", "l", "c. à soupe",
  "c. à thé", "tasse", ou "unite" pour les pièces (2 oignons → qty 2, unit "unite").
  Ne convertis PAS toi-même. Un ingrédient VU mais dont la quantité n'est annoncée nulle
  part → qty: null, unit: null. N'estime JAMAIS une quantité d'après l'image.
- "instructions" : les étapes de préparation, NUMÉROTÉES, une par ligne ("1. ...").
  Décris ce qui est réellement fait : gestes, ordre, et uniquement les durées, températures
  ou réglages qui sont ÉCRITS à l'écran ou dans la description. N'invente aucun chiffre.
  Si un moment de la recette n'est pas montré, ne comble pas le trou.
- "imageUrl" : toujours null.
- Tu n'INVENTES rien. Ce que la vidéo et la description ne disent pas reste null.

Réponds UNIQUEMENT avec l'objet JSON.`;

export interface MediaInput {
  /** Images JPEG en base64 (sans préfixe data:), ordre chronologique. Peut être vide. */
  frames: string[];
  /** Description publiée avec la vidéo. Peut être vide. */
  caption: string;
}

/** Extrait une recette d'une vidéo (images) et/ou de sa description. */
export async function parseRecipeFromMedia(input: MediaInput): Promise<ParsedRecipe> {
  const caption = input.caption.trim().slice(0, MAX_CAPTION_CHARS);
  const content: Anthropic.ContentBlockParam[] = input.frames.map((data) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data },
  }));

  const entete =
    input.frames.length > 0
      ? `${input.frames.length} image(s) de la vidéo, en ordre chronologique, ci-dessus.`
      : "Aucune image disponible : appuie-toi uniquement sur la description.";
  content.push({
    type: "text",
    text: caption
      ? `${entete}\n\nDESCRIPTION PUBLIÉE AVEC LA VIDÉO :\n${caption}`
      : `${entete}\n\nAucune description n'a été fournie.`,
  });

  const response = await client().messages.create({
    model: VISION_MODEL,
    max_tokens: 4000,
    system: MEDIA_SYSTEM,
    messages: [{ role: "user", content }],
  });
  void recordLlmUsage("video", response.usage, VISION_MODEL);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Réponse LLM vide.");
  return normalizeParsedRecipe(RawParsedRecipeSchema.parse(extractJson(block.text)));
}

const CAPTION_VERIFY_SYSTEM = `Tu vérifies une recette extraite d'une VIDÉO contre la DESCRIPTION publiée avec elle.

⚠️ La description est PARTIELLE par nature : beaucoup d'ingrédients n'apparaissent qu'à l'écran
dans la vidéo, et tu ne vois pas la vidéo. Donc :
- Ne SUPPRIME jamais un ingrédient au motif qu'il est absent de la description.
- N'AJOUTE pas d'ingrédient que la description ne mentionne pas.
- Corrige UNIQUEMENT ce que la description CONTREDIT : une quantité, une unité, un nombre de
  portions, un nom manifestement erroné.
- "servings" : corrige-le seulement si la description annonce un nombre. Sinon laisse tel quel.
- Laisse les instructions intactes sauf contradiction explicite.

Réponds UNIQUEMENT avec l'objet JSON corrigé, même structure que l'extraction fournie.`;

/**
 * 2ᵉ passe pour une recette issue d'une vidéo : recale les quantités sur la description.
 * Best-effort — à la moindre anomalie on garde le brouillon, jamais un plantage.
 *
 * Volontairement SÉPARÉE de `verifyParsedRecipe` : celle-ci demande de coller EXACTEMENT au
 * texte fourni, ce qui, sur une description partielle, effacerait tous les ingrédients que
 * seule la vidéo montrait.
 */
export async function verifyRecipeAgainstCaption(
  caption: string,
  draft: ParsedRecipe,
): Promise<ParsedRecipe> {
  const texte = caption.trim().slice(0, MAX_CAPTION_CHARS);
  if (texte.length < MIN_CAPTION_FOR_VERIFY) return draft; // rien à confronter
  try {
    const response = await client().messages.create({
      model: VISION_MODEL,
      max_tokens: 4000,
      system: CAPTION_VERIFY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `DESCRIPTION PUBLIÉE :\n${texte}\n\nEXTRACTION À VÉRIFIER :\n${JSON.stringify(draftToRaw(draft))}`,
        },
      ],
    });
    void recordLlmUsage("verify", response.usage, VISION_MODEL);
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return draft;
    return preserveGuessFlag(draft, normalizeParsedRecipe(RawParsedRecipeSchema.parse(extractJson(block.text))));
  } catch {
    return draft;
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
  void recordLlmUsage("estimate", response.usage, MODEL);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Réponse LLM vide.");
  return alignCosts(CostEstimateSchema.parse(extractJson(block.text)), items.length);
}
