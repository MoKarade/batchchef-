// Types de autoMerge.mjs (décision pure de fusion automatique).
export const LABEL_FREIN: string;
export const LABEL_VALIDATION: string;
export const DEPENDABOT: string;
export const APP_GITHUB_ACTIONS: number;
export const CHEMINS_INTERDITS: readonly string[];
/** Ancien nom de CHEMINS_INTERDITS. */
export const REGLES_FIXES: readonly string[];

export interface FichierPR {
  path?: string;
  filename?: string;
  previous_filename?: string;
  status?: string;
  patch?: string;
}

export interface EntreePR {
  state?: string;
  isDraft?: boolean;
  isCrossRepository?: boolean;
  labels?: { name?: string }[];
  mergeStateStatus?: string;
  baseRefName?: string;
  headRefOid?: string;
  checks?: { name?: string; context?: string; status?: string; conclusion?: string; state?: string; appId?: number | string }[];
  fichiers?: (string | FichierPR)[];
  auteur?: string;
  dernierActeur?: string;
  creeLe?: string;
}

export interface ConfigAutoMerge {
  controles_requis: string[];
  controles_non_bloquants: string[];
  chemins_interdits: string[];
  chemins_label_validation: string[];
  carence_dependabot_jours: number;
  branche_base?: string;
  app_id_requis?: number;
  frein_fusions_par_heure?: number;
  regles_test_associe?: { code: string; test: string }[];
}

export interface ContexteDecision {
  shaAttendu?: string;
  env?: { AUTOMERGE_OFF?: string };
  maintenant?: number | string | Date;
  fusionsHeure?: number;
}

export interface Decision {
  merger: boolean;
  raison: string;
  etiqueter: string[];
  sha?: string;
  /** Catégorie fixe d'un refus notable (test_affaibli, test_associe_manquant, frein_horaire) : sert de modèle aux alertes. */
  code?: string;
}

export function decision(pr: EntreePR | null | undefined, config: ConfigAutoMerge | null | undefined, contexte?: ContexteDecision): Decision;
export function validerConfig(config: unknown): { ok: boolean; erreurs: string[] };
export function normaliser(chemin: unknown): string | null;
export function correspond(chemin: string, motifs: string[]): boolean;

export interface DecisionArmement {
  armer: boolean;
  raison: string;
  etiqueter: string[];
  code?: string;
}
export function peutArmer(pr: EntreePR | null | undefined, config: ConfigAutoMerge | null | undefined): DecisionArmement;

export function testAffaibli(fichiers: (string | FichierPR)[]): string | null;
export function estFichierDeTest(chemin: string): boolean;
