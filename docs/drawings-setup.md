# Price from drawings — setup

The Estimate tab's **Price from drawings** card sends the architect's drawings (PDFs or photos) to Claude,
which reads them and returns a quantity takeoff against GRB's rate library. The app turns that into a draft
estimate (labour days, materials, roof / electrics / plumbing packages, plant, skips, fees) plus notes:
measurements, assumptions and things to check on site. The estimator checks every line before quoting.

It runs in a Cloudflare Pages Function (`functions/api/takeoff.ts`, `functions/_lib/takeoff.ts`), like the
Xero link. It needs signal and a GRB Google sign-in (the same one as Google Drive).

## One-off setup (about 5 minutes)

1. **Anthropic API key.** Sign in at <https://console.anthropic.com> (create an account for GRB if needed),
   add a payment method under **Billing**, then **API keys → Create key**. Name it `GRB Quick Quote`.
   Copy the key — it is shown once. Don't paste it anywhere else.
2. **Cloudflare.** Workers & Pages → `grb-quote-app` → **Settings → Variables and Secrets → Add**:
   - Type: **Secret**
   - Name: `ANTHROPIC_API_KEY`
   - Value: the key
   - Environment: Production
3. **Redeploy** (Deployments → latest → ⋯ → Retry deployment) so the function picks up the secret.

## Cost

Each read is one call to Claude (Opus, high effort). A typical 2–4 sheet planning set costs
roughly 10–40p. Set a monthly spend limit in the Anthropic console (**Settings → Limits**) if you want a cap.

## How it prices

- Only the proposed works are priced; cost figures printed on drawings are ignored.
- Labour in days per trade; materials in rate-library units; footings in-house; roof, electrics and plumbing
  as subcontracted packages; plant, skips and fees at cost — the same rules as a hand-built estimate.
- Contingency stays at 12% (pre-drawings) until you tick **Drawings & spec confirmed**.
- The notes box overrides the drawings (e.g. "client supplies kitchen", "premium spec", "no parking").

## Troubleshooting

| Message | Fix |
| --- | --- |
| "not set up on the server (Anthropic API key)" | Add the secret above and redeploy. |
| "Connect Google Drive on the Quotes tab first" | Connect Drive with the @grbhomeimprovements.co.uk account. |
| "too large together (20 MB limit)" | Send fewer sheets, or export the PDF at a lower resolution. |
| "busy" / "failed" | Try again in a minute. |
