# GRB Quick Quote — build brief for Claude Code

## What this is
An offline-first, mobile-first PWA that gives GRB an on-site ballpark quote in seconds, and
(phase 2) a full detailed estimate that replaces the Excel pricing tool. Single/small-team use.
Client-side only — no server, no DB — so it installs to the home screen and works with no signal.

## Hard constraints
- **Standalone repo.** Do NOT build on or push to `Safe-Hub/Safe-Hub`. This is its own product.
- **Offline-first.** Everything needed to produce a quote must work with no network after first load.
- **No backend** until there is a real need (shared saved quotes across devices / team). Prefer
  client-side storage (IndexedDB) first.
- Align to SafeHub's `CLAUDE.md` conventions (lint, formatting, commit style) once the Safe-Hub
  org grants repo access; until then follow standard Vite/TS defaults.

## Stack
Vite + TypeScript + vite-plugin-pwa. Plain DOM for now (no framework). Vitest for the engine.

## Brand
GRB teal `#007060` (primary), deep teal band `#143a34`. Logo wordmark "GRB / Building & Home
Improvements". Keep the light/dark token system in `src/styles.css`. Drop the real raster logo into
`public/` and reference it in the header when available.

## Pricing rules (must hold in the engine)
- Quick quote = benchmark £/m² (by job + spec) + roof £/m² adder, × regional multiplier, × floor area; VAT (20%) added last. Midpoint = mean of the inc-VAT low/high.
- **Regional uplift applies to labour and locally-sourced materials only** — NOT to nationally-priced
  supply items (kitchens, sanitaryware, premium doors, bi-folds). This matters for the phase-2
  detailed estimator; misapplying it inflates estimates. The quick-quote benchmarks already embed it.
- Contingency: 12% pre-drawings, 8% once drawings + spec confirmed (on direct works). Subcontracted packages
  carry their own 5% contingency on the subbie base cost (not marked up).
- Markup: 20% overhead & profit on direct works (+ contingency).
- Package treatment (GRB practice, deliberately differs from the workbook, which marks up all of section 3):
  footings are **in-house** (part of direct works, so they carry contingency + O&P); roof, electrics and
  plumbing are **subcontracted** (base + 20% subcontract markup); plant hire, waste/skips and other fees
  pass through **at cost**.
- Regional uplift (South London, ×1.30) × inflation is applied to all rate-library rates, as in the workbook;
  plant hire and waste are actual prices and are not uplifted. Rate-library items flagged `local: true`
  (prices from GRB's own South London invoices) are also used as-is — never uplift a local actual.
- All rates live in `src/data/rates.json`. The full 118-line rate library (labour/materials/waste)
  lives in the Excel master in Google Drive — export it to JSON for the detailed estimator; don't
  hand-key it.

## Roadmap
1. **Quick Quote (done in this starter)** — job / spec / area / region / roof -> indicative range.
2. **Detailed estimator (done — mirrors the workbook's Detailed Estimate tab)** — line items from the full rate library (labour days + material quantities),
   groundworks/roof/electrical/plumbing/plant/waste sections, -> net, contingency, markup, VAT.
   Mirror the Excel tabs. Keep the engine pure + tested.
3. **Branded PDF quote (done — `src/lib/quote-pdf.ts`, pdf-lib, lazy-loaded and precached for offline)** — client-side (e.g. pdf-lib / jsPDF), GRB letterhead, payment schedule,
   bank details, matching the existing ReportLab quotation layout.
4. **Saved quotes** — IndexedDB, per-device; export/import JSON. Add a sync backend only if the team
   needs shared access.
5. **Deploy** — static host (Cloudflare Pages / Vercel), HTTPS, custom subdomain.

## Commands
`npm install` · `npm run dev` · `npm run test` · `npm run build` · `npm run preview`
