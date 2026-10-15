import { describe, it, expect } from 'vitest'
import { createInvoices, finishConnect, invoicePayload, invoiceStatuses, startUrl, verifyGoogle, xeroDate, type Env } from './xero'

function fakeKV() {
  const m = new Map<string, string>()
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  } as unknown as KVNamespace & { m: Map<string, string> }
}

const env = (kv = fakeKV()): Env & { XERO_KV: ReturnType<typeof fakeKV> } => ({
  XERO_CLIENT_ID: 'CID',
  XERO_CLIENT_SECRET: 'SECRET',
  XERO_KV: kv,
})

type Handler = (url: string, init: RequestInit) => [number, unknown]
function fake(routes: [string, Handler][]) {
  const calls: { url: string; init: RequestInit }[] = []
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const r = routes.find(([k]) => `${init.method ?? 'GET'} ${url}`.startsWith(k))
    const [status, body] = r ? r[1](url, init) : [500, { Message: `no route ${init.method ?? 'GET'} ${url}` }]
    return new Response(status === 204 ? null : JSON.stringify(body), { status })
  }) as typeof fetch
  return { f, calls }
}

const GID = '551976286145-qh78tqhsrd7cr9oqv9h28u8k06m1q8ut.apps.googleusercontent.com'
const req = (token?: string) => new Request('https://app.example/api/xero/status', { headers: token ? { Authorization: `Bearer ${token}` } : {} })

describe('verifyGoogle', () => {
  const tokeninfo = (info: object, status = 200) => fake([['GET https://oauth2.googleapis.com/tokeninfo', () => [status, info]]]).f

  it('accepts a GRB account token issued to this app', async () => {
    const f = tokeninfo({ azp: GID, email: 'George@grbhomeimprovements.co.uk', email_verified: 'true' })
    expect(await verifyGoogle(req('t'), env(), f)).toBe('george@grbhomeimprovements.co.uk')
  })
  it('rejects missing, expired, other-app and non-GRB tokens', async () => {
    await expect(verifyGoogle(req(), env(), tokeninfo({}))).rejects.toMatchObject({ status: 401 })
    await expect(verifyGoogle(req('t'), env(), tokeninfo({ error: 'invalid' }, 400))).rejects.toMatchObject({ status: 401 })
    await expect(verifyGoogle(req('t'), env(), tokeninfo({ azp: 'other', email: 'a@grbhomeimprovements.co.uk', email_verified: 'true' }))).rejects.toMatchObject({ status: 403 })
    await expect(verifyGoogle(req('t'), env(), tokeninfo({ azp: GID, email: 'a@gmail.com', email_verified: 'true' }))).rejects.toMatchObject({ status: 403 })
  })
})

