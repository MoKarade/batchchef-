# CLAUDE.md — BatchChef

Planificateur de batch cooking québécois, **100 % en ligne**. Toute l'app vit dans `web/`.

## Documents vivants (tenus dans la MÊME PR que le code)

- **`HANDOVER.md`** — état courant, **à lire en premier** à chaque reprise.
- `BACKLOG.md` — tâches, chacune avec sa case, cochée au merge. ⚠️ Un item peut être périmé.
- `docs/LESSONS.md` — ce qui a été appris en le vivant · `docs/adr/` — décisions verrouillées.

⚠️ Doc périmée = pire que pas de doc.

## Stack

- **Next.js 15** (App Router, Server Components + Server Actions), **Vercel**.
- **Drizzle ORM** + **Neon** (Postgres serverless).
- **Auth.js v5** (Google, mono-adresse `AUTHORIZED_EMAIL`, middleware fail-closed).
- **LLM** (`@anthropic-ai/sdk`) pour le parse de recettes et l'estimation des prix.
- **Tailwind v4**, **Zod**, **vitest**.

## Principes non négociables

- **No fake data.** Un parse douteux est rejeté (Zod), jamais inséré sale. Les prix sont
  des **estimations** (LLM + filet déterministe, couverture 100 %) — jamais présentés comme
  des prix relevés. Pas de scraping, pas de reçus.
- **Pas de scraping, y compris pour les vidéos.** L'import vidéo ne va RIEN chercher chez
  Instagram/TikTok : c'est Marc qui dépose le fichier, la capture d'écran ou la description
  (contenu auquel il a accès), le lien ne sert que de `sourceUrl`. Un jour où l'on voudra
  « juste récupérer la légende depuis l'URL », c'est ce garde-fou qu'on serait en train de
  lever. Trois murs, pas un : ce garde-fou, les conditions d'Instagram (et le risque de faire
  bloquer le compte de Marc en utilisant ses cookies depuis un serveur), et le fait qu'aucune
  API Meta ne rend le média d'un créateur tiers — l'oEmbed officiel rend un code
  d'intégration, jamais un fichier. Corollaire assumé : Instagram ne partageant qu'une URL,
  la voie normale est l'**enregistrement d'écran** que Marc produit lui-même (un seul fichier
  porte les gestes, les quantités affichées ET la légende dépliée), avec en repli les
  captures d'écran et le texte collé.
- **Le schéma tolère la FORME, jamais le FOND — et un refus NOMME le champ.** Un modèle
  varie dans la façon de rendre (instructions en tableau plutôt qu'en texte, nombre en
  chaîne) : ces variations sont normalisées (`aplatirTexte`, `aplatirNombre`), sinon une
  recette juste est jetée après un appel vision déjà payé. Mais on ne devine JAMAIS le fond :
  « environ 4 » ne devient pas `4` (toutes les quantités de l'épicerie s'échelonnent sur
  `servings`), et une étape non réductible en texte fait échouer plutôt que de produire un
  « [object Object] » présenté comme une consigne. Tout refus passe par
  `analyserSortieRecette`, qui dit QUEL champ cloche — le message brut de Zod (« Expected
  string, received array ») ne le dit pas, et coûte un aller-retour entier à deviner.
- **Un service worker n'intercepte QUE des navigations.** Une Server Action de Next POSTe
  vers l'URL de la page COURANTE : depuis `/partage`, l'analyse poste donc elle aussi vers
  `/partage`. Un worker qui teste « POST + bon chemin » l'avale et répond une redirection
  303 au lieu du résultat — le navigateur affiche « An unexpected response was received from
  the server » et **les journaux serveur sont vides**, puisque la réponse a été fabriquée
  dans le téléphone. Diagnostic : « erreur opaque + aucune trace côté serveur » ⇒ regarder le
  worker AVANT l'authentification. Le discriminant est `request.mode === "navigate"`
  (standard Web Share Target), jamais un en-tête interne de Next. Verrouillé des deux côtés
  par `tests/partage.test.ts` (`doitIntercepterPartage` + tripwire sur `sw.js`),
  discrimination prouvée par mutation.
- **Une vidéo se sonde DENSÉMENT et se trie par ÉCRAN, jamais à intervalle fixe.** Mesuré :
  ~12 images réparties sur 30-45 s laissaient une carte de quantité affichée 2 s passer une
  fois sur deux. `lib/video/frames.ts` sonde à la seconde, ne garde qu'une empreinte 8×8 par
  sonde, puis n'extrait en pleine résolution que les écrans distincts. La comparaison se fait
  avec la dernière image GARDÉE, pas la précédente — sinon un défilement lent (la légende) ne
  laisse qu'une seule image. Verrouillé par `tests/video.test.ts`, discrimination prouvée par
  mutation.
