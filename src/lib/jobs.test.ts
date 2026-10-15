import { describe, it, expect } from 'vitest'
import { addDays, defaultStages, moneyBuckets, planPayments, redatePayments, stageDates, sumOf, weekStart, type Job } from './jobs'

let n = 0
const id = () => `id${++n}`

describe('dates', () => {
  it('adds days across month ends and the October clock change', () => {
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
  })
  it('finds the Monday of a week', () => {
    expect(weekStart('2026-10-15')).toBe('2026-10-12') // Thu -> Mon
    expect(weekStart('2026-10-18')).toBe('2026-10-12') // Sun -> Mon
    expect(weekStart('2026-10-12')).toBe('2026-10-12')
  })
})

describe('defaultStages', () => {
  const all = { footings: true, roof: true, electrical: true, plumbing: true }

  it('covers every week of a 16-week job, starting week 1 and ending week 16', () => {
    const s = defaultStages(16, all, id)
    expect(s[0]).toMatchObject({ name: 'Site set-up & strip-out', startWeek: 1 })
    expect(Math.max(...s.map((x) => x.startWeek + x.weeks - 1))).toBe(16)
    const covered = new Set(s.flatMap((x) => Array.from({ length: x.weeks }, (_, i) => x.startWeek + i)))
    expect(covered.size).toBe(16)
  })

  it('runs 1st-fix electrics and plumbing in parallel', () => {
    const s = defaultStages(16, all, id)
    const e = s.find((x) => x.name === 'Electrics – 1st fix')!
    const p = s.find((x) => x.name === 'Plumbing & heating – 1st fix')!
    expect(e.startWeek).toBe(p.startWeek)
    expect(e.trade).toBe('electrician')
  })

  it('leaves out stages for packages not in the estimate', () => {
    const s = defaultStages(10, { ...all, roof: false, plumbing: false }, id)
    expect(s.some((x) => x.trade === 'roofer' || x.trade === 'plumber')).toBe(false)
  })

  it('squeezes onto very short jobs without gaps or zero-length stages', () => {
    const s = defaultStages(3, all, id)
    expect(s.every((x) => x.weeks >= 1 && x.startWeek >= 1 && x.startWeek + x.weeks - 1 <= 3)).toBe(true)
  })
})

describe('stageDates', () => {
  it('runs Monday of the start week to Friday of the last week', () => {
    expect(stageDates({ startDate: '2026-11-02' }, { startWeek: 2, weeks: 2 })).toEqual({ start: '2026-11-09', end: '2026-11-20' })
  })
})

describe('planPayments', () => {
  const plan = () =>
    planPayments({ total: 94672.5, depositPct: 0.3, weeks: 16, acceptedOn: '2026-10-15', startDate: '2026-11-02', termsDays: 7, id })

  it('deposit invoiced and due on acceptance; weekly invoices each Monday, due a week later', () => {
    const p = plan()
    expect(p).toHaveLength(17)
    expect(p[0]).toMatchObject({ label: 'Deposit', amount: 28401.75, invoiceDate: '2026-10-15', due: '2026-10-15' })
    expect(p[1]).toMatchObject({ label: 'Week 1', invoiceDate: '2026-11-02', due: '2026-11-09' })
    expect(p[16]).toMatchObject({ label: 'Week 16 (final, on completion)', invoiceDate: '2027-02-15' })
    expect(Math.round(p.reduce((a, x) => a + x.amount, 0) * 100) / 100).toBe(94672.5)
  })

  it('re-dating after a start-date slip leaves invoiced and paid payments alone', () => {
    const payments = plan()
    payments[1].status = 'invoiced'
    const job = { startDate: '2026-11-09', termsDays: 7, payments } as Job
    const r = redatePayments(job)
    expect(r[0].invoiceDate).toBe('2026-10-15')
    expect(r[1].invoiceDate).toBe('2026-11-02') // already invoiced
    expect(r[2].invoiceDate).toBe('2026-11-16') // week 2 moved a week
  })
})

describe('moneyBuckets', () => {
  const job = (payments: Partial<Job['payments'][number]>[]) =>
    ({ payments: payments.map((p, i) => ({ id: `p${i}`, label: `P${i}`, amount: 100, status: 'scheduled', ...p })) }) as Job

  it('sorts unpaid payments into buckets; un-raised invoices appear only under to-invoice', () => {
    const today = '2026-10-15' // Thursday; week ends Sun 18th
    const b = moneyBuckets(
      [
        job([
          { invoiceDate: '2026-10-01', due: '2026-10-08' }, // not invoiced yet: to raise, not overdue
          { invoiceDate: '2026-10-01', due: '2026-10-08', status: 'invoiced' }, // overdue
          { invoiceDate: '2026-10-12', due: '2026-10-17', status: 'invoiced' }, // this week
          { invoiceDate: '2026-10-19', due: '2026-10-26' }, // next 4 weeks
          { invoiceDate: '2026-12-01', due: '2026-12-08' }, // later
          { invoiceDate: '2026-10-01', due: '2026-10-08', status: 'paid', paidOn: '2026-10-09' },
        ]),
      ],
      today,
    )
    expect(b.overdue).toHaveLength(1)
    expect(b.thisWeek).toHaveLength(1)
    expect(b.nextFourWeeks).toHaveLength(1)
    expect(b.later).toHaveLength(1)
    expect(b.paidLast30).toHaveLength(1)
    expect(b.toInvoice.map((x) => x.payment.due)).toEqual(['2026-10-08'])
    expect(sumOf(b.overdue)).toBe(100)
  })
})
