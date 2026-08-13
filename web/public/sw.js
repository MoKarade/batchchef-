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
const CLE_CAPTURE_PREFIXE = "/__partage/capture/";

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
  // ⚠️ `mode === "navigate"` N'EST PAS UN DÉTAIL. Une Server Action de Next POSTe vers l'URL
  // de la PAGE COURANTE : depuis /partage, l'analyse de la vidéo poste donc elle aussi vers
  // /partage. Sans ce test, ce worker l'avale et répond une redirection 303 au lieu du
  // résultat — le navigateur affiche « An unexpected response was received from the server »
  // et RIEN n'atteint le serveur (journaux vides, diagnostic à l'aveugle : vécu le 13/08).
  // Le POST d'un Web Share Target est une NAVIGATION ; un fetch() de Server Action, non.
  // Logique identique à `doitIntercepterPartage` dans lib/partage.ts, verrouillée par test.
  if (event.request.method !== "POST") return;
  if (url.pathname !== "/partage") return;
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      const destination = new URL("/partage?recu=1", self.location.origin);
      try {
        const form = await event.request.formData();
        const cache = await caches.open(CACHE_PARTAGE);

        // Un nouveau partage repart de zéro : sinon les captures du partage précédent
        // seraient recollées à celui-ci, et la recette mélangerait deux publications.
        for (const cle of await cache.keys()) {
          if (new URL(cle.url).pathname.startsWith(CLE_CAPTURE_PREFIXE)) await cache.delete(cle);
        }

        // Tri par TYPE, pas par nom de champ : Android range parfois une image dans le
        // champ « video » (certaines apps ne proposent qu'un seul champ fichier). Se fier au
        // nom du champ perdrait la capture en la traitant comme une vidéo illisible.
        const fichiers = [...form.getAll("video"), ...form.getAll("captures")].filter(
          (f) => typeof f !== "string" && f.size > 0,
        );
        const captures = fichiers.filter((f) => (f.type || "").startsWith("image/"));
        const video = fichiers.find((f) => !(f.type || "").startsWith("image/"));

        if (video) {
          await cache.put(
            CLE_VIDEO,
            new Response(video, {
              headers: { "content-type": video.type || "video/mp4" },
            }),
          );
        } else {
          // Un partage sans vidéo ne doit pas ressusciter celle du partage précédent.
          await cache.delete(CLE_VIDEO);
        }

        for (let i = 0; i < captures.length; i++) {
          await cache.put(
            CLE_CAPTURE_PREFIXE + i,
            new Response(captures[i], {
              headers: { "content-type": captures[i].type || "image/jpeg" },
            }),
          );
        }

        const meta = {
          titre: form.get("title") || "",
          texte: form.get("text") || "",
          url: form.get("url") || "",
          aVideo: Boolean(video),
          nom: video ? video.name || "video.mp4" : "",
          type: video ? video.type || "video/mp4" : "",
          captures: captures.map((f, i) => ({
            cle: CLE_CAPTURE_PREFIXE + i,
            nom: f.name || `capture-${i}.jpg`,
            type: f.type || "image/jpeg",
          })),
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
