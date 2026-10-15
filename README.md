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

## Google Drive saving
See [docs/google-drive-setup.md](docs/google-drive-setup.md) — needs `VITE_GOOGLE_CLIENT_ID` from the GRB Workspace's Google Cloud project.

## Deploy
Hosted on **Cloudflare Pages**, connected to this GitHub repo: every push to `main` builds and goes live;
other branches get preview URLs.

- Build command `npm run build`, output directory `dist`, Node version from `.nvmrc` (22).
- Custom domain `app.grbhomeimprovements.co.uk` — a CNAME record for `app` in Squarespace DNS pointing at the
  project's `*.pages.dev` address.
- Environment variable `VITE_GOOGLE_CLIENT_ID` (Production and Preview) once the Google project exists — see
  `docs/google-drive-setup.md`. Changing it needs a redeploy.
- `public/_headers` keeps the service worker uncached so installed apps update promptly.

## Data
All rates live in `src/data/rates.json` — benchmarks (£/m² by job + spec), regional multipliers, roof adders, VAT. Regenerate from the Excel master when rates change (see CLAUDE.md).

The full rate library (118 labour/material/waste lines, fees, roof coverings, plant hire) is exported to `src/data/rate-library.json` for the detailed estimator. Download the master from the GRB "Pricing Tool" Drive folder as .xlsx, then run:

```bash
pip install openpyxl
python3 scripts/export-rate-library.py "GRB Home Improvements - Pricing Tool.xlsx"
```

Rates taken from GRB's own invoices are "local actuals" and skip the region/inflation uplift. To keep that flag through a re-export, add a column headed **Local actual** to the Labour & Materials tab and put **Yes** against those rows.

## Structure
- `src/lib/pricing.ts` — quick-quote engine (unit-tested)
- `src/lib/detailed.ts` — detailed-estimate engine; mirrors the workbook's Detailed Estimate tab and its feeder tabs, tests reconcile to the workbook's own example job
- `src/detailed-ui.ts` — detailed-estimate screen (draft autosaves to this device)
- `src/data/detailed-example.json` — the workbook's example job (30 Clowders Road)
- `src/lib/quote-pdf.ts` — branded client quotation PDF (matches GRB's existing quote layout); `src/lib/schedule.ts` — deposit + weekly payment schedule
- `src/data/company.json` — company, contact and bank details printed on quotes; `src/data/quote-example.json` — default letter, scope and notes
- `src/assets/grb-logo.png` — logo used on the PDF
- `src/lib/types.ts` — shared types
- `src/data/rates.json` — rate data
- `src/main.ts` — DOM wiring
- `src/styles.css` — tokenised light/dark theme
