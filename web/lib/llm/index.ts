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
import { noteQuantiteNonConvertie, normalizeQty } from "../units";
import { recordLlmUsage } from "../llmUsage";
import { MAX_TRANSCRIPT_CHARS } from "../transcription";

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
/** Clés sous lesquelles un modèle range le texte quand il rend une étape en OBJET. */
const CLES_TEXTE = ["text", "texte", "instruction", "etape", "step", "description", "value"];

/** Un élément de liste ramené à du texte, ou `null` s'il n'est pas réductible honnêtement. */
function elementEnTexte(element: unknown): string | null {
  if (typeof element === "string") return element;
  if (typeof element === "number" && Number.isFinite(element)) return String(element);
  if (element && typeof element === "object") {
    for (const cle of CLES_TEXTE) {
      const valeur = (element as Record<string, unknown>)[cle];
      if (typeof valeur === "string" && valeur.trim()) return valeur;
    }
  }
  return null;
}

/**
 * Ramène à du texte une valeur que le modèle a pu rendre en LISTE.
 *
 * Vécu le 13/08/2026 : demandées « numérotées, une par ligne », les instructions sont
 * revenues en tableau — Zod a refusé toute la recette après un appel vision déjà payé.
 * C'est une variation de FORME, pas une donnée douteuse : la recette était bonne.
 *
 * ⚠️ Si un seul élément n'est pas réductible en texte, on rend la valeur d'ORIGINE : le
 * schéma la refusera avec son message. Fabriquer un « [object Object] » serait pire que
 * l'erreur — ce serait de la fausse donnée présentée comme une étape de recette.
 */
export function aplatirTexte(valeur: unknown, separateur = "\n"): unknown {
  if (!Array.isArray(valeur)) return valeur;
  const lignes = valeur.map(elementEnTexte);
  if (lignes.some((l) => l === null)) return valeur;
  return lignes.join(separateur);
}

/**
 * Un nombre rendu en CHAÎNE (« 4 », « 2,5 ») redevient un nombre.
 *
 * Strictement numérique : « environ 4 » ou « 1/2 » ne sont PAS convertis et le schéma les
 * refuse. Deviner y serait plus grave qu'ailleurs — `servings` met à l'échelle toutes les
 * quantités de la liste d'épicerie, et `qty` EST la quantité.
 */
export function aplatirNombre(valeur: unknown): unknown {
  if (typeof valeur !== "string") return valeur;
  const brut = valeur.trim();
  if (!/^\d+([.,]\d+)?$/.test(brut)) return valeur;
  return Number(brut.replace(",", "."));
}

export const RawParsedRecipeSchema = z.object({
  title: z.string().min(1).max(200),
  servings: z.preprocess(aplatirNombre, z.number().int().min(1).max(50).nullish()),
  imageUrl: z.string().url().nullish(),
  instructions: z.preprocess((v) => aplatirTexte(v, "\n"), z.string().max(20000).nullish()),
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        canonical: z.string().min(1).max(80).nullish(),
        qty: z.preprocess(aplatirNombre, z.number().positive().nullish()),
        unit: z.string().max(30).nullish(),
        note: z.preprocess((v) => aplatirTexte(v, ", "), z.string().max(200).nullish()),
      }),
    )
    .min(1)
    .max(80),
});

/**
 * Décrit un refus de schéma en NOMMANT le champ fautif.
 *
 * Le message brut de Zod (« Expected string, received array ») ne dit pas OÙ : on ne peut
 * ni corriger, ni même savoir quel champ soupçonner. Vécu le 13/08 — un aller-retour entier
 * perdu à deviner. Trois issues suffisent à situer le problème ; le reste est compté.
 */
export function decrireIssuesZod(erreur: z.ZodError, max = 3): string {
  const vues = erreur.issues.slice(0, max).map((issue) => {
    const chemin = issue.path.length > 0 ? issue.path.join(".") : "(racine)";
    return `${chemin} : ${issue.message}`;
  });
  const reste = erreur.issues.length - vues.length;
  return vues.join(" · ") + (reste > 0 ? ` (+${reste} autre(s))` : "");
}

