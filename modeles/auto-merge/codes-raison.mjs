// codes-raison.mjs — codes de raison d'une décision d'auto-merge : liste FERMÉE, en sortie du job (`code_pr_<numéro>`) et lue par les tests.
// Les sept premiers sont repris TELS QUELS de Hubperso#87 (scripts/autoMerge.mjs, CODES_RAISON). Les trois derniers viennent de la spec de
// l'étape 2 (etape2-spec.md) et n'existent que dans un dépôt qui a une attestation, un frein horaire ou un SHA épinglé (l'Atelier) : un dépôt
// qui n'a pas ces mécanismes ne les émet simplement pas — ils ne sont pas inventés là où ils n'ont pas de sens.
export const CODES_RAISON = [
  "merge_ok",
  "brouillon",
  "do_not_merge",
  "controle_en_cours",
  "controle_rouge",
  "etat_fusion",
  "hors_perimetre",
  // spec étape 2, propres à l'Atelier :
  "attestation_requise",
  "frein_horaire",
  "sha_change",
];
