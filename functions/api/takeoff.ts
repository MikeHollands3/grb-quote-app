import { HttpError, verifyGoogle } from '../_lib/xero'
import { checkFiles, readDrawings } from '../_lib/takeoff'

/**
 * POST /api/takeoff  { files: [{ name, type, data (base64) }], notes }
 *   → { takeoff } or { error }
 * Needs a GRB Google access token (Authorization: Bearer …) and ANTHROPIC_API_KEY
 * as a Pages secret. Reading a drawing set takes a minute or two, so the body is
 * streamed: spaces every 10 s keep the connection open, then the JSON.
 */

interface Env {
  ANTHROPIC_API_KEY?: string
  GOOGLE_CLIENT_ID?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const fail = (e: unknown) => {
    const status = e instanceof HttpError ? e.status : 500
    const error = e instanceof Error ? e.message : 'Something went wrong.'
    if (!(e instanceof HttpError)) console.error(e)
    return { status, error }
  }

  // Check sign-in and the upload before starting the stream, so errors get a proper status.
  let files, notes: string
  try {
    await verifyGoogle(request, env)
    if (!env.ANTHROPIC_API_KEY) throw new HttpError(500, 'The drawings reader is not set up on the server (Anthropic API key).')
    const body = (await request.json().catch(() => ({}))) as { files?: unknown; notes?: unknown }
    files = checkFiles(body.files)
    notes = typeof body.notes === 'string' ? body.notes.slice(0, 4000) : ''
  } catch (e) {
    const { status, error } = fail(e)
    return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
  }

  const enc = new TextEncoder()
  const apiKey = env.ANTHROPIC_API_KEY
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const tick = setInterval(() => controller.enqueue(enc.encode(' ')), 10_000)
      try {
        const takeoff = await readDrawings(apiKey, files, notes)
        controller.enqueue(enc.encode(JSON.stringify({ takeoff })))
      } catch (e) {
        controller.enqueue(enc.encode(JSON.stringify({ error: fail(e).error })))
      } finally {
        clearInterval(tick)
        controller.close()
      }
    },
  })
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