/** Valide la sortie du modèle et la normalise, ou échoue en DISANT quel champ cloche. */
export function analyserSortieRecette(brut: unknown): ParsedRecipe {
  const resultat = RawParsedRecipeSchema.safeParse(brut);
  if (!resultat.success) {
    throw new Error(`Réponse du modèle hors schéma — ${decrireIssuesZod(resultat.error)}`);
  }
  return normalizeParsedRecipe(resultat.data);
}

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
      const norm = normalizeQty(i.qty ?? null, i.unit ?? null, `${i.unit ?? ""} ${i.note ?? ""}`, i.name ?? "");
      const canonical = (i.canonical ?? i.name).toLowerCase().trim();
      return {
        name: i.name,
        canonical: canonical || i.name.toLowerCase().trim(),
        qty: norm.qty,
        unit: norm.unit,
        // Conversion ratée ⇒ on GARDE ce que la source disait, sinon l'information brute
        // est perdue pour toujours (aucune table ne stocke l'unité d'origine).
        note:
          norm.qty === null
            ? noteQuantiteNonConvertie(i.note, i.qty, i.unit)
            : (i.note ?? null),
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

⚠️ LA SOURCE PEUT ÊTRE DANS N'IMPORTE QUELLE LANGUE (beaucoup de reels sont en anglais).
Quoi qu'il arrive, tu réponds en FRANÇAIS :
- "canonical" est TOUJOURS en français, même si la source dit « chicken breast » ou
  « all-purpose flour ». C'est la CLÉ de regroupement de la liste d'épicerie : un
  « chicken breast » anglais et une « poitrine de poulet » française deviendraient deux
  lignes distinctes qui ne fusionneraient jamais.
- "title" et "instructions" sont traduits en français.
- "name" peut garder la formulation de la source si elle est parlante, mais en français
  de préférence.
- Les unités restent celles ANNONCÉES ("cup", "oz", "lb", "tbsp"…) : la conversion est
  faite par le code, pas par toi. Ne convertis JAMAIS toi-même.

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
  return analyserSortieRecette(extractJson(block.text));
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
    return preserveGuessFlag(draft, analyserSortieRecette(extractJson(block.text)));
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

const MEDIA_SYSTEM = `Tu extrais une recette de cuisine depuis une publication de réseau social, en JSON strict.

On te donne, dans l'ordre, tout ou partie de ceci :
- des CAPTURES D'ÉCRAN de la publication : ce sont des images de TEXTE (la légende, la liste
  d'ingrédients). Lis-les mot à mot, c'est la source la plus fiable des quantités ;
- des IMAGES DE LA VIDÉO, en ordre chronologique, prises aux moments où l'écran CHANGE
  (elles sont donc espacées IRRÉGULIÈREMENT : deux images consécutives peuvent être séparées
  d'une seconde comme de vingt) ;
- la DESCRIPTION publiée par l'auteur (texte brut) ;
- une TRANSCRIPTION AUTOMATIQUE de ce qui est DIT à l'oral dans la vidéo.

⚠️ La vidéo est souvent un ENREGISTREMENT D'ÉCRAN du téléphone : certaines de ses images ne
montrent alors aucune cuisine, mais l'interface de l'application avec la LÉGENDE dépliée,
c'est-à-dire un plein écran de texte. Traite ces images-là comme des captures d'écran — lis-les
mot à mot, ce sont elles qui portent les quantités. Ignore ce qui appartient à l'interface
(nombre de mentions J'aime, commentaires, boutons, nom du compte) sauf s'il fait partie de la
recette.

⚠️ LA TRANSCRIPTION EST LA SOURCE LA MOINS FIABLE, et de loin. Elle est produite par
reconnaissance vocale : elle se trompe surtout sur les NOMBRES et les UNITÉS, précisément ce
qui compte le plus ici. Règles STRICTES :
- Elle ne contredit JAMAIS un texte lu à l'écran ni la description. En cas de désaccord,
  l'écrit gagne, toujours.
- Elle sert à COMPLÉTER : un ingrédient ou une étape qu'on n'entend que dans la voix, et
  qu'aucun écrit ne mentionne, peut être ajouté.
- Une quantité qui n'apparaît QUE dans la transcription et dont tu n'es pas certain →
  qty: null. Un « au goût » honnête vaut mieux qu'un nombre mal entendu : toutes les
  quantités de la liste d'épicerie en dépendent.

Comment les combiner :
- Le TEXTE prime sur ce que tu crois voir : la description publiée et le texte LU dans les
  images font foi, dans cet ordre, quand quelque chose se contredit.
- Les images de cuisine servent à reconnaître les ingrédients et à retrouver l'ORDRE des gestes.
- Un texte coupé en plein milieu d'une phrase se poursuit sur l'image suivante : recolle-les
  plutôt que de traiter chacune isolément.
- Un même écran peut apparaître deux fois : ne compte pas deux fois un ingrédient pour autant.

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

⚠️ LA SOURCE PEUT ÊTRE DANS N'IMPORTE QUELLE LANGUE (beaucoup de reels sont en anglais).
Quoi qu'il arrive, tu réponds en FRANÇAIS :
- "canonical" est TOUJOURS en français, même si la source dit « chicken breast » ou
  « all-purpose flour ». C'est la CLÉ de regroupement de la liste d'épicerie : un
  « chicken breast » anglais et une « poitrine de poulet » française deviendraient deux
  lignes distinctes qui ne fusionneraient jamais.
- "title" et "instructions" sont traduits en français.
- "name" peut garder la formulation de la source si elle est parlante, mais en français
  de préférence.
- Les unités restent celles ANNONCÉES ("cup", "oz", "lb", "tbsp"…) : la conversion est
  faite par le code, pas par toi. Ne convertis JAMAIS toi-même.

Réponds UNIQUEMENT avec l'objet JSON.`;

export interface MediaInput {
  /** Images JPEG en base64 (sans préfixe data:), ordre chronologique. Peut être vide. */
  frames: string[];
  /** Captures d'écran de la publication (images de TEXTE). Peut être vide. */
  captures?: string[];
  /** Description publiée avec la vidéo. Peut être vide. */
  caption: string;
  /** Transcription de l'audio. Peut être vide (muette, désactivée ou en échec). */
  transcript?: string;
}

function blocImage(data: string): Anthropic.ContentBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data } };
}

