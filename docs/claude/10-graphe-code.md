# 10 — Graphe de code local (graphifyy) : hooks, wiki et MCP

**Statut : déployé le 21/10/2026 (choix de Marc : runbook complet), tâche MoKarade/.github#328, modèle du pilote app-template (#323).** Le graphe est construit à chaque démarrage de session, sans jeton, et interrogé avant de lire ou grepper des fichiers.

## Ce qui est posé
- `scripts/graphe.sh` : seul point d'entrée (version épinglée `graphifyy[sql,mcp]==0.9.93`, venv dans `~/.cache`, `GRAPHIFY_BACKEND=none`). `update`, `query "<question>"`, `affected "<symbole>"`, `path "A" "B"`, `explain "<symbole>"`, `god-nodes`, `wiki`, `serve`, `session`, `hook-guard`, `usage`.
- `.claude/settings.json` : hook `SessionStart` (rend `graphify` utilisable dans la session via `CLAUDE_ENV_FILE`, puis construit le graphe ET le wiki EN ARRIÈRE-PLAN, sans jamais bloquer ni échouer) ; hooks `PreToolUse` sur `Bash|Grep` et `Read|Glob` (rappel « interroge le graphe d'abord », silencieux tant que le graphe n'existe pas ; échec ouvert).
- `.mcp.json` : serveur MCP `graphify` en stdio (`query_graph`, `get_node`, `get_neighbors`, `get_community`, `god_nodes`, `graph_stats`, `shortest_path`, `list_prs`, `get_pr_impact`, `triage_prs`), à approuver à la première ouverture.
- `graphify-out/` (graphe, rapport, wiki, cache) : généré, JAMAIS committé. Le wiki (`graphify-out/wiki/index.md`) sert de plan de navigation.
- Un pointeur d'une ligne dans `CLAUDE.md` (pas les 11 lignes de l'installeur officiel, qui casseraient le verrou ≤ 60 lignes).

## Règles (chacune vient d'un constat)
- **0 jeton, 0 clé** : `update` est local (Tree-sitter), sans appel réseau ni LLM ; le paquet ne contacte le réseau que pour `add`, `clone` et les commandes LLM. [Certain, code lu et `strace`]
- **Jamais `label` ni `cluster-only` sans `GRAPHIFY_BACKEND=none`** : sans clé API ils se replient sur `claude -p` et consomment le quota Claude. [Certain]
- **N'utilise PAS l'installeur officiel** (`graphify claude install`, `graphify hook install`, skill `/graphify`) : il réécrit `CLAUDE.md`, pose des hooks vers un chemin absolu et la skill lance des sous-agents LLM. Tout passe par `scripts/graphe.sh`. [Certain]
- **`graphify-out/` jamais versionné** : les commentaires `TODO:`/`NOTE:`/`FIXME:` et les docstrings y sont copiés (80 caractères, e-mails compris) ; `graph.html` charge unpkg. Dépôt public : aucune donnée perso dans un commentaire de code. [Certain]
- **Toujours depuis la racine** : `graphify update /chemin/absolu` écrit ce chemin dans `.graphify_root`. [Certain]
- **Version épinglée** : le paquet sort presque une version par jour ; monter la version = relancer la mesure ci-dessous. Sans l'extra `[sql]`, les migrations `.sql` donnent 0 nœud. [Certain]
- **Les hooks de dépôt ne tirent que si la session démarre DANS le dépôt** (constat du 18/10/2026 : un fil du projet lancé depuis `/home/user` ne charge pas `.claude/settings.json`). [Probable] Dans ce cas il reste `scripts/graphe.sh` à la main.
- **Le rappel injecté dit « MANDATORY »** : c'est le texte du paquet, posé par NOTRE hook ; il coûte ~110 jetons par `Grep`/`Bash` quand le graphe existe.

## Ce que ça apporte, ce que ça n'apporte pas (mesure BatchChef, 21/10/2026, 290 fichiers)
- Le « 61,6x » de `graphify benchmark` compare à la lecture de TOUT le dépôt, ce que personne ne fait. Contre `grep` + lecture du fichier utile, sur 4 questions à symbole connu : 12,3 k jetons contre 12,0 k (requête + extrait), aucun gain net ; la requête ramène des nœuds génériques. [Certain pour ces 4 questions, n = 4]
- Ce que `grep` ne donne pas : `affected "X" --depth 2` rend les importeurs transitifs ET les documents qui citent X, avec fichier:ligne. [Certain]
- Les chiffres du document source (71,5x, -80 %, 76 % LongMemEval) viennent du fournisseur, sur d'autres corpus. [Probable]

