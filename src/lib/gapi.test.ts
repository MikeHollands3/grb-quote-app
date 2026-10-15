import { describe, it, expect } from 'vitest'
import { Calendar, Sheets } from './gapi'

interface Call {
  method: string
  url: string
  body?: unknown
}

function fake(routes: [string, (c: Call) => [number, unknown?]][]) {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit = {}) => {
    const c: Call = { method: init.method ?? 'GET', url, body: init.body ? JSON.parse(init.body as string) : undefined }
    calls.push(c)
    const route = routes.find(([k]) => `${c.method} ${url}`.startsWith(k))
    const [status, json] = route ? route[1](c) : [500, { error: { message: `no route ${c.method} ${url}` } }]
    return new Response(status === 204 ? null : JSON.stringify(json ?? {}), { status })
  }) as typeof fetch
  return { f, calls }
}

const CAL = 'https://www.googleapis.com/calendar/v3'
const SH = 'https://sheets.googleapis.com/v4/spreadsheets'
const ev = { id: 'grbabc', summary: 'S', location: 'L', description: 'D', start: '2026-11-02', end: '2026-11-07', colorId: '10' }

describe('Calendar', () => {
  it('reuses a remembered calendar, or creates one in Europe/London', async () => {
    const a = fake([[`GET ${CAL}/calendars/C1`, () => [200, { id: 'C1' }]]])
    expect(await new Calendar('t', a.f).ensureCalendar('GRB Jobs', 'd', 'C1')).toBe('C1')
    const b = fake([
      [`GET ${CAL}/calendars/GONE`, () => [404]],
      [`POST ${CAL}/calendars`, () => [200, { id: 'NEW' }]],
    ])
    expect(await new Calendar('t', b.f).ensureCalendar('GRB Jobs', 'd', 'GONE')).toBe('NEW')
    expect(b.calls[1].body).toMatchObject({ summary: 'GRB Jobs', timeZone: 'Europe/London' })
  })

  it('updates an event in place, inserting it with the same id if it doesn’t exist', async () => {
    const a = fake([[`PUT ${CAL}/calendars/C1/events/grbabc`, () => [200, { id: 'grbabc' }]]])
    await new Calendar('t', a.f).upsertEvent('C1', ev)
    expect(a.calls).toHaveLength(1)
    expect(a.calls[0].body).toMatchObject({ start: { date: '2026-11-02' }, end: { date: '2026-11-07' }, status: 'confirmed' })
    const b = fake([
      [`PUT ${CAL}/calendars/C1/events/grbabc`, () => [404]],
      [`POST ${CAL}/calendars/C1/events`, () => [200, { id: 'grbabc' }]],
    ])
    await new Calendar('t', b.f).upsertEvent('C1', ev, { transparent: true })
    expect(b.calls[1].body).toMatchObject({ id: 'grbabc', transparency: 'transparent' })
  })

  it('treats an already-deleted event as deleted', async () => {
    const a = fake([[`DELETE ${CAL}/calendars/C1/events/grbabc`, () => [410]]])
    await expect(new Calendar('t', a.f).deleteEvent('C1', 'grbabc')).resolves.toBeUndefined()
  })
})

describe('Sheets', () => {
  it('creates the spreadsheet with tabs and bold frozen headers', async () => {
    const a = fake([
      [`POST ${SH}/S1:batchUpdate`, () => [200, {}]],
      [`POST ${SH}`, () => [200, { spreadsheetId: 'S1' }]],
    ])
    const r = await new Sheets('t', a.f).ensureSpreadsheet('GRB Jobs & Payments', [
      { title: 'Payments', header: ['a'] },
      { title: 'Programme', header: ['b'] },
    ])
    expect(r).toEqual({ id: 'S1', created: true })
    expect((a.calls[0].body as any).sheets.map((s: any) => s.properties.title)).toEqual(['Payments', 'Programme'])
  })

  it('reads data rows and rewrites a tab', async () => {
    const a = fake([
      [`GET ${SH}/S1/values/`, () => [200, { values: [['job-1', 'x']] }]],
      [`POST ${SH}/S1/values/`, () => [200, {}]],
      [`PUT ${SH}/S1/values/`, () => [200, {}]],
    ])
    const s = new Sheets('t', a.f)
    expect(await s.readRows('S1', 'Payments')).toEqual([['job-1', 'x']])
    await s.writeTab('S1', 'Payments', ['H'], [['r']])
    expect(a.calls.at(-1)!.body).toEqual({ values: [['H'], ['r']] })
    expect(a.calls.at(-2)!.url).toContain(':clear')
  })
})