/** Extrait une recette d'une vidéo, de captures d'écran et/ou d'une description. */
export async function parseRecipeFromMedia(input: MediaInput): Promise<ParsedRecipe> {
  const caption = input.caption.trim().slice(0, MAX_CAPTION_CHARS);
  const captures = input.captures ?? [];
  const content: Anthropic.ContentBlockParam[] = [];

  // Les captures d'abord, étiquetées : sans ça, le modèle traite une image de texte comme
  // une image de cuisine et se met à décrire l'écran au lieu de le LIRE.
  if (captures.length > 0) {
    content.push({
      type: "text",
      text: `${captures.length} CAPTURE(S) D'ÉCRAN de la publication ci-dessous — lis le texte qu'elles contiennent :`,
    });
    content.push(...captures.map(blocImage));
  }

  if (input.frames.length > 0) {
    content.push({
      type: "text",
      text: `${input.frames.length} IMAGE(S) DE LA VIDÉO ci-dessous, en ordre chronologique :`,
    });
    content.push(...input.frames.map(blocImage));
  }

  const transcript = (input.transcript ?? "").trim().slice(0, MAX_TRANSCRIPT_CHARS);
  if (transcript) {
    content.push({
      type: "text",
      text:
        "TRANSCRIPTION AUTOMATIQUE de la bande sonore (reconnaissance vocale, ERREURS " +
        "FRÉQUENTES sur les chiffres et les unités — ne l'utilise jamais pour contredire " +
        `un écrit) :\n${transcript}`,
    });
  }

  const rien = captures.length === 0 && input.frames.length === 0;
  content.push({
    type: "text",
    text: caption
      ? `DESCRIPTION PUBLIÉE :\n${caption}`
      : rien
        ? "Aucune image ni description fournie."
        : "Aucune description n'a été fournie : appuie-toi sur les images ci-dessus.",
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
  return analyserSortieRecette(extractJson(block.text));
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
    return preserveGuessFlag(draft, analyserSortieRecette(extractJson(block.text)));
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
