import { describe, it, expect } from 'vitest'
import { computeQuote } from './pricing'
import ratesData from '../data/rates.json'
import type { Rates } from './types'

const rates = ratesData as unknown as Rates

describe('computeQuote', () => {
  it('prices the standard London single-storey example', () => {
    const r = computeQuote(
      { job: 'Single-storey rear extension', spec: 'Standard', area: 25,
        region: 'London / South-East (+30%)', roof: 'Flat / lean-to (baseline)' },
      rates,
    )
    expect(Math.round(r.exLow)).toBe(61750)
    expect(Math.round(r.incLow)).toBe(74100)
    expect(Math.round(r.incHigh)).toBe(93600)
    expect(Math.round(r.midpoint)).toBe(83850)
  })

  it('applies the roof adder and regional multiplier', () => {
    const r = computeQuote(
      { job: 'Loft - dormer', spec: 'Premium', area: 30,
        region: 'Midlands / UK average (+0%)', roof: 'Pitched - tiled' },
      rates,
    )
    // (2000 + 200) * 1.0 * 30 = 66000 ex VAT low -> 79200 inc VAT
    expect(Math.round(r.incLow)).toBe(79200)
  })

  it('returns zeros for a non-positive area', () => {
    const r = computeQuote(
      { job: 'Bathroom refurbishment', spec: 'Budget', area: 0,
        region: 'North / lower cost (-5%)', roof: 'Flat / lean-to (baseline)' },
      rates,
    )
    expect(r.incLow).toBe(0)
    expect(r.midpoint).toBe(0)
  })
})
