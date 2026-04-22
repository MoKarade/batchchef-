# Costco Pipeline — Research Notes

> État au 2026-04-22. Sprint P3 du plan `docs/COSTCO_PLAN` — reverse engineering de l'API Costco.

## Ce qu'on a découvert

### 1. API interne GraphQL ✅

**Endpoint** : `POST https://ecom-api.costco.com/ebusiness/product/v1/products/graphql`

**Headers requis** :
```
accept: */*
content-type: application/json
origin: https://www.costco.ca
referer: https://www.costco.ca/
client-identifier: e442e6e6-2602-4a39-937b-8b28b4457ed3     # UUID, stable
costco.env: ecom
costco.service: restProduct
user-agent: Mozilla/5.0 …                                    # Chrome desktop UA
```

**Body** :
```json
{
  "query": "query { products(itemNumbers:[\"4000417306\",\"4000335518\",...], clientId:\"e442e6e6-2602-4a39-937b-8b28b4457ed3\", locale:\"en-ca\", warehouseNumber:\"894\") { catalogData { itemNumber itemId published locale buyable programTypes priceData{price listPrice} attributes{key value} } } }"
}
```

**⚠ Limite critique** : l'API **n'est pas un search** — elle retourne les détails de produits **pour des itemNumbers déjà connus**. Il faut donc d'abord obtenir ces itemNumbers autre part.

### 2. Le vrai search côté Costco

- La page `/s?keyword=eggs` est une **SPA JavaScript** — le HTML initial fait ~300 chars (shell Akamai).
- Le JS client fait un search caché (probablement POST `search.costco.ca/...`) qui retourne les itemNumbers, puis POST GraphQL pour les détails.
- **Ce search est bloqué par Akamai** avec `curl`/`httpx` direct (Access Denied).
- Seul un browser warm-upped (patchright headful) passe Akamai.

### 3. Cookies Akamai critiques

Vus dans le browser warm-up, requis pour les appels ecom-api.costco.com :

```
_abck          # bot manager signal
bm_sz          # session fingerprint
bm_sv          # validation token
bm_s           # session
STORELOCATION  # chosen warehouse (JSON-encoded)
```

Ces cookies expirent après ~30-60 min → faut refresh via browser warm-up périodique.

### 4. 🎯 Sitemap public des produits

**Grande découverte** : Costco expose **tous ses produits** dans des sitemaps XML publics (pas d'Akamai) !

```
https://www.costco.ca/sitemap_lw_index.xml    (index)
  └─ sitemap_lw_p_001.xml       # product URLs, ~1.7 MB
  └─ sitemap_lw_i_001.xml       # ?
  └─ sitemap_lw_c_000.xml       # categories
```

Chaque URL produit suit le format :
```
https://www.costco.ca/{slug}.product.{itemId}.html
                      │                 │
                      │                 └─ numeric ID to feed GraphQL
                      └─ human-readable "bosch-dishwasher-junction-box"
```

## Stratégie d'implémentation

### Recette

```
  ┌──────────────────────┐
  │ Download sitemaps    │  1 fetch (~1.7 MB) every 24h, cache in-memory
  │ → [(itemId, slug)*]  │
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │ Fuzzy search by slug │  "eggs" → matches slug containing "eggs", "oeuf"
  │ returns itemIds[]    │  (use rapidfuzz or simple substring)
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │ Browser warm-up 1x   │  patchright → obtain cookies
  │ export cookies       │  refresh every ~30 min
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │ httpx POST GraphQL   │  with cookies + itemIds → product details
  │ → price + image      │
  └──────────────────────┘
```

### Bénéfices vs DOM scraping actuel

| | Old DOM scrape | Sitemap + GraphQL |
|---|---|---|
| Speed | ~30 s/item | ~1 s/item |
| Reliability | Dépend du DOM | Search 100 % offline |
| Maintenance | Casse quand Costco modifie le DOM | Sitemap + GraphQL = stables |
| Akamai risk | High (search UI) | Low (sitemap public, GraphQL léger) |

## Fichiers livrés (ce sprint)

| Fichier | Status | Rôle |
|---|---|---|
| `backend/scripts/capture_costco_xhr.py` | ✅ | Capture tous les XHR d'un search → `debug/costco/xhr_*.jsonl` |
| `backend/scripts/capture_costco_graphql.py` | ✅ | Capture spécifiquement les req/body GraphQL |
| `backend/scripts/probe_costco_search_html.py` | ✅ | Check si itemNumbers sont dans HTML rendu |
| `backend/scripts/dump_costco_search_html.py` | ✅ | Sauve le HTML complet + grep IDs |
| `backend/app/scrapers/costco_api.py` | 🟡 WIP | Intercepte la GraphQL via browser — ne trouve rien en search (SPA client-side + Akamai) |
| `backend/app/scrapers/costco_sitemap.py` | ⏳ TODO | Download + cache sitemap, fuzzy search offline |
| `backend/app/scrapers/costco.py` | old | Scraper DOM actuel (fail) |

## À faire (continuation du sprint)

1. **Écrire `costco_sitemap.py`** :
   - Download les 3-4 sitemaps pertinents (`_p_001`, `_i_001`, `_l_001`)
   - Parse en mémoire `{itemId: slug}` + index inversé `{token: set(itemIds)}`
   - Fuzzy search `search(query) → [itemId*]`
   - Refresh toutes les 24 h via Celery beat
2. **Adapter `costco_api.py`** :
   - Warm-up browser 1× → cookies en dict partagé
   - Pour chaque `search_costco(query)` :
     - Call sitemap.search(query) → 10 itemIds candidats
     - POST GraphQL avec ces itemIds + cookies
     - Parse la réponse et rank
3. **Fallback scraping DOM** si GraphQL fail (cookies expirés) → refresh cookies + retry
4. **Cache** : Redis 7 j sur chaque `(query, costco)` pour ne pas re-HIT GraphQL

## Schémas GraphQL observés

Un item de `catalogData` :

```json
{
  "itemNumber": "100814276",
  "itemId": "2537531",
  "published": true,
  "locale": "en-CA",
  "buyable": 1,
  "programTypes": "SiteControlledInventory,Standard,ShipIt",
  "priceData": {
    "price": "1699.99000",
    "listPrice": "-1.00000"
  },
  "attributes": [
    {"key": "Brand", "value": "Samsung", "type": "descriptive"},
    {"key": "Connectivity", "value": "Wi-Fi Enabled"},
    {"key": "Dimensions (WxDxH)", "value": "75.9 cm x …"}
  ]
}
```

Note: on n'a pas encore capturé d'item avec un nom court / clean — la clé `ProductName` n'est **pas** dans `attributes` ni top-level de ces captures (c'était des produits home page). Les search results auront probablement d'autres attributes.
