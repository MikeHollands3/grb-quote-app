import { describe, it, expect } from 'vitest'
import { computeDetailed, type DetailedInput, type Settings } from './detailed'
import libData from '../data/rate-library.json'
import exampleData from '../data/detailed-example.json'
import type { RateLibrary } from './types'

const lib = libData as unknown as RateLibrary
const example = () => structuredClone(exampleData) as DetailedInput
// London (+30%) × 3% inflation, VAT registered — the workbook's Start Here settings.
const settings: Settings = { uplift: 1.3 * 1.03, vatRegistered: true, vat: 0.2 }

describe('computeDetailed — line items and feeder tabs reconcile to the workbook example (30 Clowders Road)', () => {
  const r = computeDetailed(example(), lib, settings)

  it('labour and materials', () => {
    expect(r.labour[0].rate).toBeCloseTo(294.58, 2)
    expect(r.labour[0].cost).toBeCloseTo(10310.3, 2)
    expect(r.labourTotal).toBeCloseTo(21343.66, 2)
    expect(r.materials.reduce((a, l) => a + l.cost, 0)).toBeCloseTo(5567.562, 2)
    expect(r.materialsTotal).toBeCloseTo(5567.562 + 500, 2) // + sundries, moved from fees
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
    // Workbook: 1220. Now uses D&S Surfacing invoice rates (dumper £165/wk) and £100 delivery + collection.
    expect(r.plant.total).toBe(300 + 165 + 110 + 2 * 100 + 2 * 120 + 100)
    expect(r.waste.total).toBe(330)
  })

  it('section 3 total: workbook figure less sundries (now materials) and the plant changes', () => {
    expect(r.feesTotal).toBeCloseTo(31333.4525 - 500 - (1220 - 1115), 2)
  })
})

describe('computeDetailed — GRB price build-up on the workbook example', () => {
  // Built from the workbook's own feeder values so each step is traceable.
  const lm = 21343.66 + 5567.562 + 500 // + sundries
  const access = lm * 0.1 // 2691.1222
  const footings = 5794.5225
  const subbed = 4686.5 + 10551.32 + 7351.11 // roof + electrics + plumbing
  const atCost = 1115 + 330 + 900 // plant + waste + Building Control
  const direct = lm + access + footings
  const contingency = direct * 0.12
  const markup = (direct + contingency) * 0.2
  const mgmtFee = subbed * 0.2
  const subContingency = subbed * 0.05
  const net = direct + contingency + markup + subbed + mgmtFee + subContingency + atCost

  const r = computeDetailed(example(), lib, settings)

  it('footings are in-house direct works', () => {
    expect(r.footingsInHouse).toBeCloseTo(footings, 2)
    expect(r.direct).toBeCloseTo(direct, 2)
    expect(r.contingency).toBeCloseTo(contingency, 2)
    expect(r.markup).toBeCloseTo(markup, 2)
  })

  it('only roof, electrics and plumbing carry the subcontract markup', () => {
    expect(r.subcontractBase).toBeCloseTo(subbed, 2)
    expect(r.margin.mgmtFee).toBeCloseTo(mgmtFee, 2)
    expect(r.subcontract).toBeCloseTo(subbed + mgmtFee, 2)
  })

  it('subbed packages carry 5% contingency, not marked up', () => {
    expect(r.subContingency).toBeCloseTo(subContingency, 2)
    expect(r.margin.contingency).toBeCloseTo(contingency + subContingency, 2)
    expect(r.margin.inclContingency).toBeCloseTo(markup + mgmtFee + contingency + subContingency, 2)
  })

  it('plant, waste and fees pass through at cost', () => {
    expect(r.atCost).toBe(atCost)
  })

  it('net, VAT and total', () => {
    expect(r.net).toBeCloseTo(net, 2)
    expect(r.vat).toBeCloseTo(net * 0.2, 2)
    expect(r.total).toBeCloseTo(net * 1.2, 2)
    expect(r.margin.totalMarkup).toBeCloseTo(markup + mgmtFee, 2)
    expect(r.margin.costBase).toBeCloseTo(direct + subbed + atCost, 2)
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
    const r = computeDetailed(input, lib, settings)
    expect(r.feesTotal).toBe(900)
    expect(r.footingsInHouse).toBe(0)
    expect(r.subcontractBase).toBe(0)
  })

  it('plant and waste are not uplifted', () => {
    const r = computeDetailed(example(), lib, { ...settings, uplift: 2 })
    expect(r.plant.total).toBe(1115)
    expect(r.waste.total).toBe(330)
  })

  it('local actual rates skip the region/inflation uplift', () => {
    const input = example()
    input.materials.push({ item: 'Screened topsoil (grab load, delivered)', qty: 2 })
    const line = computeDetailed(input, lib, settings).materials.at(-1)!
    expect(line.rate).toBe(250)
    expect(line.cost).toBe(500)
    expect(line.local).toBe(true)
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
