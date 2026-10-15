import { paymentSchedule } from './schedule'

/**
 * Jobs: a won quote with a start date, a stage-by-stage programme (who / what /
 * where) and its payments, each invoiced separately. Pure functions only; the
 * calendar, sheet and Xero integrations are built from these.
 */

export type Trade = 'own' | 'roofer' | 'electrician' | 'plumber' | 'other'

export const TRADES: Record<Trade, string> = {
  own: 'GRB crew',
  roofer: 'Roofer',
  electrician: 'Electrician',
  plumber: 'Plumber',
  other: 'Other',
}

export interface Person {
  id: string
  name: string
  kind: 'team' | 'subbie'
  trade: Trade
  phone?: string
  email?: string
}

export interface Stage {
  id: string
  name: string
  trade: Trade
  /** 1-based programme week the stage starts in. */
  startWeek: number
  weeks: number
  /** Person ids. */
  who: string[]
  notes?: string
}

export type PaymentStatus = 'scheduled' | 'invoiced' | 'paid'

export interface JobPayment {
  id: string
  label: string
  /** Inc VAT. */
  amount: number
  /** yyyy-mm-dd: when the invoice should be raised. */
  invoiceDate: string
  /** yyyy-mm-dd: when payment is due. */
  due: string
  status: PaymentStatus
  paidOn?: string
  xero?: { invoiceId: string; number?: string }
}

export interface Job {
  id: string
  quoteId: string
  ref: string
  client: string
  address: string
  jobType: string
  acceptedOn: string
  startDate: string
  weeks: number
  /** Days from invoice to due date for the weekly stage payments. */
  termsDays: number
  stages: Stage[]
  payments: JobPayment[]
  status: 'booked' | 'complete'
  createdAt: string
  updatedAt: string
}

// ---------- dates (yyyy-mm-dd, UTC arithmetic so DST never shifts a day) ----------

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const todayIso = () => {
  const d = new Date()
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10)
}

/** Monday of the week containing iso. */
export function weekStart(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay() // 0 = Sun
  return addDays(iso, -((dow + 6) % 7))
}

// ---------- programme ----------

/** Typical extension sequence; parallel stages share a group. */
const TEMPLATE: { weight: number; stages: { name: string; trade: Trade; pkg?: 'footings' | 'roof' | 'electrical' | 'plumbing' }[] }[] = [
  { weight: 1, stages: [{ name: 'Site set-up & strip-out', trade: 'own' }] },
  { weight: 2, stages: [{ name: 'Groundworks & footings', trade: 'own', pkg: 'footings' }] },
  { weight: 3, stages: [{ name: 'Walls, steels & structure', trade: 'own' }] },
  { weight: 2, stages: [{ name: 'Roof', trade: 'roofer', pkg: 'roof' }] },
  { weight: 1, stages: [{ name: 'Windows & external doors', trade: 'own' }] },
  {
    weight: 1,
    stages: [
      { name: 'Electrics – 1st fix', trade: 'electrician', pkg: 'electrical' },
      { name: 'Plumbing & heating – 1st fix', trade: 'plumber', pkg: 'plumbing' },
    ],
  },
  { weight: 2, stages: [{ name: 'Plaster & screed', trade: 'own' }] },
  {
    weight: 1,
    stages: [
      { name: 'Electrics – 2nd fix', trade: 'electrician', pkg: 'electrical' },
      { name: 'Plumbing & heating – 2nd fix', trade: 'plumber', pkg: 'plumbing' },
    ],
  },
  { weight: 1, stages: [{ name: 'Decoration, snagging & handover', trade: 'own' }] },
]

/**
 * Spread the template over the job's duration. Works for any length: on short
 * jobs several stages share a week; every week is covered.
 */
export function defaultStages(
  weeks: number,
  included: Partial<Record<'footings' | 'roof' | 'electrical' | 'plumbing', boolean>>,
  id: () => string,
): Stage[] {
  const W = Math.max(1, Math.floor(weeks))
  const groups = TEMPLATE.map((g) => ({ ...g, stages: g.stages.filter((s) => !s.pkg || included[s.pkg] !== false) })).filter(
    (g) => g.stages.length,
  )
  const total = groups.reduce((a, g) => a + g.weight, 0)
  const out: Stage[] = []
  let cum = 0
  for (const g of groups) {
    const start = 1 + Math.floor((cum / total) * W)
    cum += g.weight
    const end = Math.max(start, Math.ceil((cum / total) * W))
    for (const s of g.stages) out.push({ id: id(), name: s.name, trade: s.trade, startWeek: start, weeks: end - start + 1, who: [] })
  }
  return out
}