- **Une capture d'écran prime sur une image de vidéo.** Le budget d'images
  (`repartirBudget`) sert les captures en premier : elles portent les quantités écrites,
  une image de vidéo ne montre souvent qu'un geste.
- **Un chiffre par défaut se DIT.** Une vidéo n'annonce presque jamais ses portions ; le
  défaut 4 est affiché comme un défaut à corriger (`servingsGuessed`), parce que toutes les
  quantités de la liste d'épicerie sont mises à l'échelle à partir de lui. Même règle pour
  tout futur champ qu'on remplirait faute de source. Idem pour la **provenance**
  (`lib/origine.ts`) : la bibliothèque mélange ce que Marc a apporté et ce qu'il a pioché
  dans le catalogue de 10 188 recettes, et une origine absente rend « Origine non
  enregistrée » — jamais « ajoutée par toi », qui lui attribuerait des recettes qu'il n'a
  jamais choisies.
- **La transcription audio est une source d'APPOINT, jamais un arbitre.** La reconnaissance
  vocale se trompe surtout sur les nombres et les unités — ce qui compte le plus ici. Le
  prompt lui interdit de contredire un écrit (texte à l'écran, description) ; elle ne sert
  qu'à compléter, et une quantité entendue mais incertaine devient `qty: null`. L'audio
  seul ne suffit d'ailleurs pas à lancer une extraction. `GROQ_API_KEY` absente ⇒
  « transcription non configurée » (intégration éteinte), à distinguer d'un échec, qui
  affiche le motif du fournisseur : les confondre les rendrait tous deux invisibles.
- **Le coût publié au hub suit le modèle RÉELLEMENT appelé.** Deux modèles cohabitent
  (texte Haiku, vision Sonnet) : `lib/llmUsage.ts` tarife par modèle. Ajouter une ligne à sa
  table dès qu'un nouveau modèle est utilisé, sinon son coût est compté au tarif d'Haiku.
- **Server-side only.** Fetch, jetons et écritures restent côté serveur ; chaque Server
  Action revérifie la session (`requireSession`).
- **Unités normalisées** au parse (`lib/units.ts` → g/ml/unite ou null « au goût »).
- **La source peut être dans une autre langue ; la sortie est toujours française.** Une
  partie des reels sont en anglais. Deux conséquences non négociables : `lib/units.ts`
  connaît les unités impériales (cup, oz, lb, tbsp…) — sans elles, TOUTES les quantités
  d'un reel anglais tombaient en `null` et la liste d'épicerie sortait sans un chiffre,
  sans une seule erreur affichée ; et le `canonical` est TOUJOURS en français parce que
  c'est la **clé de regroupement** de la liste (« chicken breast » et « poitrine de
  poulet » feraient deux lignes qui ne fusionnent jamais). Un contenant sans taille fixe
  (`can`, `package`, `bunch`) reste `null` : on n'invente pas un poids.
- **Le cycle ne s'arrête pas à « terminé » — et son garde d'idempotence est le STOCK, pas le
  statut.** Terminer un batch fabrique les portions (`terminerBatch`, ADR-0001) ; `setBatchStatus`
  refuse `termine` pour qu'il n'y ait qu'un seul chemin. Refuser sur `status === "termine"` ne
  suffirait pas : `terminé → cuisine → terminé` remet le statut à zéro et créerait un DEUXIÈME
  jeu de portions — l'app annoncerait deux fois plus de repas qu'il n'y en a, ce qui ne se
  découvre qu'en ouvrant un congélateur vide. Le garde est donc « ce batch a-t-il déjà des
  portions ? ». Corollaire pour tout futur garde : se demander quel aller-retour légitime
  RÉOUVRE le chemin, et porter le garde sur ce que l'action PRODUIT.
- **Les repères de conservation ne sont pas un verdict.** 4 jours au frigo, 90 au congélo
  (`REPERE_JOURS`) servent à faire REMONTER ce qui attend, jamais à juger : l'app ne sait rien
  de ce qu'il y a dans la boîte. Le vocabulaire à l'écran dit « au-delà du repère de N jours »,
  jamais « c'est encore bon » ni « périmé ». Et aucune date de péremption n'est calculée — ce
  serait de la donnée fabriquée ; l'âge affiché, lui, est un fait.
- **Fonctions pures testées** pour la logique (agrégation, mise à l'échelle, prix, jetons,
  portions).
