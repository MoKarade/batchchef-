# Frontend

Next.js 16 + Tailwind + TanStack Query. App Router (`app/` not `pages/`).

> ⚠ **Next.js 16 has breaking changes.** Always read
> `node_modules/next/dist/docs/` and `frontend/AGENTS.md` before writing
> any code that touches routing, layouts, or server components.

## Structure

```
frontend/
├── app/                       # App Router
│   ├── layout.tsx              # Root: <html>, <Providers>, <LayoutShell>
│   ├── providers.tsx           # QueryClientProvider + AuthProvider + ThemeProvider
│   ├── page.tsx                # Dashboard
│   ├── ingredients/page.tsx
│   ├── recipes/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   ├── batches/
│   │   ├── page.tsx
│   │   └── new/page.tsx
│   ├── shopping/page.tsx
│   ├── inventory/page.tsx
│   ├── receipts/page.tsx
│   ├── imports/page.tsx
│   ├── settings/page.tsx
│   ├── login/page.tsx          # V3: redirects to /
│   └── register/page.tsx       # V3: redirects to /
├── components/
│   ├── layout/                 # Sidebar, LayoutShell, ThemeToggle
│   └── features/               # One big component per page (Dashboard, IngredientsPage, etc.)
└── lib/
    ├── api.ts                  # Axios wrapper + all TS types
    ├── auth.tsx                # V3: stub (returns admin user, no-ops)
    ├── ws.ts                   # useJobWebSocket hook
    ├── utils.ts                # formatPrice, categoryEmoji, healthColor, cn
    └── useRefreshOnMount.ts    # Silent price refresh when viewing preview/detail
```

## Key state patterns

- **TanStack Query** for all reads. `queryKey` convention: `["entity", ...filters]`.
- **Mutations** use `useMutation` + `invalidateQueries` on success.
- **WebSocket** subscribed via `useJobWebSocket(jobId, handler)` — handler
  receives `{current, total, status, current_item}` per tick.

## Types

Single source: `lib/api.ts`. Backend Pydantic models are mirrored here by
hand. When a `/api/*` response shape changes, **update the TS type first
or the UI will silently break**.

V3 additions on `IngredientMaster` :

```ts
primary_image_url?: string | null      // From best StoreProduct
primary_store_code?: string | null     // "maxi" | "costco" | …
computed_price_per_kg?: number | null
computed_unit_price?: number | null    // price / kg | L | unite
computed_unit_label?: string | null    // "kg" | "L" | "unite"
```

## Proxy

`next.config.js` rewrites `/api/*`, `/ws/*`, `/uploads/*` to the FastAPI
backend at `http://localhost:8000`. The frontend never hits FastAPI
cross-origin directly.

## Style conventions

- **Tailwind utility classes**, no CSS modules.
- Dark mode via `class` strategy (`<html className="dark">`).
- Icons from **lucide-react** — never add another icon lib.
- Form inputs : `<input className="h-9 w-full rounded-md border …" />`.
  No design system yet.
- Empty states use italicized `text-muted-foreground` paragraphs.

## Adding a page

1. Create `app/<route>/page.tsx` exporting `default function`.
2. Add a route in `components/layout/Sidebar.tsx::NAV_ITEMS`.
3. Create a feature component in `components/features/` — keep it "one
   page, one component" for now. Break down if it grows past ~500 lines.

## Running

```bash
cd frontend && npm run dev     # http://localhost:3000
npm run build                   # production build
npm run lint                    # eslint
```

## Next.js 16 landmines

- **No `next/head`** — use the metadata API in `layout.tsx` / `page.tsx`.
- **Client components** must start with `"use client";` on line 1.
- **Images** : we use plain `<img>` with `eslint-disable-next-line
  @next/next/no-img-element` because `next/image` requires configured
  loaders for external CDNs (Loblaws, OFF). TODO: whitelist domains in
  `next.config.js` for Image.
