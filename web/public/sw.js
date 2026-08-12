// public/sw.js — service worker MINIMAL, avec un seul rôle : recevoir un partage Android.
//
// Quand Android partage vers BatchChef, il envoie un POST multipart vers /partage. Une page
// Next ne répond pas au POST — et surtout, on ne VEUT pas que la vidéo parte au serveur.
// Ce worker intercepte donc le POST côté navigateur, dépose le contenu dans le Cache
// Storage, et redirige vers /partage en GET : la page lit le cache et travaille en local.
//
// Ce qu'il ne fait PAS, volontairement : aucune mise en cache de pages ni de réponses
// d'API. BatchChef affiche des données personnelles derrière une session ; un cache
// hors-ligne les laisserait sur l'appareil et servirait des écrans périmés.
//
// ⚠️ Les trois constantes ci-dessous DOIVENT rester identiques à celles de `lib/partage.ts`
// (un service worker ne peut rien importer). `tests/partage.test.ts` verrouille l'égalité.

const CACHE_PARTAGE = "batchchef-partage";
const CLE_VIDEO = "/__partage/video";
const CLE_META = "/__partage/meta";

// Prendre la main tout de suite : sans ça, le premier partage après l'installation
// tomberait sur un worker encore en attente et le POST partirait au serveur (405).
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/partage") return;

  event.respondWith(
    (async () => {
      const destination = new URL("/partage?recu=1", self.location.origin);
      try {
        const form = await event.request.formData();
        const cache = await caches.open(CACHE_PARTAGE);
        const fichier = form.get("video");
        const aVideo = fichier && typeof fichier !== "string" && fichier.size > 0;

        if (aVideo) {
          await cache.put(
            CLE_VIDEO,
            new Response(fichier, {
              headers: { "content-type": fichier.type || "video/mp4" },
            }),
          );
        } else {
          // Un partage sans vidéo ne doit pas ressusciter celle du partage précédent.
          await cache.delete(CLE_VIDEO);
        }

        const meta = {
          titre: form.get("title") || "",
          texte: form.get("text") || "",
          url: form.get("url") || "",
          aVideo: Boolean(aVideo),
          nom: aVideo ? fichier.name || "video.mp4" : "",
          type: aVideo ? fichier.type || "video/mp4" : "",
        };
        await cache.put(
          CLE_META,
          new Response(JSON.stringify(meta), {
            headers: { "content-type": "application/json" },
          }),
        );
      } catch (err) {
        // Échec honnête : la page dira « rien reçu » plutôt que d'afficher un formulaire
        // vide qui laisserait croire que le partage a marché.
        destination.searchParams.set("erreur", "1");
        console.error("[BatchChef] partage non enregistré", err);
      }
      return Response.redirect(destination.toString(), 303);
    })(),
  );
});
