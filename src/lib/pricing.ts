import type { Rates, QuoteInput, QuoteResult } from './types'

/**
 * Core pricing engine. Pure + framework-free so it can be unit-tested and
 * reused by the detailed estimator later.
 *
 * Range = benchmark £/m² (by job + spec) plus any roof £/m² adder,
 * times the region × inflation uplift, times floor area. VAT added last.
 */
/** Region × inflation multiplier — the workbook's "Combined price multiplier". */
export function uplift(rates: Rates, region: string): number {
  return (rates.regions[region] ?? 1) * (1 + rates.inflation)
}

export function computeQuote(input: QuoteInput, rates: Rates): QuoteResult {
  const base = rates.benchmarks[input.job]?.[input.spec] ?? [0, 0]
  const roof = rates.roofs[input.roof] ?? [0, 0]
  const mult = uplift(rates, input.region)
  const area = Number.isFinite(input.area) && input.area > 0 ? input.area : 0

  const exLow = (base[0] + roof[0]) * mult * area
  const exHigh = (base[1] + roof[1]) * mult * area
  const incLow = exLow * (1 + rates.vat)
  const incHigh = exHigh * (1 + rates.vat)

  return {
    exLow,
    exHigh,
    incLow,
    incHigh,
    midpoint: (incLow + incHigh) / 2,
    perM2IncLow: area ? incLow / area : 0,
    perM2IncHigh: area ? incHigh / area : 0,
  }
}

export const gbp = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
})
