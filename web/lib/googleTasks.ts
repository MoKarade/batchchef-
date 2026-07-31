// lib/googleTasks.ts — création d'une liste de courses COCHABLE dans Google Tasks (compte
// perso de Marc). Une NOUVELLE liste (groupe) par appel. Server-side only : lit le jeton
// d'accès Google depuis la session (auth()), jamais côté client.
//
// Erreurs DIAGNOSTIQUES : chaque échec dit précisément lequel des maillons cloche (jeton,
// scope, projet Google Cloud) et remonte le message d'erreur de Google — souvent explicite
// (« API pas activée dans ce projet », « insufficient authentication scopes »…).

import { auth } from "@/auth";

const API = "https://tasks.googleapis.com/tasks/v1";

export interface TasksExportResult {
  ok: boolean;
  error?: string;
  /** Nombre de tâches AJOUTÉES (les articles déjà présents dans la liste ne sont pas dupliqués). */
  created?: number;
  /** Id de la liste Google Tasks utilisée (nouvelle ou réutilisée) — à persister sur le batch. */
  listId?: string;
}

type ListResult = { ok: true; id: string } | { ok: false; error: string };

function headers(accessToken: string): HeadersInit {
  return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
}

/** Extrait le message d'erreur lisible d'une réponse d'erreur Google (JSON {error:{message}}). */
function googleError(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string; status?: string } };
    return j.error?.message ? `Google : ${j.error.message}` : "";
  } catch {
    return body.slice(0, 200);
  }
}

export async function createTaskList(listTitle: string, taskTitles: string[]): Promise<TasksExportResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Session absente — reconnecte-toi." };
  if (session.tokenError) {
    return { ok: false, error: `Jeton Google en erreur (${session.tokenError}) — clique « Reconnecter Google ».` };
  }
  if (!session.accessToken) {
    return { ok: false, error: "Aucun jeton Google (accessToken absent) — clique « Reconnecter Google »." };
  }
  if (session.hasTasksScope === false) {
    return {
      ok: false,
      error:
        "Permission Tasks non accordée : le consentement Google n'a pas inclus les tâches. Clique « Reconnecter Google » et coche/accepte l'accès à tes tâches.",
    };
  }
  const accessToken = session.accessToken;

async function createTaskListOnly(accessToken: string, listTitle: string): Promise<ListResult> {
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
  if (!listRes.ok) {
    const body = await listRes.text().catch(() => "");
    console.error("[tasks] création de liste échouée", listRes.status, body);
    const g = googleError(body);
    if (listRes.status === 401) return { ok: false, error: `Jeton Google refusé (401). ${g} — reconnecte-toi.` };
    if (listRes.status === 403) {
      return {
        ok: false,
        error: `Accès refusé (403). ${g} — vérifie que l'API « Google Tasks » est activée dans LE MÊME projet Google Cloud que ton client OAuth, puis « Reconnecter Google ».`,
      };
    }
    return { ok: false, error: `Google Tasks : HTTP ${listRes.status}. ${g}` };
  }

  const list = (await listRes.json()) as { id?: string };
  if (!list.id) return { ok: false, error: "Google Tasks : liste créée sans identifiant." };

  let created = 0;
  for (const title of [...toCreate].reverse()) {
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
  return { ok: true, created, listId: list.id };
}
