/**
 * Server-side Xero link for GRB Quick Quote (Cloudflare Pages Functions).
 *
 * - Only callers with a valid Google access token for a @grbhomeimprovements.co.uk
 *   account (issued to the app's own OAuth client) are served.
 * - The Xero refresh token lives in the XERO_KV namespace; it never reaches the browser.
 * - Xero rotates refresh tokens on every use, so the newest one is always stored.
 */

export interface Env {
  XERO_CLIENT_ID: string
  XERO_CLIENT_SECRET: string
  XERO_KV: KVNamespace
  /** Optional overrides. */
  XERO_REDIRECT_URI?: string
  GOOGLE_CLIENT_ID?: string
}

export const DEFAULT_GOOGLE_CLIENT_ID = '551976286145-qh78tqhsrd7cr9oqv9h28u8k06m1q8ut.apps.googleusercontent.com'
export const HOSTED_DOMAIN = 'grbhomeimprovements.co.uk'
export const DEFAULT_REDIRECT = 'https://app.grbhomeimprovements.co.uk/api/xero/callback'
// Granular scopes required for Xero apps created after 2 March 2026.
export const XERO_SCOPES = 'offline_access accounting.invoices accounting.payments.read accounting.contacts accounting.settings.read'

const AUTH_URL = 'https://login.xero.com/identity/connect/authorize'
const TOKEN_URL = 'https://identity.xero.com/connect/token'
const API = 'https://api.xero.com'

export type Fetch = typeof fetch

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

interface Connection {
  refreshToken: string
  tenantId: string
  tenantName: string
  connectionId: string
  connectedBy: string
  connectedAt: string
}

// ---------- Google sign-in check ----------

/**
 * Returns the caller's email, or throws 401/403.
 * The app's Google token has only drive.file + calendar.app.created scopes (no "email"), so
 * tokeninfo proves which app it was issued to, and Drive's about.get (allowed by drive.file)
 * says whose it is.
 */
