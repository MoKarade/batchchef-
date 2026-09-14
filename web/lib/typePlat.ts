// lib/typePlat.ts — le TYPE d'une recette (SEM-01). Module PUR : aucune base, aucun réseau.
//
// ⚠️ RIEN DE CECI N'EXISTE DANS LE SEED. Mesuré au chantier catalogue : `meal_type`,
// `difficulty`, `cuisine_type`, `tags_json`, `is_sweet` et `is_vegetarian` sont NULL ou à
// zéro sur les 10 188 recettes. Tout est DÉDUIT du titre et des ingrédients, donc ce module
// produit des ESTIMATIONS — jamais des données. C'est pour ça que `null` est une réponse
// possible, et qu'elle s'affiche « non déterminé » plutôt que de tomber dans la famille la
// plus probable.
//
// Sept familles, arbitrées par Marc le 14/09/2026. La liste est FERMÉE : une huitième
// famille se décide, elle ne s'ajoute pas en passant.

export const FAMILLES = [
  "plat",
  "entree",
  "accompagnement",
  "soupe",
  "salade",
  "dessert",
  "sauce",
] as const;

export type TypePlat = (typeof FAMILLES)[number];

export const LIBELLES: Record<TypePlat, string> = {
  plat: "Plat principal",
  entree: "Entrée et apéro",
  accompagnement: "Accompagnement",
  soupe: "Soupe",
  salade: "Salade",
  dessert: "Dessert",
  sauce: "Sauce et condiment",
};

/** Ce qui a permis de trancher. Sert à l'écran (« estimé ») et au diagnostic. */
export type Voie = "titre" | "titre+ingredients" | "ingredients" | "aucun-signal" | "ambigu";

export interface Verdict {
  /** `null` = non déterminé. On ne devine pas : c'est une estimation, pas une donnée. */
  type: TypePlat | null;
  voie: Voie;
}

export interface RecetteAClasser {
  titre: string;
  /** Noms canoniques des ingrédients, dans n'importe quel ordre. */
  ingredients: readonly string[];
}

/**
 * Forme comparable d'un texte : minuscules, accents et apostrophes retirés, ponctuation
 * réduite à des espaces, et bordé d'espaces pour que la recherche d'un MOT ENTIER soit une
 * simple inclusion.
 *
 * ⚠️ Pas de `\b` : en JavaScript il est ASCII, donc « é » n'est pas un caractère de mot et la
 * frontière n'existe pas là où on l'attend. Le dépôt a déjà payé ce piège deux fois.
 */
