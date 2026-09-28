// Types de autoMerge.mjs (décision pure de fusion automatique).
export const LABEL_FREIN: string;
export const LABEL_VALIDATION: string;
export const DEPENDABOT: string;
export const APP_GITHUB_ACTIONS: number;
/** Base générique (ce que reçoit une app). */
export const CHEMINS_BASE: readonly string[];
/** Surcouche du dépôt courant (vide dans une app). */
export const CHEMINS_SURCOUCHE: readonly string[];
/** Base + surcouche. */
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

export interface RevuePR {
  user?: { login?: string | null; id?: number | null } | null;
  state?: string;
  commit_id?: string;
  submitted_at?: string | null;
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
  /** Revues de la PR (gh api pulls/N/reviews) pour l'attestation de pole-securite ; null = lecture ratée. */
  reviews?: RevuePR[] | null;
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
  /** Login du compte dédié de pole-securite (attestation de revue) ; absent ou vide = aucune attestation possible. */
  securite_login?: string;
  /** Identifiant numérique du compte dédié : exigé en plus du login quand il est configuré. */
  securite_user_id?: number;
  /** Chemins de l'app (parmi chemins_interdits) que l'attestation peut lever ; jamais les JAMAIS_ATTESTABLES. */
  chemins_attestables?: string[];
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

/** Le compte dédié `login` a-t-il APPROUVÉ le SHA exact `sha` ? (dernière revue du compte, échec fermé) */
export function attestationValide(reviews: unknown, cible: { login?: string; sha?: string; userId?: number }): boolean;

/** Chemins jamais attestables (secrets, clés). */
export const JAMAIS_ATTESTABLES: readonly string[];
