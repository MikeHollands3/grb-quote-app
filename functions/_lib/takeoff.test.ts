import { describe, it, expect } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { checkFiles, readDrawings, MODEL } from './takeoff'

/** A fake Messages API that streams one text block back. */
function fakeClient(text: string, stopReason = 'end_turn') {
  const sent: { url: string; body: Record<string, unknown>; headers: Headers }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init.body)), headers: new Headers(init.headers) })
    const events = [
      ['message_start', { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }],
      ['message_stop', { type: 'message_stop' }],
    ]
    const sse = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof globalThis.fetch
  return { client: new Anthropic({ apiKey: 'test', fetch, maxRetries: 0 }), sent }
}

const pdf = { name: 'Plans.pdf', type: 'application/pdf', data: btoa('%PDF-1.4 test') }

describe('readDrawings', () => {
  it('sends the drawings with the schema, fallbacks and notes, and parses the takeoff', async () => {
    const { client, sent } = fakeClient(JSON.stringify({ summary: 'Loft', jobType: 'Loft - dormer' }))
    const t = await readDrawings('test', [pdf, { name: 'photo.jpg', type: 'image/jpeg', data: 'abc' }], 'Client supplies kitchen', client)
    expect(t).toMatchObject({ summary: 'Loft', jobType: 'Loft - dormer' })
    const { body, headers } = sent[0]
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.stream).toBe(true)
    expect(body.fallbacks).toBe('default')
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
    expect((body.output_config as { format: { type: string } }).format.type).toBe('json_schema')
    const content = (body.messages as { content: { type: string; text?: string }[] }[])[0].content
    expect(content.map((b) => b.type)).toEqual(['document', 'image', 'text'])
    expect(content[2].text).toContain('Client supplies kitchen')
    expect(String(body.system)).toContain('Ready-mix concrete (C25-C35) [per m3]')
  })

  it('reports refusals and cut-off answers as readable errors', async () => {
    await expect(readDrawings('test', [pdf], '', fakeClient('', 'refusal').client)).rejects.toMatchObject({ status: 422 })
    await expect(readDrawings('test', [pdf], '', fakeClient('{"summ', 'max_tokens').client)).rejects.toMatchObject({ status: 502 })
  })
})

describe('checkFiles', () => {
  it('accepts PDFs and photos, rejects anything else or nothing', () => {
    expect(checkFiles([pdf])).toHaveLength(1)
    expect(() => checkFiles([])).toThrow(/at least one/)
    expect(() => checkFiles([{ name: 'a.docx', type: 'application/msword', data: 'x' }])).toThrow(/isn't a PDF/)
    expect(() => checkFiles([{ ...pdf, data: 'A'.repeat(28 * 1024 * 1024) }])).toThrow(/too large/)
  })
})
