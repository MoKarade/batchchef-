export function etapesDeBuild(env: Record<string, string | undefined>): { etapes: { nom: string; args: string[] }[]; message: string; erreur?: string };
export function cheminSecurise(cheminBrut: string | undefined): string;