export async function verifyGoogle(req: Request, env: Pick<Env, 'GOOGLE_CLIENT_ID'>, f: Fetch = fetch): Promise<string> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Sign in with Google first.')
  const res = await f(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`)
  if (!res.ok) throw new HttpError(401, 'Google sign-in has expired — sign in again.')
  const info = (await res.json()) as { aud?: string; azp?: string }
  const clientId = env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID
  if (info.aud !== clientId && info.azp !== clientId) throw new HttpError(403, 'That Google sign-in is not for this app.')
  const who = await f('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: `Bearer ${token}` } })
  if (!who.ok) throw new HttpError(401, 'Google sign-in has expired — sign in again.')
  const email = (((await who.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? '').toLowerCase()
  if (!email.endsWith(`@${HOSTED_DOMAIN}`)) throw new HttpError(403, `Only @${HOSTED_DOMAIN} accounts can use this from the app (signed in as ${email || 'unknown'}).`)
  return email
}

// ---------- OAuth ----------

const redirectUri = (env: Env) => env.XERO_REDIRECT_URI || DEFAULT_REDIRECT

export async function startUrl(env: Env, email: string): Promise<string> {
  if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) throw new HttpError(500, 'Xero is not configured on the server (client id/secret missing).')
  const state = crypto.randomUUID()
  await env.XERO_KV.put(`state:${state}`, JSON.stringify({ email }), { expirationTtl: 600 })
  const q = new URLSearchParams({ response_type: 'code', client_id: env.XERO_CLIENT_ID, redirect_uri: redirectUri(env), scope: XERO_SCOPES, state })
  return `${AUTH_URL}?${q}`
}

async function tokenCall(env: Env, body: Record<string, string>, f: Fetch) {
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  })
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }
  if (!res.ok || !json.access_token) throw new HttpError(res.status === 400 ? 409 : 502, `Xero sign-in failed: ${json.error ?? res.status}`)
  return json as { access_token: string; refresh_token: string; expires_in: number }
}

/** Completes the Xero connection after the user approves it. */
export async function finishConnect(env: Env, code: string, state: string, f: Fetch = fetch): Promise<Connection> {
  const saved = await env.XERO_KV.get(`state:${state}`)
  if (!saved) throw new HttpError(400, 'This Xero sign-in link has expired — start again from the app.')
  await env.XERO_KV.delete(`state:${state}`)
  const { email } = JSON.parse(saved) as { email: string }
  const t = await tokenCall(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(env) }, f)
  const res = await f(`${API}/connections`, { headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' } })
  const conns = (await res.json()) as { id: string; tenantId: string; tenantName: string; tenantType: string }[]
  const org = conns.find((c) => c.tenantType === 'ORGANISATION') ?? conns[0]
  if (!org) throw new HttpError(400, 'No Xero organisation was connected.')
  const conn: Connection = {
    refreshToken: t.refresh_token,
    tenantId: org.tenantId,
    tenantName: org.tenantName,
    connectionId: org.id,
    connectedBy: email,
    connectedAt: new Date().toISOString(),
  }
  await env.XERO_KV.put('conn', JSON.stringify(conn))
  await env.XERO_KV.put('access', JSON.stringify({ token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 }), {
    expirationTtl: Math.max(60, t.expires_in - 60),
  })
  return conn
}

export async function getConnection(env: Env): Promise<Connection | null> {
  const raw = await env.XERO_KV.get('conn')
  return raw ? (JSON.parse(raw) as Connection) : null
}

/** A valid Xero access token, refreshing (and storing the rotated refresh token) when needed. */
async function accessToken(env: Env, f: Fetch): Promise<{ token: string; conn: Connection }> {
  const conn = await getConnection(env)
  if (!conn) throw new HttpError(409, 'Xero is not connected.')
  const cached = await env.XERO_KV.get('access')
  if (cached) {
    const a = JSON.parse(cached) as { token: string; expiresAt: number }
    if (a.expiresAt - 60_000 > Date.now()) return { token: a.token, conn }
  }
  let t
  try {
    t = await tokenCall(env, { grant_type: 'refresh_token', refresh_token: conn.refreshToken }, f)
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) {
      await env.XERO_KV.delete('conn') // refresh token revoked or expired (60 days unused)
      throw new HttpError(409, 'The Xero connection has expired — connect Xero again.')
    }
    throw err
  }
  const next = { ...conn, refreshToken: t.refresh_token }
  await env.XERO_KV.put('conn', JSON.stringify(next))
  await env.XERO_KV.put('access', JSON.stringify({ token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 }), {
    expirationTtl: Math.max(60, t.expires_in - 60),
  })
  return { token: t.access_token, conn: next }
}

async function xero<T>(env: Env, f: Fetch, path: string, init: RequestInit = {}): Promise<T> {
  const { token, conn } = await accessToken(env, f)
  const res = await f(`${API}/api.xro/2.0/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Xero-tenant-id': conn.tenantId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const json = (await res.json().catch(() => ({}))) as T & { Message?: string; Elements?: { ValidationErrors?: { Message: string }[] }[] }
  if (!res.ok) {
    const v = json.Elements?.flatMap((e) => e.ValidationErrors ?? []).map((e) => e.Message)
    throw new HttpError(res.status === 401 ? 409 : 502, v?.length ? v.join('; ') : json.Message ?? `Xero error ${res.status}`)
  }
  return json
}