describe('connect', () => {
  it('builds the consent URL with granular scopes and a one-time state', async () => {
    const e = env()
    const url = new URL(await startUrl(e, 'george@grbhomeimprovements.co.uk'))
    expect(url.origin + url.pathname).toBe('https://login.xero.com/identity/connect/authorize')
    expect(url.searchParams.get('scope')).toContain('accounting.invoices')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.grbhomeimprovements.co.uk/api/xero/callback')
    expect(e.XERO_KV.m.has(`state:${url.searchParams.get('state')}`)).toBe(true)
  })

  it('exchanges the code, stores the organisation and refresh token, and rejects reused states', async () => {
    const e = env()
    const state = new URL(await startUrl(e, 'george@grbhomeimprovements.co.uk')).searchParams.get('state')!
    const { f, calls } = fake([
      ['POST https://identity.xero.com/connect/token', () => [200, { access_token: 'A1', refresh_token: 'R1', expires_in: 1800 }]],
      ['GET https://api.xero.com/connections', () => [200, [{ id: 'conn1', tenantId: 'T1', tenantName: 'GRB Builders (London) Ltd', tenantType: 'ORGANISATION' }]]],
    ])
    const c = await finishConnect(e, 'CODE', state, f)
    expect(c).toMatchObject({ tenantId: 'T1', tenantName: 'GRB Builders (London) Ltd', refreshToken: 'R1', connectedBy: 'george@grbhomeimprovements.co.uk' })
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('CID:SECRET')}`)
    await expect(finishConnect(e, 'CODE', state, f)).rejects.toMatchObject({ status: 400 })
  })
})

async function connected() {
  const e = env()
  e.XERO_KV.m.set('conn', JSON.stringify({ refreshToken: 'R1', tenantId: 'T1', tenantName: 'GRB', connectionId: 'c1', connectedBy: 'x', connectedAt: '' }))
  return e
}

const item = { key: 'pay1', contactName: 'Mr & Mrs Szojda', contactEmail: 'szojda@example.com', date: '2026-11-02', dueDate: '2026-11-09', reference: 'CR30/1 – Week 1', description: 'Week 1', amount: 4141.92 }

describe('invoices', () => {
  it('payload is a VAT-inclusive sales invoice on the chosen account', () => {
    expect(invoicePayload(item, 'C1', '200', 'DRAFT')).toMatchObject({
      Type: 'ACCREC',
      Contact: { ContactID: 'C1' },
      LineAmountTypes: 'Inclusive',
      Status: 'DRAFT',
      LineItems: [{ UnitAmount: 4141.92, AccountCode: '200', TaxType: 'OUTPUT2', Quantity: 1 }],
    })
  })

  it('refreshes the token (storing the rotated one), creates the contact once, and uses idempotency keys', async () => {
    const e = await connected()
    const { f, calls } = fake([
      ['POST https://identity.xero.com/connect/token', () => [200, { access_token: 'A2', refresh_token: 'R2', expires_in: 1800 }]],
      ['GET https://api.xero.com/api.xro/2.0/Contacts', () => [200, { Contacts: [] }]],
      ['POST https://api.xero.com/api.xro/2.0/Contacts', () => [200, { Contacts: [{ ContactID: 'C9' }] }]],
      ['PUT https://api.xero.com/api.xro/2.0/Invoices', (_u, i) => [200, { Invoices: [{ InvoiceID: `inv-${JSON.parse(i.body as string).Invoices[0].Reference}`, InvoiceNumber: 'INV-0101' }] }]],
    ])
    const r = await createInvoices(e, [item, { ...item, key: 'pay2', reference: 'CR30/1 – Week 2' }], { accountCode: '200', status: 'DRAFT', email: false }, f)
    expect(r.map((x) => x.ok)).toEqual([true, true])
    expect(JSON.parse(e.XERO_KV.m.get('conn')!).refreshToken).toBe('R2')
    expect(calls.filter((c) => c.url.startsWith('https://identity.xero.com')).length).toBe(1) // access token cached
    expect(calls.filter((c) => (c.init.method ?? 'GET') === 'POST' && c.url.endsWith('/Contacts')).length).toBe(1)
    const put = calls.find((c) => c.init.method === 'PUT')!
    expect((put.init.headers as Record<string, string>)['Idempotency-Key']).toBe('grb-pay1')
    expect((put.init.headers as Record<string, string>)['Xero-tenant-id']).toBe('T1')
  })

  it('emails approved invoices when asked, and reports Xero validation errors per invoice', async () => {
    const e = await connected()
    let n = 0
    const { f, calls } = fake([
      ['POST https://identity.xero.com/connect/token', () => [200, { access_token: 'A2', refresh_token: 'R2', expires_in: 1800 }]],
      ['GET https://api.xero.com/api.xro/2.0/Contacts', () => [200, { Contacts: [{ ContactID: 'C1', EmailAddress: 'c@example.com' }] }]],
      ['PUT https://api.xero.com/api.xro/2.0/Invoices', () => (++n === 1 ? [200, { Invoices: [{ InvoiceID: 'I1', InvoiceNumber: 'INV-1' }] }] : [400, { Elements: [{ ValidationErrors: [{ Message: 'Account code 999 is not valid' }] }] }])],
      ['POST https://api.xero.com/api.xro/2.0/Invoices/I1/Email', () => [204, {}]],
    ])
    const r = await createInvoices(e, [item, { ...item, key: 'pay2' }], { accountCode: '200', status: 'AUTHORISED', email: true }, f)
    expect(r[0]).toMatchObject({ ok: true, emailed: true, number: 'INV-1' })
    expect(r[1]).toMatchObject({ ok: false, error: 'Account code 999 is not valid' })
    expect(calls.some((c) => c.url.endsWith('/Invoices/I1/Email'))).toBe(true)
  })

  it('a revoked connection is cleared and reported as needing reconnection', async () => {
    const e = await connected()
    const { f } = fake([['POST https://identity.xero.com/connect/token', () => [400, { error: 'invalid_grant' }]]])
    const r = await createInvoices(e, [item, { ...item, key: 'pay2' }], { accountCode: '200', status: 'DRAFT', email: false }, f)
    expect(r).toHaveLength(1)
    expect(r[0].error).toMatch(/connect Xero again/)
    expect(e.XERO_KV.m.has('conn')).toBe(false)
  })
})

describe('payment status', () => {
  it('maps Xero invoices to status and paid date', async () => {
    const e = await connected()
    e.XERO_KV.m.set('access', JSON.stringify({ token: 'A', expiresAt: Date.now() + 600_000 }))
    const { f } = fake([
      ['GET https://api.xero.com/api.xro/2.0/Invoices?IDs=', () => [200, { Invoices: [
        { InvoiceID: 'I1', InvoiceNumber: 'INV-1', Status: 'PAID', AmountDue: 0, AmountPaid: 100, FullyPaidOnDate: '/Date(1762992000000+0000)/' },
        { InvoiceID: 'I2', Status: 'AUTHORISED', AmountDue: 50, AmountPaid: 0 },
      ] }]],
    ])
    expect(await invoiceStatuses(e, ['I1', 'I2'], f)).toEqual([
      { id: 'I1', number: 'INV-1', status: 'PAID', amountDue: 0, amountPaid: 100, paidOn: '2025-11-13' },
      { id: 'I2', number: undefined, status: 'AUTHORISED', amountDue: 50, amountPaid: 0, paidOn: undefined },
    ])
  })

  it('parses Xero dates', () => {
    expect(xeroDate('/Date(1762992000000+0000)/')).toBe('2025-11-13')
    expect(xeroDate('2026-11-09T00:00:00')).toBe('2026-11-09')
    expect(xeroDate(undefined)).toBeUndefined()
  })
})
