# Google setup (Drive saving, and later the jobs calendar and sheet) — one-off

The Saved tab can upload every quote (the PDF plus an editable `.json` copy) to a
**GRB Quotes** folder in the signed-in user's Google Drive. Sign-in happens in the
browser with Google; there is no server. Only `@grbhomeimprovements.co.uk` accounts
are accepted.

The app asks for the `drive.file` permission only: it can see and change the files
it creates itself, never anything else in Drive.

## 1. Create the Google Cloud project (about 10 minutes)

Sign in to <https://console.cloud.google.com> **with a @grbhomeimprovements.co.uk
account** (so the project belongs to the GRB Workspace).

1. **Create a project**, e.g. "GRB Quick Quote".
2. **APIs & Services → Library →** enable each of: **Google Drive API**, **Google Calendar API**,
   **Google Sheets API** (Calendar and Sheets are for the jobs calendar and payments sheet).
3. **Google Auth Platform → Branding** (older consoles: *OAuth consent screen*):
   app name "GRB Quick Quote", support email info@grbhomeimprovements.co.uk.
4. **Audience → User type: Internal.** This limits sign-in to GRB Workspace
   accounts and means Google does not need to review the app.
5. **Data access → Add or remove scopes →** add (paste each into "Manually add scopes"):
   - `https://www.googleapis.com/auth/drive.file` — only files the app creates
   - `https://www.googleapis.com/auth/calendar.app.created` — only calendars the app creates (GRB Jobs)
6. **Clients → Create client → Web application**, name "GRB Quick Quote web".
   Under **Authorised JavaScript origins** add the address the app runs from, e.g.
   - `https://app.grbhomeimprovements.co.uk`
   - `https://grb-quote-app.pages.dev`
   - `http://localhost:5173` (for local testing)

   No redirect URIs are needed.
7. Copy the **Client ID** (ends in `.apps.googleusercontent.com`). It is not a secret.

## 2. Give the app the Client ID

Done: the GRB client ID is built into `src/drive-sync.ts`. `VITE_GOOGLE_CLIENT_ID` only needs setting to
override it (e.g. a test project).

Set `VITE_GOOGLE_CLIENT_ID` when building:

- **Local:** create `.env.local` in the project root containing
  `VITE_GOOGLE_CLIENT_ID=…apps.googleusercontent.com`, then `npm run dev`.
- **Cloudflare Pages:** project → **Settings → Variables and Secrets** → add
  `VITE_GOOGLE_CLIENT_ID` (plain text) for Production, then **Deployments → Retry deployment**
  on the latest one so the build picks it up.

Without it, the Saved tab just says Drive saving isn't switched on; everything
else works.

## 3. Use it

Saved tab → **Connect Google Drive** → choose your GRB account. From then on, every
**Save quote** / **Create PDF quote** uploads automatically (or when signal returns).
Google sign-ins last an hour; after that the next Save briefly re-confirms the
account. **Open folder** jumps to the Drive folder. The folder can be moved into a
shared drive and the app keeps using it.

## 4. Jobs calendar and sheet

Jobs tab → **Google Calendar & Sheet** card → **Allow calendar & sync** (first time only). The app creates:

- **GRB Jobs** calendar — one all-day entry per stage: `CR30/1 · Roof — Top Roofing`, site address as the
  location, who/contact details in the description. Coloured by trade.
- **GRB Payments** calendar — each unpaid payment on its due date (shown as "free" so it doesn't block time).
- **GRB Jobs & Payments** sheet in the GRB Quotes folder — Payments and Programme tabs.

Edit jobs in the app, not in Calendar or the sheet: the app overwrites its own entries on the next sync.

**Share with the team:** in Google Calendar (web) → hover **GRB Jobs** → ⋮ → **Settings and sharing** →
**Share with specific people or groups** (or make it available to everyone at grbhomeimprovements.co.uk).
Same for GRB Payments if the office should see it. Share the sheet from Drive as usual.
