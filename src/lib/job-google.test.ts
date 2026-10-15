import { describe, it, expect } from 'vitest'
import { eventId, mergeRows, paymentEvents, paymentRows, programmeRows, stageEvents } from './job-google'
import type { Job, Person } from './jobs'

const people: Person[] = [
  { id: 'p1', name: 'Dave', kind: 'team', trade: 'own', phone: '07700 900001' },
  { id: 'p2', name: 'Top Roofing', kind: 'subbie', trade: 'roofer' },
]

const job: Job = {
  id: 'job-1',
  quoteId: 'q1',
  ref: 'CR30/1',
  client: 'Mr & Mrs Szojda',
  address: '30 Clowders Road, SE6 4DA',
  jobType: 'Single-storey rear extension',
  acceptedOn: '2026-10-15',
  startDate: '2026-11-02',
  weeks: 4,
  termsDays: 7,
  stages: [
    { id: 's1', name: 'Groundworks', trade: 'own', startWeek: 1, weeks: 2, who: ['p1'] },
    { id: 's2', name: 'Roof', trade: 'roofer', startWeek: 3, weeks: 1, who: [] },
  ],
  payments: [
    { id: 'd', label: 'Deposit', amount: 300, invoiceDate: '2026-10-15', due: '2026-10-15', status: 'paid', paidOn: '2026-10-16' },
    { id: 'w1', label: 'Week 1', amount: 175, invoiceDate: '2026-11-02', due: '2026-11-09', status: 'invoiced' },
    { id: 'w2', label: 'Week 2', amount: 175, invoiceDate: '2026-11-09', due: '2026-11-16', status: 'scheduled' },
  ],
  status: 'booked',
  createdAt: '',
  updatedAt: '',
}

describe('calendar events', () => {
  it('ids are stable and valid base32hex', () => {
    const id = eventId('job-1', 'stage', 's1')
    expect(id).toBe(eventId('job-1', 'stage', 's1'))
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/)
    expect(eventId('job-1', 'stage', 's2')).not.toBe(id)
  })

  it('one all-day event per stage with who / what / where', () => {
    const [g, r] = stageEvents(job, people)
    expect(g).toMatchObject({ summary: 'CR30/1 · Groundworks — Dave', location: '30 Clowders Road, SE6 4DA', start: '2026-11-02', end: '2026-11-14' })
    expect(g.description).toContain('Dave: 07700 900001')
    expect(r.summary).toBe('CR30/1 · Roof — Roofer — not assigned')
    expect(r).toMatchObject({ start: '2026-11-16', end: '2026-11-21' }) // Mon–Fri, end exclusive
  })

  it('completed jobs drop off the schedule', () => {
    expect(stageEvents({ ...job, status: 'complete' }, people)).toEqual([])
  })

  it('payment reminders on due dates for unpaid payments only', () => {
    const ev = paymentEvents(job)
    expect(ev.map((e) => e.start)).toEqual(['2026-11-09', '2026-11-16'])
    expect(ev[1].summary).toContain('(not invoiced yet)')
  })
})

describe('sheet rows', () => {
  it('payments and programme rows', () => {
    expect(paymentRows([job])[0]).toEqual(['job-1', 'CR30/1', 'Mr & Mrs Szojda', '30 Clowders Road, SE6 4DA', 'Deposit', 300, '2026-10-15', '2026-10-15', 'paid', '2026-10-16', ''])
    expect(programmeRows([job], people)[1]).toEqual(['job-1', 'CR30/1', '30 Clowders Road, SE6 4DA', 'Roof', 'Roofer', '', '2026-11-16', '2026-11-20', 1])
  })

  it('merge keeps other devices’ jobs, replaces mine and drops deleted ones', () => {
    const existing = [
      ['job-1', 'CR30/1', 'old'],
      ['job-2', 'AB1/1', 'other device'],
      ['job-3', 'ZZ9/1', 'deleted here'],
    ]
    const merged = mergeRows(existing, [['job-1', 'CR30/1', 'new']], new Set(['job-1']), new Set(['job-3']))
    expect(merged).toEqual([
      ['job-2', 'AB1/1', 'other device'],
      ['job-1', 'CR30/1', 'new'],
    ])
  })
})
