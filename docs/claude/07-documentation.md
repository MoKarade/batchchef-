# Documentation, où vit quoi (ancien §8)

> Repris mot pour mot de l'ancien `CLAUDE.md` (lignes 555 à 579). Index : [`docs/INDEX.md`](../INDEX.md).

## 8. Documentation (où vit quoi)

- **`HANDOVER.md`** — état courant, **à lire en premier** à chaque reprise.
- `BACKLOG.md` — tâches, chacune avec sa case, cochée au merge. ⚠️ Un item peut être périmé.
- `docs/LESSONS.md` — ce qui a été appris en le vivant · `docs/adr/` — décisions verrouillées.

⚠️ Doc périmée = pire que pas de doc.

| Fichier | Contenu |
|---|---|
| `README.md` · `web/README.md` | À quoi sert l'app, pour un lecteur extérieur. |
| `CLAUDE.md` | Ce fichier. Se charge à **chaque session** → il reste **court**. |
| `HANDOVER.md` | L'état RÉEL : ce qui tourne, ce qui reste à poser. À lire en premier. |
| `BACKLOG.md` | Ce qui est décidé mais pas fait. |
| `docs/adr/` | Décisions architecturales, `NNNN-slug.md`. |
| `docs/LESSONS.md` | Les leçons détaillées. Elles vont là, pas dans ce fichier. |

⚠️ **Doc périmée = pire que pas de doc.** Le 19/08/2026, trois fichiers annonçaient encore un
« login Google mono-adresse » alors qu'`web/auth.ts` a deux étages depuis l'étape 2 — et le
commentaire d'`auth.ts` disait déjà l'inverse, en toutes lettres. Mettre à jour la doc touchée
dans la MÊME PR que le code.

⚠️ **Un chiffre au présent rote.** `docs/LESSONS.md` cite ses nombres de tests dans des récits
**datés** : c'est le bon usage, à garder.

