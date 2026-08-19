// Le protocole de l'assistant : ce qui se décide SANS réseau ni base.
//
// Tout ce qui est ici est pur et testé — bornes de conversation, validation des arguments
// d'outils, mise en forme des résultats. La boucle d'appels et les requêtes SQL vivent à
// côté (`boucle.ts`, `outils.ts`), et c'est ce découpage qui rend l'assistant vérifiable.

export type Role = "user" | "assistant";

export interface Message {
  role: Role;
  contenu: string;
}

/** Longueur d'un message envoyé par Marc. Au-delà, ce n'est plus une question. */
export const MAX_CARACTERES_MESSAGE = 4000;

/**
 * Nombre de messages CONSERVÉS dans l'historique envoyé au modèle.
 *
 * ⚠️ Une borne sur une entrée qui CROÎT se TRONQUE, elle ne REJETTE pas. L'historique
 * d'un chat est ré-envoyé en entier à chaque tour : le refuser au-delà de N casserait la
 * conversation en silence dès l'usage normal (leçon JobAI, chat mort après 20 messages).
 */
export const MAX_MESSAGES_HISTORIQUE = 20;

/**
 * Nombre maximum d'allers-retours d'outils pour UNE question.
 *
 * Marc a choisi que Claude interroge la base lui-même : il peut donc creuser, et il faut
 * une borne, sinon une question mal posée boucle jusqu'au mur de la plateforme. Atteindre
 * la borne n'est PAS une erreur — c'est une réponse partielle, et elle est DITE.
 */
export const MAX_TOURS_OUTILS = 8;

/** Résultats rendus par un appel d'outil. Borne les jetons, pas la recherche. */
export const MAX_RESULTATS_RECHERCHE = 25;

/**
 * Budget de temps de la boucle, en millisecondes.
 *
 * ⚠️ La vraie borne n'est pas le nombre de tours, c'est le MUR DE LA PLATEFORME : la route
 * déclare `maxDuration = 60`, et huit allers-retours à quelques secondes chacun peuvent le
 * dépasser. Au-delà du mur, Vercel tue la fonction — Marc reçoit une erreur de plateforme
 * illisible, après avoir payé tous les appels déjà faits.
 *
 * On s'arrête donc AVANT, avec assez de marge pour rédiger une réponse honnête. Compter les
 * tours ne suffit pas : un tour peut prendre deux secondes comme quinze.
 */
export const BUDGET_MS = 45_000;

/**
 * Tronque l'historique en préservant l'invariant du protocole Messages : la séquence
 * envoyée commence par un tour `user` et alterne.
 *
 * ⚠️ Un `slice(-N)` naïf peut couper sur un `assistant` : l'API refuse alors la requête
 * entière, et le chat meurt exactement au moment où la conversation devient intéressante.
 * On coupe donc sur une frontière qui PRÉSERVE l'alternance.
 */
export function tronquerHistorique(
  messages: readonly Message[],
  max: number = MAX_MESSAGES_HISTORIQUE,
): Message[] {
  const propres = messages.filter((m) => m.contenu.trim().length > 0);
  if (propres.length <= max) return [...propres];
  const coupe = propres.slice(propres.length - max);
  // Si la coupe commence par une réponse d'assistant, on jette ce premier message :
  // il répondrait à une question que le modèle ne verrait plus.
  return coupe[0]?.role === "assistant" ? coupe.slice(1) : coupe;
}

/**
 * Valide ce que Marc vient d'écrire.
 *
 * Un message vide n'est pas une erreur à afficher, c'est un geste sans effet ; un message
 * démesuré est refusé en DISANT la limite, jamais tronqué en silence — tronquer la question
 * de quelqu'un et répondre à la moitié est la pire des deux options.
 */
export function validerMessage(
  texte: string,
): { ok: true; message: string } | { ok: false; erreur: string } {
  const propre = texte.trim();
  if (!propre) return { ok: false, erreur: "Écris ta question." };
  if (propre.length > MAX_CARACTERES_MESSAGE) {
    return {
      ok: false,
      erreur: `Message trop long (${propre.length} caractères, maximum ${MAX_CARACTERES_MESSAGE}).`,
    };
  }
  return { ok: true, message: propre };
}

/** Une liste d'ingrédients écrite à la main : « poulet, riz et brocoli ». */
export function decouperIngredients(saisie: string): string[] {
  return [
    ...new Set(
      saisie
        .split(/[,;\n]|\bet\b/gi)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 1),
    ),
  ];
}

