# BatchChef

Planificateur de batch cooking québécois, **100 % en ligne** : Next.js (Vercel) +
Neon Postgres + LLM. Colle des recettes (ou pige dans le catalogue), compose des batchs,
génère une liste d'épicerie avec budget estimé, cuisine aux bonnes quantités.

L'application vit entièrement dans **[`web/`](web/)** — voir **[`web/README.md`](web/README.md)**
pour le démarrage, la configuration et le déploiement.

> Les anciennes versions (V2/V3 : FastAPI + Celery + scrapers Playwright + OCR de reçus)
> ont été retirées lors de la refonte « 100 % en ligne ». Plus de scraping anti-bot, plus
> de reçus : les prix d'épicerie sont **estimés** (LLM + filet déterministe, couverture 100 %).

## Structure

- `web/` — l'app Next.js (App Router, Server Components/Actions), Drizzle + Neon, Auth.js.
- `web/data/batchchef.seed.db` — base seed des 10 188 recettes Marmiton (catalogue).

## Vérifications avant commit

```bash
cd web && npm run typecheck && npm run test && npm run build
```