export async function disconnect(env: Env, f: Fetch = fetch) {
  const conn = await getConnection(env)
  if (conn) {
    try {
      const { token } = await accessToken(env, f)
      await f(`${API}/connections/${conn.connectionId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    } catch {
      /* already gone */
    }
  }
  await env.XERO_KV.delete('conn')
  await env.XERO_KV.delete('access')
}

// ---------- invoices ----------

export interface InvoiceRequest {
  /** Stable id (the app's payment id) — used as the Xero idempotency key so retries never duplicate. */
  key: string
  contactName: string
  contactEmail?: string
  date: string
  dueDate: string
  reference: string
  description: string
  /** Inc VAT. */
  amount: number
}

export interface InvoiceResult {
  key: string
  ok: boolean
  invoiceId?: string
  number?: string
  emailed?: boolean
  error?: string
}

export function invoicePayload(r: InvoiceRequest, contactId: string, accountCode: string, status: 'DRAFT' | 'AUTHORISED') {
  return {
    Type: 'ACCREC',
    Contact: { ContactID: contactId },
    Date: r.date,
    DueDate: r.dueDate,
    Reference: r.reference,
    Status: status,
    // Amounts are VAT-inclusive, as on the quote's payment schedule; Xero works out the 20% VAT.
    LineAmountTypes: 'Inclusive',
    LineItems: [{ Description: r.description, Quantity: 1, UnitAmount: Math.round(r.amount * 100) / 100, AccountCode: accountCode, TaxType: 'OUTPUT2' }],
  }
}

async function findOrCreateContact(env: Env, f: Fetch, name: string, email?: string): Promise<{ id: string; email?: string }> {
  const where = encodeURIComponent(`Name=="${name.replace(/"/g, '\\"')}"`)
  const found = await xero<{ Contacts: { ContactID: string; EmailAddress?: string }[] }>(env, f, `Contacts?where=${where}`)
  const c = found.Contacts?.[0]
  if (c) return { id: c.ContactID, email: c.EmailAddress || email }
  const created = await xero<{ Contacts: { ContactID: string }[] }>(env, f, 'Contacts', {
    method: 'POST',
    body: JSON.stringify({ Contacts: [{ Name: name, ...(email ? { EmailAddress: email } : {}) }] }),
  })
  return { id: created.Contacts[0].ContactID, email }
}

export async function createInvoices(
  env: Env,
  items: InvoiceRequest[],
  opts: { accountCode: string; status: 'DRAFT' | 'AUTHORISED'; email: boolean },
  f: Fetch = fetch,
): Promise<InvoiceResult[]> {
  const contacts = new Map<string, { id: string; email?: string }>()
  const out: InvoiceResult[] = []
  for (const r of items) {
    try {
      const key = `${r.contactName}|${r.contactEmail ?? ''}`
      if (!contacts.has(key)) contacts.set(key, await findOrCreateContact(env, f, r.contactName, r.contactEmail))
      const contact = contacts.get(key)!
      const res = await xero<{ Invoices: { InvoiceID: string; InvoiceNumber: string }[] }>(env, f, 'Invoices', {
        method: 'PUT',
        headers: { 'Idempotency-Key': `grb-${r.key}` },
        body: JSON.stringify({ Invoices: [invoicePayload(r, contact.id, opts.accountCode, opts.status)] }),
      })
      const inv = res.Invoices[0]
      let emailed = false
      if (opts.status === 'AUTHORISED' && opts.email && contact.email) {
        await xero(env, f, `Invoices/${inv.InvoiceID}/Email`, { method: 'POST', body: '{}' })
        emailed = true
      }
      out.push({ key: r.key, ok: true, invoiceId: inv.InvoiceID, number: inv.InvoiceNumber, emailed })
    } catch (err) {
      out.push({ key: r.key, ok: false, error: (err as Error).message })
      if (err instanceof HttpError && err.status === 409) break // not connected: no point continuing
    }
  }
  return out
}

/** Xero's JSON dates look like "/Date(1700000000000+0000)/". */
export function xeroDate(d?: string): string | undefined {
  const m = d?.match(/\/Date\((\d+)/)
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10)
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : undefined
}

export interface InvoiceStatus {
  id: string
  number?: string
  status: string
  amountDue: number
  amountPaid: number
  paidOn?: string
}

export async function invoiceStatuses(env: Env, ids: string[], f: Fetch = fetch): Promise<InvoiceStatus[]> {
  const out: InvoiceStatus[] = []
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40)
    const r = await xero<{
      Invoices: { InvoiceID: string; InvoiceNumber?: string; Status: string; AmountDue: number; AmountPaid: number; FullyPaidOnDate?: string }[]
    }>(env, f, `Invoices?IDs=${chunk.join(',')}&summaryOnly=true`)
    for (const inv of r.Invoices ?? [])
      out.push({
        id: inv.InvoiceID,
        number: inv.InvoiceNumber,
        status: inv.Status,
        amountDue: inv.AmountDue,
        amountPaid: inv.AmountPaid,
        paidOn: inv.Status === 'PAID' ? xeroDate(inv.FullyPaidOnDate) : undefined,
      })
  }
  return out
}

export async function checkAccount(env: Env, code: string, f: Fetch = fetch): Promise<string | undefined> {
  const r = await xero<{ Accounts: { Code: string; Name: string }[] }>(env, f, `Accounts?where=${encodeURIComponent(`Code=="${code}"`)}`)
  return r.Accounts?.[0]?.Name
}
