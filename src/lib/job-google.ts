import { addDays, stageDates, TRADES, type Job, type Person } from './jobs'

/**
 * Pure builders for what a job looks like in Google Calendar and the
 * "GRB Jobs & Payments" sheet. The sync code only moves these to Google.
 */

export interface CalEvent {
  /** Stable Calendar event id (base32hex: lowercase a–v and 0–9). */
  id: string
  summary: string
  location: string
  description: string
  /** All-day events: start inclusive, end exclusive (yyyy-mm-dd). */
  start: string
  end: string
  /** Google Calendar colour id. */
  colorId?: string
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 })

/** Calendar ids must be base32hex; hex-encoding any string satisfies that and keeps ids stable. */
export function eventId(...parts: string[]): string {
  const bytes = new TextEncoder().encode(parts.join('|'))
  return 'grb' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Google Calendar event colours: 10 basil (green), 9 blueberry, 6 tangerine, 3 grape, 8 graphite.
const TRADE_COLOUR: Record<string, string> = { own: '10', roofer: '6', electrician: '9', plumber: '3', other: '8' }

export function stageEvents(job: Job, people: Person[]): CalEvent[] {
  if (job.status === 'complete') return []
  const byId = new Map(people.map((p) => [p.id, p]))
  return job.stages.map((s) => {
    const d = stageDates(job, s)
    const who = s.who.map((id) => byId.get(id)).filter((p): p is Person => !!p)
    const whoText = who.length ? who.map((p) => p.name).join(', ') : `${TRADES[s.trade]} — not assigned`
    const contact = who
      .filter((p) => p.phone || p.email)
      .map((p) => `${p.name}: ${[p.phone, p.email].filter(Boolean).join(' · ')}`)
    return {
      id: eventId(job.id, 'stage', s.id),
      summary: `${job.ref || 'Job'} · ${s.name} — ${whoText}`,
      location: job.address,
      description: [
        `Who: ${whoText}`,
        `What: ${s.name} (week ${s.startWeek}${s.weeks > 1 ? `–${s.startWeek + s.weeks - 1}` : ''} of ${job.weeks})`,
        `Where: ${job.address}`,
        `Client: ${job.client}`,
        ...(contact.length ? ['', ...contact] : []),
        ...(s.notes ? ['', s.notes] : []),
        '',
        'From GRB Quick Quote — edit the job in the app, not here.',
      ].join('\n'),
      start: d.start,
      end: addDays(d.end, 1),
      colorId: TRADE_COLOUR[s.trade],
    }
  })
}

/** Unpaid payments as all-day reminders on their due date. */
export function paymentEvents(job: Job): CalEvent[] {
  return job.payments
    .filter((p) => p.status !== 'paid')
    .map((p) => ({
      id: eventId(job.id, 'pay', p.id),
      summary: `£ ${job.ref || 'Job'} · ${p.label} ${money.format(p.amount)} due${p.status === 'scheduled' ? ' (not invoiced yet)' : ''}`,
      location: job.address,
      description: [
        `Client: ${job.client}`,
        `Amount (inc VAT): ${money.format(p.amount)}`,
        `Invoice date: ${p.invoiceDate}`,
        `Due: ${p.due}`,
        `Status: ${p.status}`,
        `Payment reference: ${job.ref}`,
      ].join('\n'),
      start: p.due,
      end: addDays(p.due, 1),
      colorId: p.status === 'scheduled' ? '5' : '2',
    }))
}

// ---------- sheet ----------

export const PAYMENT_HEADER = [
  'Job ID',
  'Quote ref',
  'Client',
  'Address',
  'Payment',
  'Amount inc VAT',
  'Invoice date',
  'Due date',
  'Status',
  'Paid on',
  'Xero invoice',
]

export const PROGRAMME_HEADER = ['Job ID', 'Quote ref', 'Address', 'Stage', 'Trade', 'Who', 'Start', 'End', 'Weeks']

export type Row = (string | number)[]

export function paymentRows(jobs: Job[]): Row[] {
  return jobs.flatMap((j) =>
    j.payments.map((p) => [
      j.id,
      j.ref,
      j.client,
      j.address,
      p.label,
      p.amount,
      p.invoiceDate,
      p.due,
      p.status,
      p.paidOn ?? '',
      p.xero?.number ?? '',
    ]),
  )
}

export function programmeRows(jobs: Job[], people: Person[]): Row[] {
  const name = new Map(people.map((p) => [p.id, p.name]))
  return jobs.flatMap((j) =>
    j.stages.map((s) => {
      const d = stageDates(j, s)
      return [j.id, j.ref, j.address, s.name, TRADES[s.trade], s.who.map((id) => name.get(id) ?? '?').join(', '), d.start, d.end, s.weeks]
    }),
  )
}

/**
 * Merge this device's rows into the sheet's existing rows (column A = job id):
 * rows for jobs this device knows are replaced, rows for jobs deleted here are
 * dropped, and rows for jobs only another device knows are kept as they are.
 */
export function mergeRows(existing: Row[], mine: Row[], localJobIds: Set<string>, deletedJobIds: Set<string>): Row[] {
  const keep = existing.filter((r) => {
    const id = String(r[0] ?? '')
    return id && !localJobIds.has(id) && !deletedJobIds.has(id)
  })
  return [...keep, ...mine].sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[6]).localeCompare(String(b[6])))
}
