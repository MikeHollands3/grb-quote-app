# Xero link — setup and how it works

## Pieces
- **Xero app** "GRB Quick Quote" at developer.xero.com — type *Web app*, redirect URI
  `https://app.grbhomeimprovements.co.uk/api/xero/callback`.
- **Cloudflare Pages project `grb-quote-app`** → Settings:
  - Variables and Secrets (Production): `XERO_CLIENT_ID` (text), `XERO_CLIENT_SECRET` (secret).
  - Bindings: KV namespace `grb-xero` bound as `XERO_KV` (holds the Xero connection only — no client data).
- **Server code**: `functions/api/xero/[[route]].ts` + `functions/_lib/xero.ts`, deployed automatically with the app.

## Connecting (once)
App → **Money** → **Connect Xero** → sign in to Xero → choose the GRB organisation → **Allow access**.
You come back to the Money tab showing "Xero connected". The connection is shared by everyone using the app.
It lasts as long as it's used at least every 60 days; if it lapses the card asks you to connect again.

## Day to day
- **Invoices to raise** lists payments whose invoice date has arrived. **Create in Xero** (or **Create all**)
  makes one sales invoice per payment: client as the contact (created if new), reference `CR30/1 – Week 3`,
  VAT-inclusive amount at 20% on the chosen sales account.
- **New invoices: Draft** — review and send from Xero. **Approve + email** — Xero emails the invoice to the
  client immediately (needs the client email on the quote/job).
- **Check payments** (also automatic when you open Money, at most every 10 minutes) marks invoices paid once
  Xero shows them paid — i.e. after you reconcile the bank feed in Xero. Invoices voided in Xero go back to
  "to raise".
- Payment receipts and reminders: use Xero's own settings (Invoice reminders, and "send receipt" when a
  payment is applied).

## Security
The Xero secret and tokens stay in Cloudflare; the browser never sees them. The server only answers requests
carrying a valid Google sign-in from a @grbhomeimprovements.co.uk account issued to this app.
