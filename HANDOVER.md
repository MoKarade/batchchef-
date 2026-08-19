# HANDOVER — BatchChef

> État courant. **À lire en premier** à chaque reprise de session, et à mettre à jour dans la
> MÊME PR que le code. Une doc périmée est pire que pas de doc.
>
> Créé le 2026-08-17 : le dépôt n'avait aucun document vivant, contrairement à tous les
> autres projets de Marc. Tout ce qu'une session savait mourait avec elle.

## Où en est l'app

Le cycle en place et déployé : **importer une recette → composer un batch → faire
l'épicerie → cuisiner**. Il s'arrête là, volontairement (décision de Marc, 17/08 — voir
« Ce qui vient d'être livré »).

| Domaine | État |
|---|---|
| Import par URL | En service (parse LLM + vérification, Zod) |
| Import vidéo (reel) | En service — enregistrement d'écran partagé depuis Android, images extraites DANS le navigateur, transcription audio en appoint |
| Catalogue | 10 188 recettes, cherchable, paginé |
| Batchs + liste d'épicerie | En service, prix estimés (couverture 100 %) |
| Export Google Tasks | En service |
| Widget hub | `GET /api/hub/summary`, contrat `@mokarade/hub-contract` |
| Accès | Google mono-adresse + interrogation du hub (`lib/accesHub.ts`) |
| Analytics | `@vercel/analytics` posé. ⚠️ **Ne collecte rien tant que Web Analytics n'est pas activé dans le tableau de bord Vercel** — geste de Marc |

Production : `batchchef.hubperso.com` (Vercel, projet `batchchef-glu8`).
Gate : `typecheck` · `lint` · `test` · `build`. **219 tests**, 21 fichiers (17/08/2026).

## Ce qui vient d'être livré (17/08/2026)

- **Retrait du stock de portions et du garde-manger.** Livrés le matin même, retirés le
  soir : Marc n'en veut pas. Le batch redevient `planifié → courses → cuisine → terminé`,
  sans suite. Les tables `portions` et `pantry` sont supprimées (migration `0008`).
- **Compteur d'accueil** (`ACC-01`, conservé) : il additionnait les articles non cochés de
  TOUS les batchs, terminés compris.
- **Verrou du socle visuel** (`web/tests/theme.test.ts`) après la régression texte blanc sur
  blanc signalée par Marc le 14/08.
- **Web Analytics** (PR #44), remise sur `master` après dix commits de dérive.

## Prochaine chose prévue

Trois demandes de Marc (17/08), voir `BACKLOG.md` :
`ING-01` (ne plus faire acheter sel/poivre — automatique, PAS une liste à tenir),
`ING-02` (quantités plus précises), `BOT-01` (chatbot Claude sur la base).

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
