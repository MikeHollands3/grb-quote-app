import type { DetailedInput } from './detailed'
import { CONTINGENCY, POINT_ITEMS } from './detailed'
import type { RateLibrary } from './types'

/**
 * Drawings → draft estimate. Claude reads the drawings (server side, see
 * functions/_lib/takeoff.ts) and returns a Takeoff: quantities against the
 * rate library's own item names. applyTakeoff() turns that into a normal
 * estimate the user checks and edits. Pure; shared by the app and the server.
 */

export interface Measurement {
  what: string
  quantity: number
  unit: string
  /** Where it came from, e.g. "Proposed loft plan, 3.64 m × 5.71 m". */
  source: string
}

export interface Takeoff {
  summary: string
  clientName: string
  siteAddress: string
  drawingsRef: string
  jobType: string
  area: number
  durationWeeks: number
  scope: string[]
  measurements: Measurement[]
  labour: { item: string; qty: number }[]
  materials: { item: string; qty: number }[]
  footings: { include: boolean; length: number; width: number; concreteDepth: number; excavationDepth: number }
  roof: { include: boolean; covering: string; area: number }
  electricalRooms: { name: string; sockets: number; lights: number; downlights: number; switches: number }[]
  electricalFixed: { item: string; qty: number }[]
  plumbing: { item: string; qty: number }[]
  plant: { item: string; qty: number; weeks: number }[]
  waste: { item: string; qty: number }[]
  fees: { item: string; amount: number }[]
  assumptions: string[]
  questions: string[]
}

/** What the server stores on the estimate so the user can see how the draft was made. */
export interface TakeoffNotes {
  readAt: string
  files: string[]
  summary: string
  measurements: Measurement[]
  assumptions: string[]
  questions: string[]
}

const ELECTRICAL_FIXED = [
  'Cooker / oven outlet point',
  'Outdoor socket (IP-rated)',
  'New radial / dedicated circuit',
  'Consumer unit replacement (RCBO, certified)',
  'EICR / test & certification',
  'EV charger install (7kW)',
]

/** Rate-library item names, split the way the Estimate tab splits them. */
export function catalogue(lib: RateLibrary) {
  const names = (cat: string) => lib.items.filter((i) => i.category === cat).map((i) => i.item)
  const points = new Set<string>(Object.values(POINT_ITEMS))
  const fixed = new Set(ELECTRICAL_FIXED)
  const material = names('Material')
  const plumbStart = material.indexOf('Radiator (supply + fit)')
  const plumbEnd = material.indexOf('Gas Safe commissioning / Benchmark cert')
  const plumbing = new Set(plumbStart >= 0 && plumbEnd >= plumbStart ? material.slice(plumbStart, plumbEnd + 1) : [])
  return {
    jobTypes: Object.keys(lib.benchmarks),
    labour: names('Labour'),
    materials: material.filter((m) => !points.has(m) && !fixed.has(m) && !plumbing.has(m)),
    electricalFixed: ELECTRICAL_FIXED.filter((m) => material.includes(m)),
    plumbing: [...plumbing],
    waste: names('Waste'),
    plant: lib.plantHire.map((p) => p.item),
    roofCoverings: Object.keys(lib.roofCoverings),
    fees: lib.fees.map((f) => f.item),
  }
}

/** The catalogue as text for the prompt: item, unit and (where it helps) what one unit is. */
export function catalogueText(lib: RateLibrary): string {
  const c = catalogue(lib)
  const unit = (item: string) => lib.items.find((i) => i.item === item)?.unit ?? ''
  const list = (items: string[]) => items.map((i) => `- ${i}${unit(i) ? ` [${unit(i)}]` : ''}`).join('\n')
  const fee = (f: RateLibrary['fees'][number]) => `- ${f.item} [${f.unit}, £${f.low}–£${f.high}]`
  return [
    `JOB TYPES:\n${c.jobTypes.map((j) => `- ${j}`).join('\n')}`,
    `LABOUR (quantity in days):\n${list(c.labour)}`,
    `MATERIALS:\n${list(c.materials)}`,
    `ELECTRICAL – fixed items (points per room are counted separately):\n${list(c.electricalFixed)}`,
    `PLUMBING & HEATING:\n${list(c.plumbing)}`,
    `WASTE:\n${list(c.waste)}`,
    `PLANT HIRE (quantity = number of machines, plus weeks on hire):\n${c.plant.map((p) => `- ${p}`).join('\n')}`,
    `ROOF COVERINGS:\n${c.roofCoverings.map((r) => `- ${r}`).join('\n')}`,
    `FEES (amount in £, within the range shown):\n${lib.fees.map(fee).join('\n')}`,
  ].join('\n\n')
}

