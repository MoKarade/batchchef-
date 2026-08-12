// lib/partage.ts — ce que BatchChef reçoit quand Android partage vers lui (Web Share Target).
//
// Le partage Android arrive en trois champs libres (`title`, `text`, `url`) dont le
// remplissage dépend de l'app source : Instagram met souvent TOUT dans `text`, la Galerie
// n'envoie que le fichier. Ces fonctions PURES démêlent ça une fois pour toutes.
//
// ⚠️ Les trois constantes ci-dessous sont dupliquées dans `public/sw.js` (un service worker
// est un fichier statique : il ne peut rien importer d'ici). C'est `tests/partage.test.ts`
// qui verrouille l'égalité — une divergence casserait le partage EN SILENCE, la page ne
// trouvant simplement rien à lire dans le cache.

/** Nom du Cache Storage où le service worker dépose ce qui vient d'être partagé. */
export const CACHE_PARTAGE = "batchchef-partage";
/** Clé du fichier vidéo dans ce cache. */
export const CLE_VIDEO = "/__partage/video";
/** Clé des métadonnées (titre, texte, url) dans ce cache. */
export const CLE_META = "/__partage/meta";

export interface PartageRecu {
  titre?: string | null;
  texte?: string | null;
  url?: string | null;
}

export interface PartageNormalise {
  /** Lien http(s) trouvé, sinon null. */
  lien: string | null;
  /** Texte partagé, débarrassé du lien quand celui-ci y était noyé. */
  description: string;
}

const MOTIF_URL = /https?:\/\/[^\s]+/i;

/** Retient une URL seulement si elle est http(s) — même garde que côté serveur. */
function urlHttp(valeur: string | null | undefined): string | null {
  const brut = (valeur ?? "").trim();
  if (!brut) return null;
  try {
    const parsed = new URL(brut);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Démêle un partage Android en { lien, description }.
 *
 * Instagram envoie en général l'URL du reel dans `text` (parfois seule, parfois précédée
 * d'un mot). On la sort du texte pour ne pas la laisser polluer la description envoyée au
 * LLM — mais on ne jette JAMAIS le reste du texte : c'est peut-être la recette.
 */
export function normaliserPartage(recu: PartageRecu): PartageNormalise {
  const texte = (recu.texte ?? "").trim();
  const titre = (recu.titre ?? "").trim();

  // 1) Le champ `url` dédié, quand l'app source le remplit.
  const lienDedie = urlHttp(recu.url);
  if (lienDedie) {
    return { lien: lienDedie, description: joindre(titre, texte) };
  }

  // 2) Sinon, une URL noyée dans le texte.
  const trouve = texte.match(MOTIF_URL);
  const lienTexte = trouve ? urlHttp(trouve[0]) : null;
  if (lienTexte && trouve) {
    const reste = (texte.slice(0, trouve.index ?? 0) + texte.slice((trouve.index ?? 0) + trouve[0].length)).trim();
    return { lien: lienTexte, description: joindre(titre, reste) };
  }

  // 3) Aucun lien : tout ce qui reste est de la description potentielle.
  return { lien: null, description: joindre(titre, texte) };
}

/** Assemble titre et texte sans doublon ni ligne vide (le titre répète souvent le texte). */
function joindre(titre: string, texte: string): string {
  if (!titre) return texte;
  if (!texte) return titre;
  if (texte.includes(titre)) return texte;
  return `${titre}\n${texte}`;
}
