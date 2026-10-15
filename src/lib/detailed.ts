import type { RateLibrary } from './types'

/**
 * Detailed estimator. Pure mirror of the workbook's Detailed Estimate tab and
 * the five tabs that feed it (Groundworks & Roof, Electrical Schedule,
 * Plumbing & Heating, Plant Hire, Waste & Muck-Away).
 *
 * Rate-library rates are multiplied by the region × inflation uplift, exactly
 * as the workbook does. Plant hire and waste are actual local prices and are
 * NOT uplifted.
 *
 * The price build-up follows GRB's practice rather than the workbook's: footings
 * are in-house direct works, roof/electrics/plumbing are subcontracted and
 * marked up, and plant, waste and fees pass through at cost.
 */

export interface QtyLine {
  item: string
  qty: number
}

export interface PlantLine extends QtyLine {
  weeks: number
}

export interface ElectricalRoom {
  name: string
  sockets: number
  lights: number
  downlights: number
  switches: number
}

export interface FeeLine {
  description: string
  amount: number
}

export type DigMethod = 'Machine' | 'Hand'

export interface DetailedInput {
  jobRef: string
  jobType: string
  area: number
  labour: QtyLine[]
  materials: QtyLine[]
  /** Sundries / consumables allowance (£, not uplifted) — counted as materials. */
  sundries: number
  footings: {
    include: boolean
    length: number
    width: number
    concreteDepth: number
    excavationDepth: number
    overbreak: number
    /** National £/m³ before uplift; null = Rate Library ready-mix rate. */
    concreteRate: number | null
    digMethod: DigMethod
    machineRate: number
    handRate: number
    surcharge: number
  }
  roof: {
    include: boolean
    covering: string
    area: number
    structurePerM2: number
  }
  electrical: {
    include: boolean
    rooms: ElectricalRoom[]
    fixed: QtyLine[]
    /** PC sum; when > 0 it replaces the schedule total. */
    override: number
  }
  plumbing: { include: boolean; lines: QtyLine[] }
  plant: { include: boolean; lines: PlantLine[]; delivery: number }
  waste: { include: boolean; lines: QtyLine[]; onHighway: boolean }
  fees: FeeLine[]
  accessPct: number
  /** Drawings + spec confirmed: contingency drops from 12% to 8% (the UI sets contingencyPct). */
  drawingsConfirmed: boolean
  contingencyPct: number
  markupPct: number
  subcontractFeePct: number
}

export interface Settings {
  /** Region × inflation multiplier. */
  uplift: number
  vatRegistered: boolean
  vat: number
}

export interface PricedLine {
  item: string
  qty: number
  unit: string
  rate: number
  cost: number
}

export type Treatment = 'inHouse' | 'subcontract' | 'atCost'

export const CONTINGENCY = { preDrawings: 0.12, confirmed: 0.08 } as const

export const PERMIT_ITEM = 'Council skip permit / licence'
export const CONCRETE_ITEM = 'Ready-mix concrete (C25-C35)'
export const POINT_ITEMS = {
  sockets: 'Double socket point (supply+fit)',
  lights: 'Light point / ceiling rose (supply+fit)',
  downlights: 'Recessed downlight (supply+fit)',
  switches: 'Light switch (supply+fit)',
} as const

const n = (v: number) => (Number.isFinite(v) ? v : 0)
const round1 = (v: number) => Math.round(v * 10) / 10
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export function libraryRate(lib: RateLibrary, item: string) {
  return lib.items.find((i) => i.item === item)
}

function priceLines(lines: QtyLine[], lib: RateLibrary, mult: number): PricedLine[] {
  return lines
    .filter((l) => l.item)
    .map((l) => {
      const r = libraryRate(lib, l.item)
      const rate = (r?.rate ?? 0) * mult
      return { item: l.item, qty: n(l.qty), unit: r?.unit ?? '?', rate, cost: n(l.qty) * rate }
    })
}

export function footingsCost(f: DetailedInput['footings'], lib: RateLibrary, mult: number) {
  const concreteVolume = round1(n(f.length) * n(f.width) * n(f.concreteDepth) * (1 + n(f.overbreak)))
  const baseRate = f.concreteRate ?? libraryRate(lib, CONCRETE_ITEM)?.rate ?? 0
  const concrete = concreteVolume * baseRate * mult + n(f.surcharge)
  const excavatedVolume = round1(n(f.length) * n(f.width) * n(f.excavationDepth))
  const digRate = f.digMethod === 'Hand' ? f.handRate : f.machineRate
  const excavation = excavatedVolume * n(digRate) * mult
  const total = concrete + excavation
  return {
    concreteVolume,
    concrete,
    excavatedVolume,
    excavation,
    total,
    perLinM: f.length > 0 ? total / f.length : 0,
  }
}

export function roofCost(r: DetailedInput['roof'], lib: RateLibrary, mult: number) {
  const cov = lib.roofCoverings[r.covering]
  const covLow = n(r.area) * (cov?.low ?? 0) * mult
  const covHigh = n(r.area) * (cov?.high ?? 0) * mult
  const structure = n(r.area) * n(r.structurePerM2) * mult
  const low = covLow + structure
  const high = covHigh + structure
  return { low, high, mid: (low + high) / 2 }
}

