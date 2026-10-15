import {
  checkAccount,
  createInvoices,
  disconnect,
  finishConnect,
  getConnection,
  HttpError,
  invoiceStatuses,
  startUrl,
  verifyGoogle,
  type Env,
  type InvoiceRequest,
} from '../../_lib/xero'

/**
 * /api/xero/*  (Cloudflare Pages Function)
 *   POST start            → { url } to send the browser to Xero's consent page
 *   GET  callback         ← Xero redirects here; stores the connection, then back to the app
 *   GET  status           → { connected, tenantName, connectedBy, connectedAt }
 *   POST invoices         { items, accountCode, status, email } → per-invoice results
 *   POST invoice-status   { ids } → status / paid date per invoice
 *   POST account          { code } → { name } of that sales account, if it exists
 *   POST disconnect
 * Everything except the callback requires a GRB Google access token (Authorization: Bearer …).
 */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  const route = ((params.route as string[] | undefined) ?? []).join('/')
  const url = new URL(request.url)
  try {
    if (route === 'callback' && request.method === 'GET') {
      const back = new URL('/', url)
      const err = url.searchParams.get('error')
      if (err) {
        back.searchParams.set('xero', 'error')
        back.searchParams.set('msg', err === 'access_denied' ? 'Xero access was not allowed.' : err)
      } else {
        try {
          await finishConnect(env, url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? '')
          back.searchParams.set('xero', 'connected')
        } catch (e) {
          back.searchParams.set('xero', 'error')
          back.searchParams.set('msg', (e as Error).message)
        }
      }
      return Response.redirect(back.toString(), 302)
    }

    const email = await verifyGoogle(request, env)
    const body = request.method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {}

    switch (`${request.method} ${route}`) {
      case 'POST start':
        return json({ url: await startUrl(env, email) })
      case 'GET status': {
        const c = await getConnection(env)
        return json(c ? { connected: true, tenantName: c.tenantName, connectedBy: c.connectedBy, connectedAt: c.connectedAt } : { connected: false })
      }
      case 'POST invoices': {
        const items = (body.items as InvoiceRequest[] | undefined) ?? []
        if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'No invoices to create.')
        const accountCode = String(body.accountCode ?? '200')
        const status = body.status === 'AUTHORISED' ? 'AUTHORISED' : 'DRAFT'
        return json({ results: await createInvoices(env, items.slice(0, 50), { accountCode, status, email: body.email === true }) })
      }
      case 'POST invoice-status': {
        const ids = ((body.ids as string[] | undefined) ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x))
        return json({ invoices: ids.length ? await invoiceStatuses(env, ids) : [] })
      }
      case 'POST account':
        return json({ name: (await checkAccount(env, String(body.code ?? ''))) ?? null })
      case 'POST disconnect':
        await disconnect(env)
        return json({ ok: true })
      default:
        throw new HttpError(404, 'Not found')
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    return json({ error: (e as Error).message }, status)
  }
}
