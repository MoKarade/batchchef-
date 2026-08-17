# HANDOVER — BatchChef

> État courant. **À lire en premier** à chaque reprise de session, et à mettre à jour dans la
> MÊME PR que le code. Une doc périmée est pire que pas de doc.
>
> Créé le 2026-08-17 : le dépôt n'avait aucun document vivant, contrairement à tous les
> autres projets de Marc. Tout ce qu'une session savait mourait avec elle.

## Où en est l'app

Le cycle complet est en place et déployé : **importer une recette → composer un batch →
faire l'épicerie → cuisiner → ranger les portions → les manger dans la semaine**.

| Domaine | État |
|---|---|
| Import par URL | En service (parse LLM + vérification, Zod) |
| Import vidéo (reel) | En service — enregistrement d'écran partagé depuis Android, images extraites DANS le navigateur, transcription audio en appoint |
| Catalogue | 10 188 recettes, cherchable, paginé |
| Batchs + liste d'épicerie | En service, prix estimés (couverture 100 %) |
| Export Google Tasks | En service |
| **Stock de portions** | **Neuf (17/08)** — cf. `docs/adr/0001-portions-en-stock.md` |
| Widget hub | `GET /api/hub/summary`, contrat `@mokarade/hub-contract` |
| Accès | Google mono-adresse + interrogation du hub (`lib/accesHub.ts`) |
| Analytics | `@vercel/analytics` posé. ⚠️ **Ne collecte rien tant que Web Analytics n'est pas activé dans le tableau de bord Vercel** — geste de Marc |

Production : `batchchef.hubperso.com` (Vercel, projet `batchchef-glu8`).
Gate : `typecheck` · `lint` · `test` · `build`. **239 tests**, 21 fichiers (17/08/2026).

## Ce qui vient d'être livré (17/08/2026)

- **Le stock de portions.** Terminer un batch ouvre un formulaire de rangement (combien,
  frigo ou congélo), l'onglet « Portions » liste ce qui reste — frigo d'abord, le plus
  ancien en tête — avec un bouton « j'en mange une ». ADR-0001.
- **Verrou du socle visuel** (`web/tests/theme.test.ts`) après la régression texte blanc sur
  blanc signalée par Marc le 14/08.
- **Web Analytics** (PR #44), remise sur `master` après dix commits de dérive.

## Prochaine chose prévue

Le **garde-manger** et le **compteur d'accueil** — décidés par Marc le 17/08, pas encore
livrés. Voir `BACKLOG.md` (`GM-01`, `ACC-01`).

## Pièges à connaître avant de toucher au code

Les non négociables sont dans `CLAUDE.md` (chargé à chaque session). Les trois qui
surprennent le plus :

1. **La branche par défaut est `master`**, pas `main`.
2. **Le service worker n'intercepte QUE des navigations** — sinon il avale les Server
   Actions et le navigateur affiche une erreur opaque, journaux serveur vides.
3. **CI verte ≠ en ligne.** Vérifier qu'un déploiement de production EXISTE, puis son effet
   sur la réponse HTTP réelle.

## Ce qui demande un geste de Marc

- Activer **Web Analytics** dans le tableau de bord Vercel (sinon la dépendance ne mesure rien).
- `GROQ_API_KEY` est posée (transcription audio active).
