// Réparation des noms d'ingrédients hérités du catalogue V3.
//
// LE DÉFAUT, trouvé au premier usage réel du MCP le 19/08 — pas par un test, mais en lisant
// une vraie sortie. Le catalogue de 10 188 recettes affichait :
//
//     « À Soupe De Persil »   ← « 1 cuillères à soupe de persil haché »
//     « Ousses D'Ail »        ← « 1 gousses d'ail »
//     « S De Sel »            ← « 1 pincées de sel »
//
// L'outil de l'app V3 retirait la quantité et l'unité du texte source, mais son unité était
// mal bornée : il a retiré « cuillères » alors que l'unité est « cuillères à soupe », il a
// reconnu « g » À L'INTÉRIEUR de « gousses », et il a retiré « pincée » au singulier en
// laissant le « s » du pluriel. Trois façons de rater la même chose : une frontière de mot.
//
// POURQUOI ÇA COMPTE, et pourquoi ce n'est pas cosmétique : `canonical` est la CLÉ DE
// REGROUPEMENT de la liste d'épicerie. « à_soupe_de_persil » et « persil » sont deux clés
// distinctes, donc deux lignes qui ne fusionnent jamais — on achète le persil deux fois.
// Mesuré sur le corpus : 2 371 entrées abîmées sur 15 389, dont 965 rejoignent un
// ingrédient DÉJÀ présent une fois réparées.
//
// POURQUOI RÉPARER LE NOM ABÎMÉ plutôt que reconstruire depuis le texte source : les deux
// marchent (mesuré, 2 371/2 371 dans les deux cas), mais le dégât est un PRÉFIXE, donc il se
// retire sans rien consulter. Cette voie n'a besoin ni du fichier seed ni d'une commande :
// elle tourne au déploiement. La reconstruction depuis la source donnait en prime des noms
// plus VARIABLES (« Persil Haché » ici, « Persil Frais » là, selon la recette tirée au sort),
// ce qui aurait re-fragmenté ce qu'on cherche justement à fusionner.
//
// Module PUR : aucune base, aucun réseau.

/** Les trois formes de dégât, chacune ancrée en TÊTE — c'est là et nulle part ailleurs. */
const REGLES_NOM: { motif: RegExp; par: string }[] = [
  // « cuillères à soupe de persil » → l'unité mangée laisse « à soupe de … ».
  { motif: /^À (?:Soupe|Café|Cafe|Thé|The) (?:De |D'|D’)/i, par: "" },
  // Même chose sans liaison : « À Soupe Persil ».
  { motif: /^À (?:Soupe|Café|Cafe|Thé|The) /i, par: "" },
  // « g » reconnu dans « gousses » : il ne manque que la première lettre.
  { motif: /^Ousses\b/i, par: "Gousses" },
  // « pincée » retiré au singulier : le « s » du pluriel est resté seul.
  { motif: /^S (?:De |D'|D’)/i, par: "" },
];

/** Mêmes règles, sur la clé de regroupement (minuscules, mots joints par `_`). */
const REGLES_CANONIQUE: { motif: RegExp; par: string }[] = [
  { motif: /^à_(?:soupe|café|cafe|thé|the)_(?:de_|d'|d’)/i, par: "" },
  { motif: /^à_(?:soupe|café|cafe|thé|the)_/i, par: "" },
  { motif: /^ousses(?=_|$)/i, par: "gousses" },
  { motif: /^s_(?:de_|d'|d’)/i, par: "" },
];

/**
 * Ce nom porte-t-il l'un des trois dégâts ?
 *
 * Sert de PRÉDICAT DE SÉLECTION : la réparation ne touche que ce qui est détectablement
 * abîmé, et laisse les 13 000 entrées saines exactement comme elles sont. Élargir la
 * détection re-fragmenterait des regroupements qui marchent aujourd'hui.
 */
export function estNomAbime(nom: string): boolean {
  return REGLES_NOM.some((r) => r.motif.test(nom));
}

function appliquer(valeur: string, regles: { motif: RegExp; par: string }[]): string {
  for (const { motif, par } of regles) {
    const neuf = valeur.replace(motif, par);
    if (neuf !== valeur) return neuf.trim();
  }
  return valeur;
}

/**
 * Répare un nom d'affichage. Rend le nom INCHANGÉ s'il n'est pas abîmé — donc idempotent :
 * réparer deux fois donne le même résultat, ce qui permet de rejouer la passe sans risque.
 *
 * ⚠️ Ne rend JAMAIS une chaîne vide : si le retrait ne laisse rien (« À Soupe De »), on
 * garde l'original. Un nom vide sur une liste d'épicerie est pire que le nom abîmé — il ne
 * dit même plus quoi acheter.
 */
export function reparerNom(nom: string): string {
  const repare = appliquer(nom.trim(), REGLES_NOM);
  return repare.length > 0 ? repare : nom;
}

/** Même réparation, sur la clé de regroupement. Mêmes garanties. */
export function reparerCanonique(canonique: string): string {
  const repare = appliquer(canonique.trim(), REGLES_CANONIQUE);
  return repare.length > 0 ? repare : canonique;
}
