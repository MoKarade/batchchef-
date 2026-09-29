// labels.mjs — les labels dont la fusion automatique a besoin existent-ils dans le dépôt ? Création IDEMPOTENTE, échec fermé. `gh` est injectable.
//
// Pourquoi pas `gh label create --force` : mesuré le 28/09 sur un vrai dépôt, `--force` SANS --color remet la couleur au hasard, et avec --color/--description il
// écrase ceux d'un label déjà personnalisé par un chef. Ici on LISTE d'abord, on ne crée QUE les labels absents (sans --force) : un label existant n'est jamais touché.
// Une création qui échoue (et le label est toujours absent après relecture) LÈVE une erreur : jamais un silence qui continue sans le label.
// Aucune fonction de ce fichier ne RETIRE un label : `do-not-merge` n'est jamais levé automatiquement (retrait manuel seulement).
import { LABEL_FREIN, LABEL_VALIDATION } from "./autoMerge.mjs";

/** Label des issues d'alerte, lues par le gérant et le cockpit (`gh issue list --label alerte-auto-merge`). */
export const LABEL_ALERTE = "alerte-auto-merge";

/** Définition de chaque label (couleur hexadécimale à 6 caractères, description ≤ 100 caractères). Ordre = ordre de création. */
export const LABELS = Object.freeze({
  [LABEL_FREIN]: Object.freeze({ couleur: "B60205", description: "Ne pas fusionner : retrait MANUEL seulement (jamais levé automatiquement)" }),
  [LABEL_VALIDATION]: Object.freeze({ couleur: "FBCA04", description: "La fusion attend la validation de Marc" }),
  [LABEL_ALERTE]: Object.freeze({ couleur: "B60205", description: "Alerte de la fusion automatique (lue par le gérant et le cockpit)" }),
});

const noms = (texte) => new Set(String(texte).split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l !== ""));   // GitHub : noms de labels sans casse

/**
 * Crée les labels ABSENTS parmi `voulus`, sans jamais toucher un label existant.
 * @param {(args: string[]) => string} gh  `gh` (déjà lié au dépôt : soit par `cible`, soit par le répertoire courant de l'appelant)
 * @param {string[]} cible  arguments de ciblage ajoutés à chaque appel (`["--repo", "MoKarade/atelier"]`, ou `[]`)
 * @param {string[]} voulus  noms de labels (clés de LABELS)
 * @returns {{crees: string[], presents: string[]}}
 * @throws {Error} lecture des labels impossible, nom inconnu, ou création échouée alors que le label reste absent
 */
export function assurerLabels(gh, cible = [], voulus = Object.keys(LABELS)) {
  const lire = () => {
    try { return noms(gh(["label", "list", ...cible, "--limit", "1000", "--json", "name", "--jq", ".[].name"])); }
    catch (e) { throw new Error(`labels : lecture impossible (${String(e && e.message).slice(0, 80)})`); }
  };
  let existants = lire();
  const crees = [], presents = [], echecs = [];
  for (const nom of voulus) {
    const def = LABELS[nom];
    if (!def) throw new Error(`labels : nom inconnu ${JSON.stringify(nom)}`);
    if (existants.has(nom.toLowerCase())) { presents.push(nom); continue; }
    try {
      gh(["label", "create", nom, ...cible, "--color", def.couleur, "--description", def.description]);   // SANS --force
      crees.push(nom);
    } catch (e) {
      existants = lire();                                                                                      // course : un autre passage l'a peut-être créé entre-temps
      if (existants.has(nom.toLowerCase())) presents.push(nom);
      else echecs.push(`${nom} (${String(e && e.message).slice(0, 80)})`);
    }
  }
  if (echecs.length) throw new Error(`labels : création impossible : ${echecs.join(" ; ")}`);
  return { crees, presents };
}

/** Le refus vient-il d'un label do-not-merge DÉJÀ présent sur la PR (raison générique de peutArmer/decision) ? Alors aucun commentaire : voir fusionner.mjs. */
export const raisonLabelDejaPose = (raison) => raison === `label ${LABEL_FREIN}`;

/** Corps du commentaire posé sur une PR refusée. Le motif d'un frein VISUEL est dit précisément : il ne doit jamais ressembler à un do-not-merge posé à la main pour une faille. */
export function corpsRefus(raison, marqueur, texteSur) {
  const r = texteSur(raison);
  if (String(raison).startsWith("validation visuelle requise")) {
    return `Cette PR ne sera pas fusionnée automatiquement : **validation visuelle de Marc requise** (frein automatique, PAS un problème de sécurité).\n\nRaison : \`${r}\`\n\nLe label \`${LABEL_FREIN}\` a été posé par le kit d'auto-merge parce que la PR touche un chemin de \`chemins_validation_visuelle\`. Il n'est JAMAIS retiré automatiquement : Marc le retire à la main après avoir regardé le rendu. Une attestation de pole-securite ne le lève pas.\n\n${marqueur}`;
  }
  return `Cette PR ne sera pas fusionnée automatiquement.\n\nRaison : \`${r}\`\n\nElle attend l'attestation de pole-securite (revue APPROVED du compte dédié sur ce commit) ; le label \`${LABEL_VALIDATION}\` est informatif.\n\n${marqueur}`;
}
