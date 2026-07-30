// lib/googleTasks.ts — création d'une liste de courses COCHABLE dans Google Tasks (compte
// perso de Marc). Une NOUVELLE liste (groupe) par appel. Server-side only : lit le jeton
// d'accès Google depuis la session (auth()), jamais côté client.

import { auth } from "@/auth";

const API = "https://tasks.googleapis.com/tasks/v1";

export interface TasksExportResult {
  ok: boolean;
  error?: string;
  /** Nombre de tâches créées (articles). */
  created?: number;
}

function headers(accessToken: string): HeadersInit {
  return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
}

/** Faut-il proposer à Marc de se reconnecter (scope/jeton manquant) ? */
const RECONNECT = "Reconnecte-toi à Google (bouton en haut) pour autoriser l'écriture dans Google Tasks.";

/**
 * Crée une liste Google Tasks nommée `listTitle` et y insère chaque titre comme tâche
 * cochable. L'ordre d'affichage de Tasks met les nouvelles tâches EN HAUT : on insère donc
 * en ordre inverse pour que la liste se lise de haut en bas comme la liste de courses.
 */
export async function createTaskList(listTitle: string, taskTitles: string[]): Promise<TasksExportResult> {
  const session = await auth();
  const accessToken = session?.accessToken;
  if (!accessToken || session?.tokenError) return { ok: false, error: RECONNECT };
  if (session?.hasTasksScope === false) return { ok: false, error: RECONNECT };

  let listRes: Response;
  try {
    listRes = await fetch(`${API}/users/@me/lists`, {
      method: "POST",
      headers: headers(accessToken),
      body: JSON.stringify({ title: listTitle }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, error: "Google Tasks injoignable — réessaie." };
  }
  if (listRes.status === 401 || listRes.status === 403) return { ok: false, error: RECONNECT };
  if (!listRes.ok) return { ok: false, error: `Google Tasks : création de la liste (HTTP ${listRes.status}).` };

  const list = (await listRes.json()) as { id?: string };
  if (!list.id) return { ok: false, error: "Google Tasks : liste sans identifiant." };

  let created = 0;
  for (const title of [...taskTitles].reverse()) {
    try {
      const r = await fetch(`${API}/lists/${list.id}/tasks`, {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify({ title }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) created += 1;
    } catch {
      // une tâche ratée n'annule pas les autres — compte honnête retourné
    }
  }
  return { ok: true, created };
}
