import { describe, it, expect } from 'vitest'
import { Drive, DriveError, FOLDER_NAME } from './drive'

interface Call {
  method: string
  url: string
  body?: string
  auth?: string
}

/** A fake Drive API: routes by method + URL prefix, records every call. */
function fake(routes: [string, (c: Call) => [number, unknown]][]) {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit = {}) => {
    const c: Call = {
      method: init.method ?? 'GET',
      url,
      auth: (init.headers as Record<string, string>)?.Authorization,
      body: init.body instanceof Blob ? await init.body.text() : (init.body as string | undefined),
    }
    calls.push(c)
    const route = routes.find(([k]) => `${c.method} ${url}`.startsWith(k))
    const [status, json] = route ? route[1](c) : [500, { error: { message: `no route for ${c.method} ${url}` } }]
    return new Response(JSON.stringify(json), { status })
  }) as typeof fetch
  return { f, calls }
}

const API = 'https://www.googleapis.com/drive/v3'
const UP = 'https://www.googleapis.com/upload/drive/v3'

describe('Drive.ensureFolder', () => {
  it('reuses a remembered folder that still exists', async () => {
    const { f, calls } = fake([[`GET ${API}/files/F1?`, () => [200, { id: 'F1' }]]])
    expect(await new Drive('tok', f).ensureFolder('F1')).toBe('F1')
    expect(calls).toHaveLength(1)
    expect(calls[0].auth).toBe('Bearer tok')
  })

  it('finds the folder by name when the remembered one was deleted', async () => {
    const { f } = fake([
      [`GET ${API}/files/OLD?`, () => [404, { error: { message: 'File not found' } }]],
      [`GET ${API}/files?q=`, () => [200, { files: [{ id: 'F2' }] }]],
    ])
    expect(await new Drive('tok', f).ensureFolder('OLD')).toBe('F2')
  })

  it('creates the folder when there is none', async () => {
    const { f, calls } = fake([
      [`GET ${API}/files?q=`, () => [200, { files: [] }]],
      [`POST ${API}/files?`, () => [200, { id: 'NEW' }]],
    ])
    expect(await new Drive('tok', f).ensureFolder()).toBe('NEW')
    expect(JSON.parse(calls[1].body!)).toEqual({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  })
})

describe('Drive.upsert', () => {
  const file = { name: 'Q.pdf', mimeType: 'application/pdf', parent: 'F', body: new Blob(['%PDF-1.7']) }

  it('creates a new file in the folder', async () => {
    const { f, calls } = fake([[`POST ${UP}/files?uploadType=multipart`, () => [200, { id: 'P1' }]]])
    expect(await new Drive('tok', f).upsert(file)).toBe('P1')
    expect(calls[0].body).toContain('"parents":["F"]')
    expect(calls[0].body).toContain('%PDF-1.7')
  })

  it('updates an existing file in place', async () => {
    const { f, calls } = fake([[`PATCH ${UP}/files/P1?`, () => [200, { id: 'P1' }]]])
    expect(await new Drive('tok', f).upsert({ ...file, id: 'P1' })).toBe('P1')
    expect(calls[0].body).toContain('"name":"Q.pdf"')
    expect(calls[0].body).not.toContain('parents')
  })

  it('re-creates the file if it was deleted from Drive', async () => {
    const { f } = fake([
      [`PATCH ${UP}/files/GONE?`, () => [404, { error: { message: 'File not found' } }]],
      [`POST ${UP}/files?`, () => [200, { id: 'P2' }]],
    ])
    expect(await new Drive('tok', f).upsert({ ...file, id: 'GONE' })).toBe('P2')
  })

  it('surfaces other errors with Google’s message', async () => {
    const { f } = fake([[`POST ${UP}/files?`, () => [403, { error: { message: 'Insufficient permissions' } }]]])
    await expect(new Drive('tok', f).upsert(file)).rejects.toThrow(DriveError)
    await expect(new Drive('tok', f).upsert(file)).rejects.toThrow('Insufficient permissions')
  })
})
