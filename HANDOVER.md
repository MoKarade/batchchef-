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
| **Assistant** | **Neuf (19/08)** — `/assistant`, Claude fouille la base par outils. ⚠️ Éteint si `ANTHROPIC_API_KEY` absente (dit à l'écran, pas une panne) |
| Widget hub | `GET /api/hub/summary`, contrat `@mokarade/hub-contract` |
| Accès | Google mono-adresse + interrogation du hub (`lib/accesHub.ts`) |
| Analytics | `@vercel/analytics` posé. ⚠️ **Ne collecte rien tant que Web Analytics n'est pas activé dans le tableau de bord Vercel** — geste de Marc |

Production : `batchchef.hubperso.com` (Vercel, projet `batchchef-glu8`).
Gate : `typecheck` · `lint` · `test` · `build`. **258 tests**, 23 fichiers (19/08/2026).

## Ce qui vient d'être livré (17/08/2026)

- **`BOT-01` — l'assistant.** Onglet `/assistant` : Claude fouille les recettes et le
  catalogue par outils, en plusieurs allers-retours. Il cite le numéro de ce qu'il a lu et
  dit explicitement quand il compose.
- **`ING-02` — les quantités.** Perte mesurée de **58 % → 28 %** sur 50 unités réelles. La
  cause n'était pas la couche soupçonnée : la table d'unités connaissait mieux l'anglais que
  le français (`cloves` OK / `gousses` perdu). Dérive d'arrondi corrigée au passage (399,9 g
  au lieu de 400), et `stick` désambiguïsé par le nom (un bâton de cannelle valait 113 g).
- **`ING-01` — sel, poivre et eau** hors de la liste d'épicerie. Automatique, aucune liste à
  tenir, et l'écart est DIT sous la liste en nommant les ingrédients.
- **Retrait du stock de portions et du garde-manger.** Livrés le matin même, retirés le
  soir : Marc n'en veut pas. Le batch redevient `planifié → courses → cuisine → terminé`,
  sans suite. Les tables `portions` et `pantry` sont supprimées (migration `0008`).
- **Compteur d'accueil** (`ACC-01`, conservé) : il additionnait les articles non cochés de
  TOUS les batchs, terminés compris.
- **Verrou du socle visuel** (`web/tests/theme.test.ts`) après la régression texte blanc sur
  blanc signalée par Marc le 14/08.
- **Web Analytics** (PR #44), remise sur `master` après dix commits de dérive.

## Prochaine chose prévue

Rien d'engagé — les trois demandes du 17/08 sont livrées.

⚠️ **L'assistant n'a jamais été essayé contre la vraie API** : cette session n'a pas de
réseau vers Anthropic. Le protocole, les bornes et le classement sont testés ; la boucle
elle-même ne l'est qu'à la lecture. Premier vrai usage = premier vrai test.

## ⚠️ Ce que le correctif des unités NE rattrape PAS

Constaté le 19/08 en vérifiant, pas en supposant : **l'unité brute n'est stockée nulle
part** (les trois tables d'ingrédients ne gardent que `g`/`ml`/`unite`). Conséquences :

| | rattrapé par le correctif FR/EN ? |
|---|---|
| Recettes importées AVANT le 19/08 | **Non** — le mot « gousses » a été perdu à l'import, aucune donnée ne permet de le reconstituer. Seule une ré-importation de la recette la retrouverait. |
| Catalogue (10 188) | **Oui, mais il faut le rebâtir** : `npm run catalog:import` relit `data/batchchef.seed.db` (24 Mo, toujours versionné) qui porte les unités d'origine. ⚠️ Le script fait `delete` puis ré-insère — commande sur la base de PRODUCTION, à faire valider par Marc. |
| Listes d'épicerie déjà créées | **Non** — sel et poivre y restent : le filtre s'applique à la création du batch. |
| Tout ce qui arrive maintenant | Oui. |

Depuis le 19/08, une conversion ratée CONSERVE ce que la source disait dans `note`
(`noteQuantiteNonConvertie`) : Marc lit « 2 cans » au lieu d'un « au goût » muet, et la
PROCHAINE amélioration de la table sera rattrapable. Le trou ci-dessus ne se recreusera pas.

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