/** JSON schema for structured output; item names are constrained to the catalogue. */
export function takeoffSchema(lib: RateLibrary) {
  const c = catalogue(lib)
  const obj = (properties: Record<string, unknown>) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  })
  const str = { type: 'string' }
  const num = { type: 'number' }
  const bool = { type: 'boolean' }
  const strs = { type: 'array', items: str }
  const qtyLines = (names: string[]) => ({ type: 'array', items: obj({ item: { type: 'string', enum: names }, qty: num }) })
  return obj({
    summary: str,
    clientName: str,
    siteAddress: str,
    drawingsRef: str,
    jobType: { type: 'string', enum: c.jobTypes },
    area: num,
    durationWeeks: { type: 'integer' },
    scope: strs,
    measurements: { type: 'array', items: obj({ what: str, quantity: num, unit: str, source: str }) },
    labour: qtyLines(c.labour),
    materials: qtyLines(c.materials),
    footings: obj({ include: bool, length: num, width: num, concreteDepth: num, excavationDepth: num }),
    roof: obj({ include: bool, covering: { type: 'string', enum: c.roofCoverings }, area: num }),
    electricalRooms: {
      type: 'array',
      items: obj({ name: str, sockets: { type: 'integer' }, lights: { type: 'integer' }, downlights: { type: 'integer' }, switches: { type: 'integer' } }),
    },
    electricalFixed: qtyLines(c.electricalFixed),
    plumbing: qtyLines(c.plumbing),
    plant: { type: 'array', items: obj({ item: { type: 'string', enum: c.plant }, qty: num, weeks: num }) },
    waste: qtyLines(c.waste),
    fees: { type: 'array', items: obj({ item: { type: 'string', enum: c.fees }, amount: num }) },
    assumptions: strs,
    questions: strs,
  })
}

const pos = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const known = (names: string[]) => {
  const set = new Set(names)
  return <T extends { item: string }>(lines: T[] | undefined) => (lines ?? []).filter((l) => set.has(l.item))
}

/**
 * Build an estimate from a takeoff on top of `base` (a blank estimate, so the
 * package settings — dig rates, markups, contingency — keep GRB's defaults).
 * Unknown item names are dropped; negative or missing quantities become 0.
 */
export function applyTakeoff(base: DetailedInput, t: Takeoff, lib: RateLibrary): DetailedInput {
  const c = catalogue(lib)
  const i = structuredClone(base)
  const qty = (lines: { item: string; qty: number }[]) => lines.map((l) => ({ item: l.item, qty: pos(l.qty) })).filter((l) => l.qty > 0)
  const setQty = (target: { item: string; qty: number }[], lines: { item: string; qty: number }[]) => {
    for (const l of target) l.qty = 0
    for (const l of qty(lines)) {
      const hit = target.find((x) => x.item === l.item)
      if (hit) hit.qty += l.qty
      else target.push({ ...l })
    }
  }

  i.jobRef = t.siteAddress.split(/[,\n]/)[0]?.trim() || i.jobRef
  if (c.jobTypes.includes(t.jobType)) i.jobType = t.jobType
  i.area = pos(t.area)

  const labour = qty(known(c.labour)(t.labour))
  const materials = qty(known(c.materials)(t.materials))
  i.labour = labour.length ? labour : [{ item: '', qty: 0 }]
  i.materials = materials.length ? materials : [{ item: '', qty: 0 }]

  const f = t.footings
  i.footings.include = !!f?.include && pos(f.length) > 0
  i.footings.length = pos(f?.length)
  if (pos(f?.width)) i.footings.width = pos(f.width)
  if (pos(f?.concreteDepth)) i.footings.concreteDepth = pos(f.concreteDepth)
  if (pos(f?.excavationDepth)) i.footings.excavationDepth = pos(f.excavationDepth)

  const r = t.roof
  i.roof.include = !!r?.include && pos(r.area) > 0
  i.roof.area = pos(r?.area)
  if (r && c.roofCoverings.includes(r.covering)) i.roof.covering = r.covering

  i.electrical.rooms = (t.electricalRooms ?? []).map((rm) => ({
    name: rm.name || 'Room',
    sockets: Math.round(pos(rm.sockets)),
    lights: Math.round(pos(rm.lights)),
    downlights: Math.round(pos(rm.downlights)),
    switches: Math.round(pos(rm.switches)),
  }))
  setQty(i.electrical.fixed, known(c.electricalFixed)(t.electricalFixed))
  i.electrical.override = 0
  i.electrical.include = i.electrical.rooms.length > 0 || i.electrical.fixed.some((l) => l.qty > 0)

  setQty(i.plumbing.lines, known(c.plumbing)(t.plumbing))
  i.plumbing.include = i.plumbing.lines.some((l) => l.qty > 0)

  i.plant.lines = known(c.plant)(t.plant)
    .map((l) => ({ item: l.item, qty: pos(l.qty), weeks: pos(l.weeks) }))
    .filter((l) => l.qty > 0 && l.weeks > 0)
  i.plant.include = i.plant.lines.length > 0
  if (i.plant.include && !i.plant.delivery) i.plant.delivery = 100

  setQty(i.waste.lines, known(c.waste)(t.waste))
  i.waste.include = i.waste.lines.some((l) => l.qty > 0)

  const fees = known(c.fees)(t.fees).filter((x) => pos(x.amount) > 0)
  for (const fee of i.fees) fee.amount = 0
  for (const fee of fees) {
    const hit = i.fees.find((x) => x.description === fee.item)
    if (hit) hit.amount = pos(fee.amount)
    else i.fees.push({ description: fee.item, amount: pos(fee.amount) })
  }

  // Planning-stage drawings: keep the pre-drawings contingency until the user confirms.
  i.drawingsConfirmed = false
  i.contingencyPct = CONTINGENCY.preDrawings
  return i
}
