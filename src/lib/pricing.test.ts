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
    // 1900 * 1.30 * 1.03 * 25 = 63602.50 ex VAT low
    expect(r.exLow).toBeCloseTo(63602.5, 2)
    expect(r.incLow).toBeCloseTo(76323, 2)
    expect(r.incHigh).toBeCloseTo(96408, 2)
    expect(r.midpoint).toBeCloseTo(86365.5, 2)
  })

  it('matches the workbook Quick Quote tab (24 m² standard single-storey, London)', () => {
    const r = computeQuote(
      { job: 'Single-storey rear extension', spec: 'Standard', area: 24,
        region: 'London / South-East (+30%)', roof: 'Flat / lean-to (baseline)' },
      rates,
    )
    expect(r.exLow).toBeCloseTo(61058.4, 2)
    expect(r.incLow).toBeCloseTo(73270.08, 2)
    expect(r.midpoint).toBeCloseTo(82910.88, 2)
  })

  it('applies the roof adder and regional multiplier', () => {
    const r = computeQuote(
      { job: 'Loft - dormer', spec: 'Premium', area: 30,
        region: 'Midlands / UK average (+0%)', roof: 'Pitched - tiled' },
      rates,
    )
    // (2000 + 200) * 1.0 * 1.03 * 30 = 67980 ex VAT low -> 81576 inc VAT
    expect(r.incLow).toBeCloseTo(81576, 2)
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