- **Planchers de version, jamais redescendus.** `drizzle-orm ≥ 0.45.2` (injection SQL par
  identifiants mal échappés, GHSA-gpj5-g38j-94v9, HIGH), et les `overrides` de `postcss` et
  `sharp` qui ferment des failles que Next épingle lui-même. *Verrou* :
  `web/tests/dependances.test.ts` — il inspecte **toutes** les copies du lockfile, pas
  seulement la racine (Next embarquait sa propre `postcss` 8.4.31 dans son `node_modules`,
  vulnérable et invisible depuis le premier niveau). Discrimination prouvée. Retirer un
  `override` seulement après avoir mesuré `npm audit --omit=dev` → 0.

## Direction visuelle (décision de Marc, 13/08/2026)

**Identité d'app de cuisine, pas de tableau de bord.** Les deux écrans les plus utilisés —
la liste d'épicerie et une recette — se lisent DEBOUT, une main occupée, parfois sous les
néons d'un supermarché.

- **Les couleurs vivent dans `app/globals.css`, en variables, et NULLE PART ailleurs.** Le
  vocabulaire est `.carte` / `.bouton` / `.champ` / `.doux` / `.succes` / `.alerte` /
  `.erreur` (+ `.sur-accent`, `.texte-succes`, `.texte-erreur` pour du texte sans fond).
  Avant, 288 chaînes de classes recopiées réinventaient bordures et gris d'un écran à
  l'autre : c'est ce qui faisait dériver l'ensemble à chaque page ajoutée.
  ⚠️ **Une couleur figée est INVISIBLE à la relecture** : elle est parfaitement lisible dans
  le thème pour lequel on l'a écrite. Vécu le 14/08/2026 — ma passe de refonte a remplacé
  les variantes `dark:bg-stone-900` par des jetons en LAISSANT le `bg-white` en dur qu'elles
  corrigeaient : 21 endroits, fond blanc figé sous un texte clair hérité en thème sombre,
  zéro test rouge, zéro erreur. C'est Marc qui l'a vu sur son téléphone. Un remplacement
  ordonné qui supprime le correctif AVANT l'original laisse toujours ce trou-là.
  *Verrou* : `web/tests/theme.test.ts` — il refuse toute classe de palette Tailwind dans
  `app/`/`components/`/`lib/`, toute variante appliquée au vocabulaire maison
  (`dark:texte-erreur` ne génère rien) ou vide (`dark:` seul), tout `var(--jeton)` inexistant,
  et toute couleur définie en clair mais oubliée en sombre. Portée = `git ls-files` **+** le
  neuf non ignoré (sinon le garde arrive un commit trop tard) ; l'unique exception est
  NOMMÉE classe par classe (la case posée sur une photo, dont le contraste se joue contre
  l'image). Discrimination prouvée par quatre mutations, une par test.
  ⚠️ **Le CSS servi n'est PAS le bon endroit où vérifier.** Tailwind v4 balaie tout le dépôt,
  commentaires et Markdown compris : la prose qui raconte ce bug génère des règles
  `.bg-white` / `.dark\:bg-stone-900` que plus aucun balisage n'utilise. Inerte, mais ça
  ressemble à une rechute. Ce qui tranche est le **HTML servi** (la classe rendue), pas la
  présence d'une règle dans la feuille.
- **L'accent (`--accent`) ne sert QU'À l'action principale.** Ailleurs, il ment sur ce qui
  est cliquable.
- **Navigation en bas sur téléphone** (`components/Navigation.tsx`), en haut à partir de
  `sm`. `estOngletActif` est pure et testée — un onglet allume sa SECTION, `/` est traité à
  part. ⚠️ `env(safe-area-inset-bottom)` + `viewportFit: "cover"` : sans eux la barre passe
  sous la barre de gestes d'Android.
- **Cibles tactiles ≥ 44 px, champs à 16 px** (en dessous, iOS zoome tout seul).
- ⚠️ **Pas de police téléchargée.** `next/font/google` va chercher les fichiers AU BUILD :
  dépendance réseau au déploiement, et tout build hors ligne casse. Les piles système
  donnent déjà le contraste serif (titres) / sans (texte).

## Structure `web/`

| Chemin | Rôle |
|---|---|
| `app/` | routes (recettes, batchs, courses, catalogue, `/api/hub/summary`) |
| `lib/actions.ts` | Server Actions (import, batch, liste, statut, catalogue) |
| `lib/aggregate.ts` | agrégation liste d'épicerie, mise à l'échelle, filet de prix (purs) |
| `lib/llm/` | parse de recette (page web **et** vidéo) + estimation de coûts (Zod, honnête) |
| `lib/video/` | `frames.ts` = sondage/empreintes/budget (PUR, testé) · `capture.ts` = extraction `<video>`+`<canvas>` en 2 passes (repérage 32×32 puis extraction 768 px) **dans le navigateur** (la vidéo ne monte jamais au serveur) |
| `lib/partage.ts` + `public/sw.js` | cible de partage Android (PWA). Le service worker intercepte le POST **côté navigateur** : la vidéo partagée ne transite pas par le serveur |
| `lib/portions.ts` | stock de portions : âge civil (fuseau de Marc), ordre, comptage, validation du rangement (PUR, testé) |
| `lib/db/` | schéma Drizzle + connexion Neon paresseuse |
| `lib/hubSummary.ts` | résumé conforme `@mokarade/hub-contract` (widget hub perso) |
| `data/batchchef.seed.db` | base seed du catalogue (10 188 recettes) |

## Workflow git (décision Marc, 2026-08-12)

Branche `claude/<slug>` → commits en français → push → PR → **Claude merge lui-même**
(squash sur `master`), sans demander. Le gate local + la CI sont les filets ; le merge n'est
pas un point de décision de Marc. Corollaire : tout ce qui doit partir avec le lot (doc,
tests, leçons) est committé AVANT le merge — une PR mergée ne se rattrape pas.

⚠️ Après un squash-merge, GitHub supprime la branche : repartir de `master`
(`git fetch origin master && git checkout -B <branche> origin/master`) avant la tâche
suivante, jamais empiler sur l'historique déjà mergé.

## Vérifications avant commit

```bash
cd web && npm run typecheck && npm run test && npm run build
```

Et, après toute modification de dépendances : `npm audit --omit=dev` doit rendre **0**.
Les quelques avis `moderate` restants sont **dev-only** (chaîne `esbuild` → `drizzle-kit`,
serveur de développement) : ils ne touchent pas la production et `npm audit fix --force`
proposerait de rétrograder Next en 9.x, ce qui casserait l'app.

⚠️ La branche par défaut du dépôt est **`master`**, pas `main` — `main` est une vieille
branche abandonnée qui a divergé. Repartir de `master`.

## Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI

**CI verte ne veut pas dire « en ligne ».** Ce sont deux systèmes indépendants : la CI
juge le code, Vercel construit et sert. Un merge peut passer le gate et ne jamais être
déployé — la branche reste verte, le site continue de servir l'ancien build, et rien
n'est rouge nulle part.

Vécu le 31/07/2026 : quatre projets Vercel ont cessé de créer des déploiements pendant
~3 h (l'intégration Git n'a rien reçu). DriveAI et JobAI ont rattrapé au push suivant ;
BatchChef et Hubperso n'en ont pas eu — leur commit d'en-têtes de sécurité est resté
**cinq jours** en attente sans que personne ne le voie. BatchChef servait toujours des
réponses sans aucun en-tête de sécurité alors que la PR était mergée.

Donc, après un merge qui change ce qui est servi (en-têtes, `next.config.ts`,
middleware, variables de build) : vérifier qu'un déploiement de production a bien été
créé et qu'il est `READY`, puis **contrôler l'effet sur la réponse HTTP réelle** — un
en-tête se lit dans la réponse, il ne se déduit pas du fichier source.

⚠️ **Un merge peut produire ZÉRO déploiement, sans que rien ne soit rouge.** Vécu le
13/08/2026 : le quota partagé étant épuisé, le merge de la PR #42 n'a créé aucun build. La
CI était verte, la PR mergée, `master` à jour — et la production servait toujours le commit
précédent. La vérification n'est donc pas « le déploiement a-t-il réussi ? » mais d'abord
« existe-t-il ? ».

⚠️ **Et le rattrapage n'est PAS « Redeploy ».** Redeploy rejoue le commit du déploiement
EXISTANT, pas le dernier commit de `master` : sur un commit qui n'a jamais été déployé, il
n'y a rien à rejouer, et rejouer le voisin reconstruirait l'ancien code (leçon JobAI, même
famille). Le seul déclencheur fiable est un NOUVEAU push sur `master`. Attention alors à
l'`ignoreCommand` : un commit qui ne touche que `*.md` ou `web/tests/*` serait ignoré — le
commit de rattrapage doit toucher un fichier hors exemptions.

## Style (hérité du CLAUDE.md global de Marc)

- Réponses, commits et docs **en français** (`feat:`, `fix:`, `docs:`…).
- TypeScript strict, pas de `any` silencieux. Erreurs honnêtes, jamais avalées.
- Pas d'emoji dans l'UI ni les docs (sauf demande explicite).