export function comparable(texte: string): string {
  return (
    " " +
    String(texte ?? "")
      .toLowerCase()
      // ⚠️ AVANT la normalisation : NFD ne décompose PAS les ligatures, donc « bœuf »
      // devenait « b uf » et cessait d'être reconnu — sur un corpus français où le boeuf est
      // partout. Trouvé par le test, pas par la relecture.
      .replace(/œ/g, "oe")
      .replace(/æ/g, "ae")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/['’]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim() +
    " "
  );
}

/** `true` si l'un des mots figure dans le texte comparable, en MOT ENTIER. */
function porte(texte: string, mots: readonly string[]): boolean {
  return mots.some((m) => texte.includes(` ${m} `));
}

/** Mots qui peuvent précéder le nom du plat sans lui voler la vedette. */
const ARTICLES: readonly string[] = [
  "la", "le", "les", "l", "un", "une", "des", "du", "de", "ma", "mon", "mes", "notre",
  "petite", "petites", "petit", "petits", "grande", "grandes", "grand", "grands", "vraie",
  "veritable", "delicieuse", "delicieux", "super", "bonne", "bon", "meilleure", "meilleur",
];

/** `true` si le mot figure dans le texte comparable. */
function present(texte: string, mot: string): boolean {
  return texte.includes(` ${mot} `);
}

/**
 * `true` si l'un de ces mots OUVRE le titre — premier mot, ou second précédé d'un article.
 *
 * ⚠️ Compté en MOTS, pas en caractères, et c'est le test qui l'a imposé. Une borne en
 * caractères laissait passer « Porc sauce aigre douce » (« sauce » y commence au caractère
 * 5, comme dans « Ma sauce tomate ») : tout premier mot de quatre lettres devenait un
 * article. Un mot de famille en tête NOMME la recette ; le même mot ensuite qualifie un
 * accompagnement — « Poulet rôti sauce vin rouge » est un plat.
 */
function ouvreLeTitre(texte: string, mots: readonly string[]): boolean {
  const suite = texte.trim().split(" ");
  return mots.some((m) => {
    const parts = m.split(" ");
    for (const debut of [0, 1]) {
      if (debut === 1 && !ARTICLES.includes(suite[0] ?? "")) continue;
      if (parts.every((mot, k) => suite[debut + k] === mot)) return true;
    }
    return false;
  });
}

/** Marqueurs SUCRÉS. Choisis pour ne presque jamais mentir : aucun n'a d'usage salé courant. */
const SUCRE: readonly string[] = [
  "sucre", "chocolat", "vanille", "cacao", "sucre glace", "sucre vanille", "nutella",
  "caramel", "sucre en poudre", "cassonade", "sirop d erable", "pepites de chocolat",
  "chocolat noir", "chocolat au lait", "sucre roux", "chocolat blanc", "praline",
];

/**
 * Marqueurs SALÉS, même exigence.
 *
 * ⚠️ La liste a été ÉLARGIE après mesure : « Lasagne de boeuf et d'aubergines », « Burger
 * new-yorkais » et « Gnocchi de pommes de terre à la sauce tomate » tombaient en « non
 * déterminé » faute d'un seul marqueur reconnu. Un ingrédient n'entre ici que s'il n'a pas
 * d'usage sucré courant — « lait de coco » et « riz » en sont exclus pour cette raison.
 */
const SALE: readonly string[] = [
  "oignons", "gousses d ail", "ousses d ail", "bouillon", "lardons", "poulet", "boeuf",
  "porc", "jambon", "gruyere", "fromage rape", "moutarde", "echalotes", "paprika", "cumin",
  "curry", "persil", "poireaux", "courgettes", "saumon", "thon", "chorizo", "parmesan",
  "huile d olive", "poivrons", "champignons de paris",
  "pommes de terre", "mozzarella", "feta", "olives", "origan", "bacon", "saucisses",
  "crevettes", "dinde", "veau", "agneau", "canard", "merguez", "tofu", "lentilles",
  "pois chiches", "haricots rouges", "aubergines", "brocolis", "epinards", "celeri",
  "betterave", "vinaigre balsamique", "sauce soja", "concentre de tomates", "emmental",
  "cornichons", "thym", "laurier", "basilic", "coriandre", "gingembre", "piment",
];

/**
 * Mots de titre par famille. L'ordre compte : la première famille qui matche gagne, donc les
 * plus spécifiques passent avant les plus larges.
 *
 * `tete` = le mot doit être en tête du titre (cf. `TETE_MAX`) pour compter.
 */
const PAR_TITRE: readonly { famille: TypePlat; mots: readonly string[]; tete: boolean }[] = [
  {
    famille: "sauce",
    tete: true,
    mots: ["sauce", "coulis", "vinaigrette", "pesto", "mayonnaise", "aioli", "chutney", "tapenade", "marinade", "beurre blanc", "bechamel", "sauces"],
  },
  {
    famille: "soupe",
    tete: true,
    mots: ["soupe", "veloute", "potage", "gaspacho", "minestrone", "bisque", "consomme", "soupes"],
  },
  { famille: "salade", tete: true, mots: ["salade", "salades", "taboule", "coleslaw"] },
  {
    famille: "dessert",
    tete: false,
    mots: [
      "gateau", "gateaux", "cookies", "brownie", "brownies", "tiramisu", "mousse", "cheesecake",
      "creme brulee", "glace", "sorbet", "macarons", "madeleines", "clafoutis", "panna cotta",
      "buche", "biscuits", "beignets", "churros", "cupcakes", "financiers", "profiteroles",
      "eclairs", "confiture", "compote", "tarte tatin", "pate de fruits", "muffins", "sables",
      "pancakes", "gaufres", "far breton", "canneles", "chouquettes",
      "meringue", "donuts", "riz au lait", "entremets", "fondant", "moelleux", "charlotte",
      "paris brest", "millefeuille", "baba", "pate a tartiner", "truffes", "nougat", "sucettes",
    ],
  },
  {
    famille: "entree",
    tete: false,
    mots: [
      "apero", "aperitif", "bouchees", "feuillete", "feuilletes",
      "bruschetta", "houmous", "tartinade", "samoussa", "samoussas", "nems",
      "rillettes", "oeufs mimosa", "amuse bouche", "canapes", "dips",
    ],
  },
  {
    famille: "accompagnement",
    tete: true,
    mots: ["puree", "frites", "gratin dauphinois", "poelee", "poelees"],
  },
  {
    // ⚠️ EN DERNIER, et c'est le point : ces mots nomment un plat sans ambiguïté, mais ils
    // ne doivent gagner qu'après les familles plus spécifiques — « Salade de gnocchis » est
    // une salade, pas un plat de gnocchis. Ils rattrapent ce que les ingrédients ratent :
    // « Burger new-yorkais » et « Omelette soufflée » ne portaient AUCUN marqueur reconnu.
    famille: "plat",
    tete: false,
    mots: [
      "lasagne", "lasagnes", "burger", "burgers", "gnocchi", "gnocchis", "omelette",
      "risotto", "tajine", "tagine", "chili", "couscous", "paella", "wok", "brochettes",
      "boulettes", "hachis parmentier", "bolognaise", "carbonara", "curry", "blanquette",
      "pot au feu", "bourguignon", "cassoulet", "moussaka", "ratatouille", "quesadillas",
      "fajitas", "burritos", "tacos", "sandwich", "sandwichs", "croque monsieur", "wrap",
      "wraps", "sushi", "sushis", "ramen", "pad thai", "nouilles sautees", "riz saute",
      "rougail", "parmentier", "bricks", "roti", "escalopes", "steak", "cote de boeuf",
    ],
  },
];

/**
 * Titres dont le mot ne dit pas le camp : ce sont les ingrédients qui tranchent.
 *
 * ⚠️ Six d'entre eux y sont ARRIVÉS par la mesure, après avoir produit de vraies erreurs sur
 * l'échantillon : « Flan de thon provençal » passait pour un dessert, « Verrines mascarpone,
 * pommes, caramel » pour une entrée, « Terrine de coquillettes au jambon » pour une entrée.
 * Un mot qui sert des deux côtés de la cuisine française n'appartient à aucune famille.
 */
const AMBIGUS: readonly string[] = [
  "tarte", "tartes", "cake", "crepe", "crepes", "galette", "galettes", "quiche", "quiches",
  "pizza", "creme", "tourte", "chausson", "chaussons", "pain", "brioche", "muffin", "roules",
  "cakes", "flan", "flans", "verrine", "verrines", "toast", "toasts", "terrine", "terrines",
  "crumble", "crumbles", "clafoutis", "bavarois",
];

/**
 * Classe une recette, ou avoue ne pas savoir.
 *
 * L'ordre est : le titre d'abord (il NOMME le plat), les ingrédients ensuite (ils tranchent
 * le camp sucré/salé). Un titre ambigu ne décide jamais seul.
 */
export function classerRecette(r: RecetteAClasser): Verdict {
  const titre = comparable(r.titre);
  const ing = comparable(r.ingredients.join(" "));
  const sucre = porte(ing, SUCRE);
  const sale = porte(ing, SALE);

  for (const { famille, mots, tete } of PAR_TITRE) {
    const trouve = tete ? ouvreLeTitre(titre, mots) : mots.some((m) => present(titre, m));
    if (!trouve) continue;
    // ⚠️ Un camp SUCRÉ franc l'emporte sur une famille salée nommée par le titre. Mesuré :
    // « Frites de cookie » sortait en ACCOMPAGNEMENT. Le titre nomme la forme, les
    // ingrédients disent ce que c'est — et du chocolat ne fait pas un accompagnement.
    // L'inverse n'est PAS vrai : un dessert nommé comme tel reste un dessert, même avec du
    // beurre et des oeufs, parce que ses marqueurs salés sont des faux amis.
    if (famille !== "dessert" && sucre && !sale) {
      return { type: "dessert", voie: "titre+ingredients" };
    }
    return { type: famille, voie: "titre" };
  }

  if (porte(titre, AMBIGUS)) {
    if (sucre && !sale) return { type: "dessert", voie: "titre+ingredients" };
    if (sale && !sucre) return { type: "plat", voie: "titre+ingredients" };
    return { type: null, voie: "ambigu" };
  }

  if (sucre && !sale) return { type: "dessert", voie: "ingredients" };
  if (sale && !sucre) return { type: "plat", voie: "ingredients" };
  return { type: null, voie: "aucun-signal" };
}

/** Les familles qui font un repas — ce que la semaine propose (hors la place du dessert). */
export const FAMILLES_REPAS: readonly TypePlat[] = ["plat", "soupe", "salade"];

/** `true` si ce type peut occuper une des trois places de plat de la semaine. */
export function estRepas(type: TypePlat | null): boolean {
  return type !== null && FAMILLES_REPAS.includes(type);
}

/** Une valeur venue de la base est-elle une famille connue ? Tout le reste est `null`. */
export function estTypePlat(valeur: unknown): valeur is TypePlat {
  return typeof valeur === "string" && (FAMILLES as readonly string[]).includes(valeur);
}

/**
 * Le type qui fait foi : la correction de Marc si elle existe, sinon l'estimation.
 *
 * ⚠️ Une correction VIDE (`null`) n'est pas « pas de correction » — Marc peut vouloir dire
 * « aucune de ces familles ». Les deux se distinguent donc par la PRÉSENCE de la ligne de
 * correction, pas par sa valeur.
 */
export function typeEffectif(
  estime: TypePlat | null,
  correction: { type: TypePlat | null } | null | undefined,
): { type: TypePlat | null; corrige: boolean } {
  if (correction) return { type: correction.type, corrige: true };
  return { type: estime, corrige: false };
}