## Artefact `graphe` pour Hubperso (tâche MoKarade/.github#428, 21/10/2026)
- `.github/workflows/graphe.yml` appelle le workflow commun de `MoKarade/.github` à chaque push sur `master` : artefact Actions `graphe` (`graph.html` filtré de moins de 1 Mo et `meta.json`), conservé 90 jours. Job séparé, jamais un check requis. Format et règles : `docs/graphe-code.md` de `MoKarade/.github`. L'artefact ne contient que des chemins de fichiers et des dossiers.

## Vitesse, profondeur par défaut et journal d'usage (tâche MoKarade/.github#483, 22/10/2026)
- **Délai** : `affected` passe d'environ 1,2 s à environ 0,3 s. `pret()` importait le paquet `mcp` (≈ 850 ms) à CHAQUE appel ; il teste maintenant sa présence par `find_spec` (≈ 20 ms). Le même appel direct de graphify prend ≈ 0,24 s. [Certain, mesuré le 22/10/2026]
- **Profondeur** : `affected` remonte 1 niveau par défaut ; `--depth 2` donne le rayon d'impact complet (importeurs des importeurs). Sur 9 dépôts et 90 symboles (22/10/2026), la sortie est 2 à 3 fois plus courte à la profondeur 1 et le rappel face à grep presque inchangé, mais deux fois moins de fichiers sont cités. Avant une suppression ou un renommage, demander `--depth 2`. [Certain pour la mesure]
- **Journal** : chaque appel `query`, `affected`, `path`, `explain`, `god-nodes` écrit une ligne dans `graphify-out/usage.jsonl` (heure, commande, durée, caractères rendus, branche ; jamais les arguments) et les hooks y comptent leurs passages. `scripts/graphe.sh usage` résume. Il mesure l'usage, pas l'économie de jetons : un hook ne voit pas la sortie des outils et deux sessions ne font pas la même tâche. Local, ignoré par git.
- **Lecture ciblée** : `affected`, `explain` et le MCP donnent des `fichier:Lnn`. Lire alors la zone utile (`Read` avec `offset` et `limit`) plutôt que le fichier entier. Le gain en jetons n'est pas mesuré chez nous. [À vérifier]

## Lecture massive refusée et commentaire d'impact sur chaque PR (tâche batchchef-#369, 29/10/2026, demande de Marc : une obligation mécanique, pas une consigne)
- `scripts/graphe.sh garde-lecture` (hook `PreToolUse` sur `Read|Glob`, copie identique à MoKarade/.github) REFUSE un `Read` sans `offset`, `limit` ni `pages` d'un fichier de plus de 400 lignes ou 40 Ko (hors `.md`, `.txt`, images, PDF, verrous, `*.min.js`) et un `Glob` de tout le dépôt (`**`, `**/*`, `**/*.*`). Le motif du refus cite la commande du graphe à utiliser (`explain`, `affected`, `query`) puis `Read` avec `offset` et `limit`. Échec ouvert (JSON illisible, fichier absent, autre outil : silence). Chaque refus est journalisé (`garde-lecture-refus` dans `graphify-out/usage.jsonl`). Contournement honnête : relire la zone utile avec `offset` et `limit`, jamais désactiver le hook.
- `.github/workflows/impact.yml` appelle le workflow commun `impact-pr.yml` de MoKarade/.github : UN commentaire d'impact par PR (`<!-- impact-graphe -->`, mis à jour sur place) avec, pour chaque fichier de code modifié, le nombre de fichiers qui en dépendent (`affected --depth 2`), les 8 premiers et les tests concernés. Ignoré pour les forks et les robots ; aucun jeton de LLM ; jamais un contrôle requis. Indicatif : un appel dynamique peut manquer.
- Détail et seuils : `docs/graphe-code.md` de MoKarade/.github. Le hook ne se charge que dans une session ouverte DANS ce dépôt.

## Retour arrière
Supprimer `.claude/settings.json` (ou ses trois blocs), `.mcp.json`, `scripts/graphe.sh`, `.graphifyignore`, les deux lignes de `.gitignore` et la ligne de `CLAUDE.md`. Rien d'autre n'a été modifié.

Évaluation : commun/plans/2026-10-21_graphify-analyse.md. Mesure à refaire sur 10 questions réelles après un jour d'usage.