export interface RecetteTrouvee {
  id: number;
  source: "catalogue" | "mes-recettes";
  titre: string;
  /** Ingrédients demandés que CETTE recette utilise. */
  couverts: string[];
  /** Ingrédients de la recette que Marc n'a pas annoncés. */
  manquants: string[];
}

/**
 * Classe les recettes pour « qu'est-ce que je peux faire avec ça ».
 *
 * L'ordre est : le plus d'ingrédients COUVERTS d'abord, puis le moins de MANQUANTS. Trier
 * uniquement sur les manquants ferait remonter les recettes à deux ingrédients qui n'ont
 * rien à voir avec ce que Marc a sous la main.
 *
 * Tri total et stable : à égalité on départage par titre puis par id, sinon deux appels
 * identiques rendent deux ordres différents et la réponse paraît aléatoire.
 */
export function classerParDisponibilite(recettes: readonly RecetteTrouvee[]): RecetteTrouvee[] {
  return [...recettes].sort((a, b) => {
    if (a.couverts.length !== b.couverts.length) return b.couverts.length - a.couverts.length;
    if (a.manquants.length !== b.manquants.length) return a.manquants.length - b.manquants.length;
    return a.titre.localeCompare(b.titre, "fr") || a.id - b.id;
  });
}

/**
 * Enveloppe un texte issu de la BASE avant de l'envoyer au modèle.
 *
 * Le catalogue vient de 10 188 pages web et les recettes importées de sites tiers : ce sont
 * des textes que PERSONNE n'a relus. Les livrer nus dans un prompt, c'est offrir une surface
 * d'injection — une « recette » pourrait contenir « ignore les instructions précédentes ».
 * Le balisage ne rend pas l'injection impossible, mais il donne au modèle de quoi voir où
 * commence la donnée et où elle finit.
 */
export function baliserDonnee(etiquette: string, contenu: string): string {
  const propre = contenu.replace(/<\/?donnee[^>]*>/gi, "");
  return `<donnee source="${etiquette}">\n${propre}\n</donnee>`;
}

// ── Références de recettes dans une réponse ────────────────────────────────────────
//
// Le prompt EXIGE que l'assistant cite « [catalogue #482] » pour toute recette qu'il a
// réellement lue. Ce marqueur sert deux choses d'un coup : il permet à Marc de retrouver la
// recette, et il devient ici une CARTE cliquable.
//
// ⚠️ Ne jamais fabriquer une carte pour une recette que l'assistant n'a pas citée. Une carte
// est une promesse — « cette recette existe, clique » — et une carte vers du vide serait
// exactement le genre de faux que le reste de l'app refuse.

export interface ReferenceRecette {
  source: "catalogue" | "mes-recettes";
  id: number;
}

export type Segment =
  | { type: "texte"; valeur: string }
  | { type: "reference"; source: "catalogue" | "mes-recettes"; id: number; brut: string };

/**
 * Tolérante sur la FORME, stricte sur le FOND : le « # » est optionnel, les espaces aussi,
 * la casse est ignorée — un modèle varie sur ces détails et jeter une référence juste
 * priverait Marc de la carte. Mais la source doit être l'une des deux connues, et l'id un
 * entier : on ne devine pas.
 */
const MOTIF_REFERENCE = /\[\s*(catalogue|mes-recettes)\s*#?\s*(\d+)\s*\]/gi;

/** Découpe une réponse en texte et références, dans l'ordre, sans rien perdre. */
export function decouperReponse(texte: string): Segment[] {
  const segments: Segment[] = [];
  let curseur = 0;
  for (const trouve of texte.matchAll(MOTIF_REFERENCE)) {
    const debut = trouve.index ?? 0;
    if (debut > curseur) segments.push({ type: "texte", valeur: texte.slice(curseur, debut) });
    segments.push({
      type: "reference",
      source: trouve[1]!.toLowerCase() === "catalogue" ? "catalogue" : "mes-recettes",
      id: Number(trouve[2]),
      brut: trouve[0],
    });
    curseur = debut + trouve[0].length;
  }
  if (curseur < texte.length) segments.push({ type: "texte", valeur: texte.slice(curseur) });
  return segments;
}

/** Les références d'une réponse, dédoublonnées, dans l'ordre d'apparition. */
export function referencesDe(texte: string): ReferenceRecette[] {
  const vues = new Set<string>();
  const refs: ReferenceRecette[] = [];
  for (const seg of decouperReponse(texte)) {
    if (seg.type !== "reference") continue;
    const cle = `${seg.source}#${seg.id}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    refs.push({ source: seg.source, id: seg.id });
  }
  return refs;
}
