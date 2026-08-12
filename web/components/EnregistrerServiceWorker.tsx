"use client";

// Enregistre le service worker qui reçoit les partages Android (public/sw.js).
// Sans lui, BatchChef n'apparaît pas dans la feuille de partage du téléphone.
//
// Il ne met RIEN en cache par ailleurs : voir l'en-tête de public/sw.js.

import { useEffect } from "react";

export function EnregistrerServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      // Échec dit, jamais avalé : sans worker, le partage tomberait sur un POST au
      // serveur (405) et l'écran resterait inexplicablement vide.
      console.error("[BatchChef] service worker non enregistré", err);
    });
  }, []);

  return null;
}