/** Calendar dates for a stage: Monday-based weeks from the job start, ending on the Friday. */
export function stageDates(job: Pick<Job, 'startDate'>, s: Pick<Stage, 'startWeek' | 'weeks'>) {
  const start = addDays(job.startDate, (s.startWeek - 1) * 7)
  const lastDay = addDays(start, s.weeks * 7 - 3) // Mon + 4 = Fri of the last week
  return { start, end: lastDay }
}

// ---------- payments ----------

/**
 * One invoice per payment: the deposit is invoiced on acceptance and due
 * immediately; each weekly payment is invoiced at the start of its programme
 * week and due termsDays later.
 */
export function planPayments(opts: {
  total: number
  depositPct: number
  weeks: number
  acceptedOn: string
  startDate: string
  termsDays: number
  id: () => string
}): JobPayment[] {
  const rows = paymentSchedule(opts.total, opts.depositPct, opts.weeks)
  return rows.map((r, i) => {
    const invoiceDate = i === 0 ? opts.acceptedOn : addDays(opts.startDate, (i - 1) * 7)
    const isLast = i === rows.length - 1 && i > 0
    return {
      id: opts.id(),
      label: i === 0 ? 'Deposit' : isLast && opts.weeks > 0 ? `${r.label} (final, on completion)` : r.label,
      amount: r.amount,
      invoiceDate,
      due: i === 0 ? invoiceDate : addDays(invoiceDate, opts.termsDays),
      status: 'scheduled' as const,
    }
  })
}

/**
 * Re-date payments after the start date or terms change. Payments already
 * invoiced or paid keep their dates (the invoice has gone out).
 */
export function redatePayments(job: Job): JobPayment[] {
  return job.payments.map((p, i) => {
    if (p.status !== 'scheduled' || i === 0) return p
    const invoiceDate = addDays(job.startDate, (i - 1) * 7)
    return { ...p, invoiceDate, due: addDays(invoiceDate, job.termsDays) }
  })
}

// ---------- money in ----------

export interface MoneyItem {
  job: Job
  payment: JobPayment
}

export interface MoneyBuckets {
  /** Scheduled payments whose invoice date has arrived — raise these invoices (not repeated in the due buckets). */
  toInvoice: MoneyItem[]
  overdue: MoneyItem[]
  thisWeek: MoneyItem[]
  nextFourWeeks: MoneyItem[]
  later: MoneyItem[]
  paidLast30: MoneyItem[]
}

export function moneyBuckets(jobs: Job[], today: string): MoneyBuckets {
  const sunday = addDays(weekStart(today), 6)
  const fourWeeks = addDays(sunday, 28)
  const b: MoneyBuckets = { toInvoice: [], overdue: [], thisWeek: [], nextFourWeeks: [], later: [], paidLast30: [] }
  for (const job of jobs)
    for (const payment of job.payments) {
      const item = { job, payment }
      if (payment.status === 'paid') {
        if ((payment.paidOn ?? '') >= addDays(today, -30)) b.paidLast30.push(item)
        continue
      }
      // Not invoiced yet but its invoice date has come: it belongs in "to raise" only —
      // a client can't be late paying an invoice they haven't been sent.
      if (payment.status === 'scheduled' && payment.invoiceDate <= today) {
        b.toInvoice.push(item)
        continue
      }
      if (payment.due < today) b.overdue.push(item)
      else if (payment.due <= sunday) b.thisWeek.push(item)
      else if (payment.due <= fourWeeks) b.nextFourWeeks.push(item)
      else b.later.push(item)
    }
  const byDue = (x: MoneyItem, y: MoneyItem) => x.payment.due.localeCompare(y.payment.due)
  for (const k of Object.keys(b) as (keyof MoneyBuckets)[]) b[k].sort(byDue)
  return b
}

export const sumOf = (items: MoneyItem[]) => Math.round(items.reduce((a, i) => a + i.payment.amount, 0) * 100) / 100
