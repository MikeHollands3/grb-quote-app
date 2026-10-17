import type { TakeoffNotes } from './lib/takeoff'
import libData from './data/rate-library.json'
import ratesData from './data/rates.json'
import companyData from './data/company.json'
import logoUrl from './assets/grb-logo.png'
import { computeDetailed, type DetailedInput } from './lib/detailed'
import { uplift } from './lib/pricing'
import type { QuoteDoc, Company } from './lib/quote-pdf'
import type { RateLibrary, Rates } from './lib/types'

const lib = libData as unknown as RateLibrary
const rates = ratesData as unknown as Rates

/** Everything the estimate screen keeps for one job. */
export interface EstimateState {
  /** Saved-quote id once saved on this device. */
  id?: string
  region: string
  input: DetailedInput
  quote: QuoteDoc
  /** How the draft was made, when it came from drawings. */
  takeoff?: TakeoffNotes
}

export const priceOf = (s: EstimateState) =>
  computeDetailed(s.input, lib, { uplift: uplift(rates, s.region), vatRegistered: true, vat: rates.vat })

export const fileBase = (s: EstimateState) =>
  `GRB Quotation ${s.quote.ref || 'draft'} - ${s.quote.clientAddress.split('\n')[0] || 'client'}`.replace(/[\\/:*?"<>|]/g, '-')

/** Builds the branded PDF. pdf-lib is loaded on demand (and precached for offline use). */
export async function quotePdf(s: EstimateState) {
  const [{ buildQuotePdf }, logo] = await Promise.all([
    import('./lib/quote-pdf'),
    fetch(logoUrl).then((res) => res.arrayBuffer()),
  ])
  const bytes = await buildQuotePdf(s.quote, priceOf(s), companyData as Company, new Uint8Array(logo))
  return { bytes, name: `${fileBase(s)}.pdf` }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
