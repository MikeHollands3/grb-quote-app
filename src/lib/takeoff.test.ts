import { describe, it, expect } from 'vitest'
import libData from '../data/rate-library.json'
import exampleData from '../data/detailed-example.json'
import { applyTakeoff, catalogue, takeoffSchema, type Takeoff } from './takeoff'
import { computeDetailed, type DetailedInput } from './detailed'
import type { RateLibrary } from './types'

const lib = libData as unknown as RateLibrary
const base = () => structuredClone(exampleData) as DetailedInput

const takeoff = (over: Partial<Takeoff> = {}): Takeoff => ({
  summary: 'Rear dormer loft conversion.',
  clientName: 'Megan Harrold',
  siteAddress: '87 Bramshot Avenue, London SE7 7HX',
  drawingsRef: 'B179789-02-3100 rev A',
  jobType: 'Loft - dormer',
  area: 28,
  durationWeeks: 8,
  scope: ['Strip out loft', 'Build rear dormer'],
  measurements: [{ what: 'Dormer width', quantity: 5.71, unit: 'm', source: 'Rear elevation' }],
  labour: [{ item: 'General builder (multi-skilled)', qty: 30 }, { item: 'Not a real trade', qty: 5 }, { item: 'Plasterer', qty: 0 }],
  materials: [{ item: 'Rooflight (Velux mid-size, supply)', qty: 3 }],
  footings: { include: false, length: 0, width: 0, concreteDepth: 0, excavationDepth: 0 },
  roof: { include: true, covering: 'GRP fibreglass (flat)', area: 21 },
  electricalRooms: [{ name: 'Bedroom 3', sockets: 4, lights: 1, downlights: 0, switches: 1 }],
  electricalFixed: [{ item: 'EICR / test & certification', qty: 1 }],
  plumbing: [{ item: 'Shower - mixer/electric install', qty: 1 }, { item: 'Radiator (supply + fit)', qty: 2 }],
  plant: [{ item: 'Scaffold tower (alloy 4-6m)', qty: 1, weeks: 6 }],
  waste: [{ item: 'Builder skip (8-yard)', qty: 3 }, { item: 'Council skip permit / licence', qty: 3 }],
  fees: [{ item: lib.fees[0].item, amount: 800 }],
  assumptions: ['Existing joists need upgrading.'],
  questions: ['Party wall agreement in place?'],
  ...over,
})

describe('catalogue', () => {
  it('splits every library item into exactly one section', () => {
    const c = catalogue(lib)
    const sections = [c.labour, c.materials, c.electricalFixed, c.plumbing, c.waste].flat()
    expect(new Set(sections).size).toBe(sections.length)
    const points = 4 // socket / light / downlight / switch points are counted per room
    expect(sections.length + points).toBe(lib.items.length)
    expect(c.plumbing).toContain('Combi boiler replacement (supply + fit)')
    expect(c.materials).not.toContain('Radiator (supply + fit)')
    expect(c.electricalFixed).toHaveLength(6)
  })

  it('schema constrains item names to the catalogue and requires every field', () => {
    const s = takeoffSchema(lib) as { required: string[]; properties: Record<string, { items?: { properties: { item: { enum: string[] } } } }> }
    expect(s.required).toContain('labour')
    expect(s.properties.labour.items!.properties.item.enum).toEqual(catalogue(lib).labour)
  })
})

describe('applyTakeoff', () => {
  it('fills the estimate from the takeoff, dropping unknown items and zero quantities', () => {
    const i = applyTakeoff(base(), takeoff(), lib)
    expect(i.jobType).toBe('Loft - dormer')
    expect(i.jobRef).toBe('87 Bramshot Avenue')
    expect(i.area).toBe(28)
    expect(i.labour).toEqual([{ item: 'General builder (multi-skilled)', qty: 30 }])
    expect(i.footings.include).toBe(false)
    expect(i.roof).toMatchObject({ include: true, covering: 'GRP fibreglass (flat)', area: 21 })
    expect(i.electrical.rooms).toHaveLength(1)
    expect(i.electrical.fixed.find((l) => l.item === 'EICR / test & certification')!.qty).toBe(1)
    expect(i.electrical.fixed.filter((l) => l.qty > 0)).toHaveLength(1)
    expect(i.plumbing.lines.filter((l) => l.qty > 0).map((l) => l.item)).toEqual(['Radiator (supply + fit)', 'Shower - mixer/electric install'])
    expect(i.plant).toMatchObject({ include: true, lines: [{ item: 'Scaffold tower (alloy 4-6m)', qty: 1, weeks: 6 }] })
    expect(i.fees.find((f) => f.description === lib.fees[0].item)!.amount).toBe(800)
    expect(i.drawingsConfirmed).toBe(false)
    expect(i.contingencyPct).toBe(0.12)
  })

  it('keeps GRB package settings and produces a priced estimate', () => {
    const b = base()
    const i = applyTakeoff(b, takeoff(), lib)
    expect(i.markupPct).toBe(b.markupPct)
    expect(i.footings.machineRate).toBe(b.footings.machineRate)
    const r = computeDetailed(i, lib, { uplift: 1.339, vatRegistered: true, vat: 0.2 })
    expect(r.total).toBeGreaterThan(0)
  })

  it('switches off empty packages and survives junk values', () => {
    const t = takeoff({
      roof: { include: true, covering: 'Thatch', area: -4 },
      electricalRooms: [],
      electricalFixed: [],
      plumbing: [],
      plant: [{ item: 'Mini excavator 1.5t (self-drive)', qty: 1, weeks: 0 }],
      labour: [],
      area: Number.NaN,
    })
    const i = applyTakeoff(base(), t, lib)
    expect(i.roof.include).toBe(false)
    expect(i.electrical.include).toBe(false)
    expect(i.plumbing.include).toBe(false)
    expect(i.plant.include).toBe(false)
    expect(i.labour).toEqual([{ item: '', qty: 0 }])
    expect(i.area).toBe(0)
  })
})
