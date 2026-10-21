type Statut = { context?: string; state?: string; description?: string };
export function jugerStatuts(statuts: Statut[] | undefined): { etat: "present" | "echec" | "absent"; detail: string };
export function attendreDeploiement(o: {
  lire: () => Promise<Statut[]>;
  dormir: (ms: number) => Promise<void>;
  essais: number;
  pauseMs: number;
}): Promise<{ etat: "present" | "echec" | "absent" | "illisible"; detail: string; essais: number }>;
