import { describe, it, expect } from 'vitest'
import { paymentSchedule } from './schedule'

describe('paymentSchedule', () => {
  it('30% deposit then 16 equal weeks, summing exactly to the total', () => {
    const rows = paymentSchedule(96273.02, 0.3, 16)
    expect(rows).toHaveLength(17)
    expect(rows[0].amount).toBe(28881.91)
    expect(rows[1].amount).toBe(4211.94)
    expect(rows[16].amount).toBe(4212.01) // final week absorbs the 7p rounding residue
    const sum = rows.reduce((a, r) => a + r.amount, 0)
    expect(Math.round(sum * 100) / 100).toBe(96273.02)
  })

  it('no weeks: deposit and balance on completion', () => {
    const rows = paymentSchedule(1000, 0.3, 0)
    expect(rows.map((r) => r.amount)).toEqual([300, 700])
  })
})
