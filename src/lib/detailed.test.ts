import { describe, it, expect } from 'vitest'
import { computeDetailed, type DetailedInput, type Settings } from './detailed'
import libData from '../data/rate-library.json'
import exampleData from '../data/detailed-example.json'
import type { RateLibrary } from './types'

const lib = libData as unknown as RateLibrary
const example = () => structuredClone(exampleData) as DetailedInput
// London (+30%) × 3% inflation, VAT registered — the workbook's Start Here settings.
const settings: Settings = { uplift: 1.3 * 1.03, vatRegistered: true, vat: 0.2 }

describe('computeDetailed — reconciles to the workbook example (30 Clowders Road)', () => {
  const r = computeDetailed(example(), lib, settings)

  it('labour and materials', () => {
    expect(r.labour[0].rate).toBeCloseTo(294.58, 2)
    expect(r.labour[0].cost).toBeCloseTo(10310.3, 2)
    expect(r.labourTotal).toBeCloseTo(21343.66, 2)
    expect(r.materialsTotal).toBeCloseTo(5567.562, 2)
  })

  it('feeder tabs', () => {
    expect(r.footings.concreteVolume).toBe(23.1)
    expect(r.footings.excavatedVolume).toBe(14.4)
    expect(r.footings.concrete).toBeCloseTo(3866.3625, 2)
    expect(r.footings.excavation).toBeCloseTo(1928.16, 2)
    expect(r.footings.total).toBeCloseTo(5794.5225, 2)
    expect(r.roof.low).toBeCloseTo(3374.28, 2)
    expect(r.roof.high).toBeCloseTo(5998.72, 2)
    expect(r.roof.mid).toBeCloseTo(4686.5, 2)
    expect(r.electrical.roomsTotal).toBeCloseTo(8341.97, 2)
    expect(r.electrical.total).toBeCloseTo(10551.32, 2)
    expect(r.plumbing.total).toBeCloseTo(7351.11, 2)
    expect(r.plant.total).toBe(1220)
    expect(r.waste.total).toBe(330)
  })

  it('price build-up', () => {
    expect(r.feesTotal).toBeCloseTo(31333.4525, 2)
    expect(r.access).toBeCloseTo(2691.1222, 2)
    expect(r.direct).toBeCloseTo(29602.3442, 2)
    expect(r.contingency).toBeCloseTo(5920.46884, 2)
    expect(r.markup).toBeCloseTo(7104.562608, 2)
    expect(r.subcontract).toBeCloseTo(37600.143, 2)
    expect(r.net).toBeCloseTo(80227.51865, 2)
    expect(r.vat).toBeCloseTo(16045.50373, 2)
    expect(r.total).toBeCloseTo(96273.02238, 2)
    expect(r.perM2).toBeCloseTo(6418.201492, 2)
  })

  it('margin breakdown', () => {
    expect(r.margin.mgmtFee).toBeCloseTo(37600.143 - 31333.4525, 2)
    expect(r.margin.totalMarkup).toBeCloseTo(7104.562608 + 6266.6905, 2)
    expect(r.margin.pct).toBeCloseTo(r.margin.totalMarkup / r.net, 6)
  })
})

describe('computeDetailed — switches and edge cases', () => {
  it('charges the skip permit only when the skip is on the highway', () => {
    const input = example()
    input.waste.onHighway = true
    expect(computeDetailed(input, lib, settings).waste.total).toBe(390)
  })

  it('uses the hand-dig rate when dig method is Hand', () => {
    const input = example()
    input.footings.digMethod = 'Hand'
    expect(computeDetailed(input, lib, settings).footings.excavation).toBeCloseTo(14.4 * 300 * 1.339, 2)
  })

  it('electrics PC sum overrides the schedule', () => {
    const input = example()
    input.electrical.override = 5000
    expect(computeDetailed(input, lib, settings).packages.find((p) => p.key === 'electrical')!.amount).toBe(5000)
  })

  it('excluded packages contribute nothing', () => {
    const input = example()
    for (const k of ['footings', 'roof', 'electrical', 'plumbing', 'plant', 'waste'] as const) input[k].include = false
    expect(computeDetailed(input, lib, settings).feesTotal).toBe(1400)
  })

  it('plant and waste are not uplifted', () => {
    const r = computeDetailed(example(), lib, { ...settings, uplift: 2 })
    expect(r.plant.total).toBe(1220)
    expect(r.waste.total).toBe(330)
  })

  it('no VAT when not VAT registered; unknown items price at zero', () => {
    const input = example()
    input.labour.push({ item: 'Not in library', qty: 5 })
    const r = computeDetailed(input, lib, { ...settings, vatRegistered: false })
    expect(r.vat).toBe(0)
    expect(r.labour.at(-1)!.cost).toBe(0)
    expect(r.labour.at(-1)!.unit).toBe('?')
  })
})
