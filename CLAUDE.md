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
4. **Saved quotes (done)** — IndexedDB per device (`src/lib/saved.ts`, Saved tab), export/import JSON, and
   upload to a "GRB Quotes" Google Drive folder (`src/lib/drive.ts`, `src/drive-sync.ts`; browser-only Google
   sign-in, `drive.file` scope, GRB Workspace accounts only — setup in `docs/google-drive-setup.md`).
5. **Deploy** — Cloudflare Pages from GitHub (`main` → production), custom domain app.grbhomeimprovements.co.uk
   (CNAME in Squarespace DNS). Build `npm run build` → `dist`; Node from `.nvmrc`; headers in `public/_headers`.
6. **Jobs & money in (done)** — "Won → job" on a quote (`src/job-from-quote.ts`): start date, stage programme
   with who (team + subbies by name, `src/lib/jobs.ts`), one invoice per payment (deposit on acceptance, weekly
   invoices each programme Monday, due after `termsDays`). Jobs and Money tabs. Part 2 done (`src/jobs-sync.ts`,
   `src/lib/job-google.ts`, `src/lib/gapi.ts`): "GRB Jobs" calendar (one all-day event per stage: who/what/where,
   coloured by trade), "GRB Payments" calendar (unpaid payments on due dates) and a "GRB Jobs & Payments" sheet
   (Payments + Programme tabs, merged by job id so several devices can sync). Scopes: drive.file +
   calendar.app.created only; ids shared across a person's devices via "GRB app settings.json" in the Drive folder.
   Part 3 done — Xero: Cloudflare Pages Functions at `/api/xero/*` (`functions/`; the one approved exception to
   "no backend"). Server keeps the rotating Xero refresh token in KV (`XERO_KV`), secrets in Pages env
   (`XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`), and only serves callers with a GRB Google token for this app's OAuth
   client. Granular scopes (app created after 2 Mar 2026): offline_access accounting.invoices
   accounting.payments.read accounting.contacts accounting.settings.read. Invoices: ACCREC, VAT-inclusive,
   OUTPUT2, account code from the app (default 200), Draft or Approved+email, idempotency key = payment id.
   Money tab: Create in Xero / Create all / Check payments (auto every 10 min when the tab opens).
   Setup: `docs/xero-setup.md`. Typecheck functions with `npx tsc -p functions`.
7. **Price from drawings (done)** — Estimate tab card: upload the architect's PDFs/photos; a Pages Function
   (`functions/api/takeoff.ts`, `functions/_lib/takeoff.ts`) sends them to Claude (model in `MODEL`, structured output
   constrained to the rate-library item names) and returns a takeoff; `src/lib/takeoff.ts` `applyTakeoff()` turns it into
   a draft estimate + notes (measurements, assumptions, questions). Needs `ANTHROPIC_API_KEY` as a Pages secret and the
   GRB Google sign-in. Second approved exception to "no backend". Setup: `docs/drawings-setup.md`.

## Commands
`npm install` · `npm run dev` · `npm run test` · `npm run build` · `npm run preview`
