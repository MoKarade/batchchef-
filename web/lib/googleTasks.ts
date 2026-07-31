// lib/googleTasks.ts — liste de courses COCHABLE dans Google Tasks (compte perso de Marc).
// Un batch = une liste Google Tasks RÉUTILISÉE d'un export à l'autre (id stocké sur
// `batches.googleTaskListId`) : réexporter après avoir ajouté des articles met à jour la
// même liste au lieu d'en créer une nouvelle à chaque clic. Si la liste a été supprimée
// côté Google entre-temps, on en recrée une (jamais un échec silencieux). Server-side only :
// lit le jeton d'accès Google depuis la session (auth()), jamais côté client.
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

function normalizeTitle(t: string): string {
  return t.trim().toLowerCase();
}

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
  return { ok: true, id: list.id };
}

/**
 * Réutilise `existingListId` si elle existe encore côté Google ; sinon (jamais exportée,
 * ou supprimée entre-temps) en crée une nouvelle. Ne fait jamais échouer l'export à cause
 * d'une liste disparue — c'est un repli, pas une erreur pour l'utilisateur.
 */
async function ensureTaskList(
  accessToken: string,
  existingListId: string | null,
  listTitle: string,
): Promise<ListResult> {
  if (existingListId) {
    try {
      const r = await fetch(`${API}/users/@me/lists/${existingListId}`, {
        headers: headers(accessToken),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) return { ok: true, id: existingListId };
      if (r.status !== 404) {
        const body = await r.text().catch(() => "");
        console.error("[tasks] vérification de liste existante échouée", r.status, body);
      }
    } catch {
      // Panne réseau sur la vérification : on retente une création plutôt que d'échouer.
    }
  }
  return createTaskListOnly(accessToken, listTitle);
}

/** Titres déjà présents dans la liste (cochés ou non) — évite de dupliquer un article déjà exporté. */
async function listExistingTaskTitles(accessToken: string, listId: string): Promise<Set<string>> {
  const titles = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const url = new URL(`${API}/lists/${listId}/tasks`);
    url.searchParams.set("showCompleted", "true");
    url.searchParams.set("showHidden", "true");
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    let res: Response;
    try {
      res = await fetch(url, { headers: headers(accessToken), signal: AbortSignal.timeout(15000) });
    } catch {
      break; // best-effort : mieux vaut risquer un doublon qu'un export bloqué
    }
    if (!res.ok) break;
    const data = (await res.json()) as { items?: Array<{ title?: string }>; nextPageToken?: string };
    for (const item of data.items ?? []) {
      if (item.title) titles.add(normalizeTitle(item.title));
    }
    pageToken = data.nextPageToken;
    pages += 1;
  } while (pageToken && pages < 5);
  return titles;
}

export async function upsertTaskList(
  listTitle: string,
  taskTitles: string[],
  existingListId: string | null,
): Promise<TasksExportResult> {
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

  const list = await ensureTaskList(accessToken, existingListId, listTitle);
  if (!list.ok) return list;

  const existingTitles = await listExistingTaskTitles(accessToken, list.id);
  const toCreate = taskTitles.filter((t) => !existingTitles.has(normalizeTitle(t)));

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