export function electricalCost(e: DetailedInput['electrical'], lib: RateLibrary, mult: number) {
  const pr = (k: keyof typeof POINT_ITEMS) => (libraryRate(lib, POINT_ITEMS[k])?.rate ?? 0) * mult
  const pointRates = { sockets: pr('sockets'), lights: pr('lights'), downlights: pr('downlights'), switches: pr('switches') }
  const rooms = e.rooms.map((rm) => ({
    name: rm.name,
    cost:
      n(rm.sockets) * pointRates.sockets +
      n(rm.lights) * pointRates.lights +
      n(rm.downlights) * pointRates.downlights +
      n(rm.switches) * pointRates.switches,
  }))
  const roomsTotal = sum(rooms.map((r) => r.cost))
  const fixed = priceLines(e.fixed, lib, mult)
  const fixedTotal = sum(fixed.map((l) => l.cost))
  const schedule = roomsTotal + fixedTotal
  return { pointRates, rooms, roomsTotal, fixed, fixedTotal, schedule, total: e.override > 0 ? e.override : schedule }
}

export function plumbingCost(p: DetailedInput['plumbing'], lib: RateLibrary, mult: number) {
  const lines = priceLines(p.lines, lib, mult)
  return { lines, total: sum(lines.map((l) => l.cost)) }
}

export function plantCost(p: DetailedInput['plant'], lib: RateLibrary) {
  const lines = p.lines
    .filter((l) => l.item)
    .map((l) => {
      const ref = lib.plantHire.find((h) => h.item === l.item)
      const week = ref?.week ?? 0
      return { item: l.item, qty: n(l.qty), weeks: n(l.weeks), day: ref?.day ?? 0, week, cost: n(l.qty) * n(l.weeks) * week }
    })
  const hire = sum(lines.map((l) => l.cost))
  return { lines, hire, total: hire + n(p.delivery) }
}

export function wasteCost(w: DetailedInput['waste'], lib: RateLibrary) {
  const lines = priceLines(w.lines, lib, 1).map((l) =>
    l.item === PERMIT_ITEM && !w.onHighway ? { ...l, cost: 0 } : l,
  )
  return { lines, total: sum(lines.map((l) => l.cost)) }
}

export function computeDetailed(input: DetailedInput, lib: RateLibrary, s: Settings) {
  const mult = s.uplift

  const labour = priceLines(input.labour, lib, mult)
  const materials = priceLines(input.materials, lib, mult)
  const labourTotal = sum(labour.map((l) => l.cost))
  const materialsTotal = sum(materials.map((l) => l.cost)) + n(input.sundries)

  const footings = footingsCost(input.footings, lib, mult)
  const roof = roofCost(input.roof, lib, mult)
  const electrical = electricalCost(input.electrical, lib, mult)
  const plumbing = plumbingCost(input.plumbing, lib, mult)
  const plant = plantCost(input.plant, lib)
  const waste = wasteCost(input.waste, lib)

  // How GRB treats each package (differs from the workbook, which marks up all of section 3):
  //   inHouse     — own team; part of direct works, so it carries contingency + overhead & profit
  //   subcontract — subbed trades; base cost + subcontract markup
  //   atCost      — plant, skips and fees; passed through with no markup
  const packages = [
    { key: 'footings', label: 'Footings', treatment: 'inHouse', amount: input.footings.include ? footings.total : 0 },
    { key: 'roof', label: 'Roof (midpoint)', treatment: 'subcontract', amount: input.roof.include ? roof.mid : 0 },
    { key: 'electrical', label: 'Electrics', treatment: 'subcontract', amount: input.electrical.include ? electrical.total : 0 },
    { key: 'plumbing', label: 'Plumbing & heating', treatment: 'subcontract', amount: input.plumbing.include ? plumbing.total : 0 },
    { key: 'plant', label: 'Plant hire', treatment: 'atCost', amount: input.plant.include ? plant.total : 0 },
    { key: 'waste', label: 'Waste & muck-away', treatment: 'atCost', amount: input.waste.include ? waste.total : 0 },
  ] as const
  const by = (t: Treatment) => sum(packages.filter((p) => p.treatment === t).map((p) => p.amount))
  const footingsInHouse = by('inHouse')
  const subcontractBase = by('subcontract')
  const otherFees = sum(input.fees.map((f) => n(f.amount)))
  const atCost = by('atCost') + otherFees
  const feesTotal = sum(packages.map((p) => p.amount)) + otherFees

  const access = (labourTotal + materialsTotal) * n(input.accessPct)
  const direct = labourTotal + materialsTotal + access + footingsInHouse
  const contingency = direct * n(input.contingencyPct)
  const markup = (direct + contingency) * n(input.markupPct)
  const mgmtFee = subcontractBase * n(input.subcontractFeePct)
  const subcontract = subcontractBase + mgmtFee
  const net = direct + contingency + markup + subcontract + atCost
  const vat = s.vatRegistered ? net * s.vat : 0
  const total = net + vat

  const totalMarkup = markup + mgmtFee

  return {
    labour,
    materials,
    labourTotal,
    materialsTotal,
    footings,
    roof,
    electrical,
    plumbing,
    plant,
    waste,
    packages,
    feesTotal,
    footingsInHouse,
    subcontractBase,
    atCost,
    access,
    direct,
    contingency,
    markup,
    subcontract,
    net,
    vat,
    total,
    perM2: input.area > 0 ? total / input.area : 0,
    margin: {
      costBase: direct + subcontractBase + atCost,
      mgmtFee,
      totalMarkup,
      pct: net ? totalMarkup / net : 0,
      inclContingency: totalMarkup + contingency,
      inclContingencyPct: net ? (totalMarkup + contingency) / net : 0,
    },
  }
}

export type DetailedResult = ReturnType<typeof computeDetailed>
