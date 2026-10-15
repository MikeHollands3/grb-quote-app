import { addDays, defaultStages, planPayments, todayIso, weekStart, type Job } from './lib/jobs'
import { newId, type SavedQuote } from './lib/saved'
import { priceOf, type EstimateState } from './quote-files'

/** The Monday after today (or today, if it is a Monday). */
export const nextMonday = (today = todayIso()) => {
  const mon = weekStart(today)
  return mon === today ? today : addDays(mon, 7)
}

/** Turn a won quote into a booked job with a default programme and invoice plan. */
export function jobFromQuote(q: SavedQuote, opts: { acceptedOn?: string; startDate?: string } = {}): Job {
  const s = q.data as EstimateState
  const acceptedOn = opts.acceptedOn ?? todayIso()
  const startDate = opts.startDate ?? nextMonday(acceptedOn)
  const weeks = Math.max(0, Math.floor(s.quote.durationWeeks))
  const termsDays = 7
  const now = new Date().toISOString()
  return {
    id: newId(),
    quoteId: q.id,
    ref: s.quote.ref,
    client: s.quote.clientName,
    clientEmail: s.quote.clientEmail?.trim() || undefined,
    address: s.quote.clientAddress.split('\n').map((l) => l.trim()).filter(Boolean).join(', '),
    jobType: s.input.jobType,
    acceptedOn,
    startDate,
    weeks,
    termsDays,
    stages: defaultStages(
      weeks,
      {
        footings: s.input.footings.include,
        roof: s.input.roof.include,
        electrical: s.input.electrical.include,
        plumbing: s.input.plumbing.include,
      },
      newId,
    ),
    payments: planPayments({ total: priceOf(s).total, depositPct: s.quote.depositPct, weeks, acceptedOn, startDate, termsDays, id: newId }),
    status: 'booked',
    createdAt: now,
    updatedAt: now,
  }
}
