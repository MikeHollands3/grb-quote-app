# GRB Quick Quote

Offline-first mobile PWA for on-site ballpark quoting — GRB Builders (London) Ltd.
Client-side only: no server, no database. Installs to the home screen and runs with no signal.

## Stack
Vite + TypeScript + vite-plugin-pwa. No framework (plain DOM) — small and fast. Swap in Svelte/React later if the UI grows.

## Develop
```bash
npm install
npm run dev        # local dev server
npm run test       # pricing engine unit tests (vitest)
npm run build      # production build -> dist/ (service worker + manifest generated)
npm run preview    # preview the built app
```

## Deploy
`dist/` is a static bundle. Host anywhere static: Cloudflare Pages, Vercel, Netlify, or a folder behind nginx. HTTPS is required for the service worker / install.

## Data
All rates live in `src/data/rates.json` — benchmarks (£/m² by job + spec), regional multipliers, roof adders, VAT. Regenerate from the Excel master when rates change (see CLAUDE.md).

The full rate library (118 labour/material/waste lines, fees, roof coverings, plant hire) is exported to `src/data/rate-library.json` for the detailed estimator. Download the master from the GRB "Pricing Tool" Drive folder as .xlsx, then run:

```bash
pip install openpyxl
python3 scripts/export-rate-library.py "GRB Home Improvements - Pricing Tool.xlsx"
```

## Structure
- `src/lib/pricing.ts` — pure pricing engine (unit-tested)
- `src/lib/types.ts` — shared types
- `src/data/rates.json` — rate data
- `src/main.ts` — DOM wiring
- `src/styles.css` — tokenised light/dark theme
