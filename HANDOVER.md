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
Gate : `typecheck` · `lint` · `test` · `build`. **238 tests**, 22 fichiers (19/08/2026).

## Ce qui vient d'être livré (17/08/2026)

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

**`BOT-01` — le chatbot Claude sur la base**, seule demande de Marc encore ouverte.
Trois usages : recettes selon les ingrédients disponibles (même incomplets), équivalents
d'ingrédients, création de recette appuyée sur toute la base. Décision de Marc : **Claude
interroge la base LUI-MÊME par outils**, pas un pré-filtre SQL suivi d'un seul appel.

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
