import libData from './data/rate-library.json'
import ratesData from './data/rates.json'
import exampleData from './data/detailed-example.json'
import { computeDetailed, CONTINGENCY, PERMIT_ITEM, type DetailedInput, type DetailedResult } from './lib/detailed'
import { gbp, uplift } from './lib/pricing'
import type { RateLibrary, Rates } from './lib/types'

const lib = libData as unknown as RateLibrary
const rates = ratesData as unknown as Rates
const STORE = 'grb.detailed.v1'

interface State {
  region: string
  input: DetailedInput
}

const gbp2 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 })
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function exampleState(): State {
  return { region: 'London / South-East (+30%)', input: structuredClone(exampleData) as DetailedInput }
}

function blankState(): State {
  const s = exampleState()
  const i = s.input
  i.jobRef = ''
  i.area = 0
  i.labour = [{ item: '', qty: 0 }]
  i.materials = [{ item: '', qty: 0 }]
  i.sundries = 0
  i.footings.length = 0
  i.roof.area = 0
  i.electrical.rooms = []
  for (const l of [...i.electrical.fixed, ...i.plumbing.lines, ...i.waste.lines]) l.qty = 0
  i.plant.lines = []
  i.plant.delivery = 0
  i.fees = i.fees.map((f) => ({ ...f, amount: 0 }))
  return s
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORE)
    if (raw) {
      const s = JSON.parse(raw) as State
      if (s?.input?.labour && s.input.footings && rates.regions[s.region] !== undefined) return s
    }
  } catch {
    /* storage blocked or corrupt — fall back to the example */
  }
  return exampleState()
}

function save(s: State) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s))
  } catch {
    /* private mode etc. — the estimate still works, it just won't persist */
  }
}

// ---------- path helpers: inputs carry data-path="labour.0.qty" ----------

function getAt(obj: unknown, path: string): unknown {
  return path.split('.').reduce<any>((o, k) => o?.[k], obj)
}
function setAt(obj: unknown, path: string, value: unknown) {
  const keys = path.split('.')
  const last = keys.pop()!
  const parent = keys.reduce<any>((o, k) => o[k], obj)
  parent[last] = value
}

// ---------- markup builders ----------

const options = (keys: string[], selected: string, placeholder?: string) =>
  (placeholder ? `<option value="">${placeholder}</option>` : '') +
  keys.map((k) => `<option${k === selected ? ' selected' : ''}>${esc(k)}</option>`).join('')

function num(path: string, value: number, attrs = '') {
  return `<input type="number" inputmode="decimal" step="any" data-path="${path}" data-type="num" value="${Number.isFinite(value) ? value : ''}" ${attrs}>`
}
function pctInput(path: string, value: number, label: string) {
  return `<div class="pct"><input type="number" inputmode="decimal" step="any" data-path="${path}" data-type="pct" value="${Math.round(value * 1000) / 10}" aria-label="${label}"><span>%</span></div>`
}
function text(path: string, value: string, attrs = '') {
  return `<input type="text" data-path="${path}" data-type="text" value="${esc(value)}" ${attrs}>`
}
function check(path: string, value: boolean, label: string) {
  return `<label class="check"><input type="checkbox" data-path="${path}" data-type="bool"${value ? ' checked' : ''}> ${label}</label>`
}
const out = (key: string, cls = '') => `<span class="out ${cls}" data-out="${key}"></span>`
const field = (label: string, control: string, hint = '') =>
  `<div class="field"><label>${label}</label>${control}${hint ? `<small>${hint}</small>` : ''}</div>`

function itemRows(section: 'labour' | 'materials', s: State) {
  const cat = section === 'labour' ? 'Labour' : 'Material'
  const names = lib.items.filter((i) => i.category === cat).map((i) => i.item)
  return s.input[section]
    .map(
      (l, idx) => `
      <div class="line">
        <select data-path="${section}.${idx}.item" data-type="text" aria-label="${cat} item">${options(names, l.item, `Choose ${cat.toLowerCase()}…`)}</select>
        <div class="line-nums">
          ${num(`${section}.${idx}.qty`, l.qty, 'aria-label="Quantity"')}
          ${out(`${section}.${idx}.meta`, 'meta')}
          ${out(`${section}.${idx}.cost`, 'cost')}
          <button type="button" class="icon" data-remove="${section}.${idx}" aria-label="Remove line">×</button>
        </div>
      </div>`,
    )
    .join('')
}

function fixedRows(section: string, lines: { item: string; qty: number }[]) {
  return lines
    .map(
      (l, idx) => `
      <div class="fixed">
        <span class="name">${esc(l.item)}</span>
        ${num(`${section}.${idx}.qty`, l.qty, `aria-label="${esc(l.item)} quantity"`)}
        ${out(`${section}.${idx}.cost`, 'cost')}
      </div>`,
    )
    .join('')
}

const TAGS: Record<string, [string, string]> = {
  footings: ['in-house', 'Own team — in direct works, carries contingency and overhead &amp; profit.'],
  roof: ['subbed', 'Subcontracted — base cost plus the subcontract markup.'],
  electrical: ['subbed', 'Subcontracted — base cost plus the subcontract markup.'],
  plumbing: ['subbed', 'Subcontracted — base cost plus the subcontract markup.'],
  plant: ['at cost', 'Passed through at cost — no markup.'],
  waste: ['at cost', 'Passed through at cost — no markup.'],
}

function pkg(key: string, title: string, body: string, s: State) {
  const inc = (s.input as any)[key].include as boolean
  const [tag, note] = TAGS[key]
  return `
    <details class="pkg" data-pkg="${key}">
      <summary><span>${title}</span><span class="tag tag-${tag.replace(' ', '-')}">${tag}</span>${out(`pkg.${key}`, 'cost')}</summary>
      <div class="pkg-body">
        ${check(`${key}.include`, inc, 'Include in this estimate')}
        <p class="hint">${note}</p>
        ${body}
      </div>
    </details>`
}

function view(s: State) {
  const i = s.input
  const plantNames = lib.plantHire.map((p) => p.item)
  return `
  <h1>Detailed estimate</h1>
  <p class="lede">Build a priced quote from labour days, materials and subcontract packages. Rates come from the rate library with the region and ${Math.round(rates.inflation * 100)}% inflation uplift. Footings are priced as in-house work, roof, electrics and plumbing as subcontracted, and plant, skips and fees at cost.</p>

  <div class="card">
    ${field('Job ref / client', text('input.jobRef', i.jobRef, 'placeholder="e.g. 30 Clowders Road"'))}
    ${field('Job type', `<select data-path="input.jobType" data-type="text">${options(Object.keys(lib.benchmarks), i.jobType)}</select>`)}
    <div class="row">
      ${field('Floor area', `<div class="unit">${num('input.area', i.area, 'min="0"')}</div>`)}
      ${field('Uplift', `<div class="static">${out('uplift')}</div>`)}
    </div>
    ${field('Region', `<select data-path="region" data-type="text">${options(Object.keys(rates.regions), s.region)}</select>`)}
  </div>

  <h2>1. Labour <span class="h-total">${out('labourTotal')}</span></h2>
  <div class="card lines">${itemRows('labour', s)}<button type="button" class="add" data-add="labour">+ Add labour</button></div>

  <h2>2. Materials <span class="h-total">${out('materialsTotal')}</span></h2>
  <div class="card lines">${itemRows('materials', s)}<button type="button" class="add" data-add="materials">+ Add material</button>
    ${field('Sundries / consumables £', num('input.sundries', i.sundries ?? 0), 'Lump-sum allowance; counts as materials')}</div>

  <h2>3. Subcontract, fees &amp; preliminaries <span class="h-total">${out('feesTotal')}</span></h2>
  <div class="pkgs">
    ${pkg(
      'footings',
      'Footings',
      `<div class="grid2">
        ${field('Trench length (lin m)', num('input.footings.length', i.footings.length))}
        ${field('Trench width (m)', num('input.footings.width', i.footings.width))}
        ${field('Concrete depth (m)', num('input.footings.concreteDepth', i.footings.concreteDepth))}
        ${field('Excavation depth (m)', num('input.footings.excavationDepth', i.footings.excavationDepth))}
        ${field('Overbreak', pctInput('input.footings.overbreak', i.footings.overbreak, 'Overbreak percent'))}
        ${field('Dig method', `<select data-path="input.footings.digMethod" data-type="text">${options(['Machine', 'Hand'], i.footings.digMethod)}</select>`)}
        ${field('Machine dig £/m³', num('input.footings.machineRate', i.footings.machineRate))}
        ${field('Hand dig £/m³', num('input.footings.handRate', i.footings.handRate))}
        ${field('Concrete £/m³ (national)', num('input.footings.concreteRate', i.footings.concreteRate ?? NaN, 'placeholder="Library rate"'), 'Blank = rate library')}
        ${field('Surcharge / pump £', num('input.footings.surcharge', i.footings.surcharge))}
      </div>
      <dl class="calc">
        <dt>Concrete</dt><dd>${out('footings.concreteVolume')} m³ · ${out('footings.concrete')}</dd>
        <dt>Excavation + disposal</dt><dd>${out('footings.excavatedVolume')} m³ · ${out('footings.excavation')}</dd>
        <dt>£ per linear m</dt><dd>${out('footings.perLinM')}</dd>
      </dl>`,
      s,
    )}
    ${pkg(
      'roof',
      'Roof',
      `${field('Covering', `<select data-path="input.roof.covering" data-type="text">${options(Object.keys(lib.roofCoverings), i.roof.covering)}</select>`)}
      <div class="grid2">
        ${field('Roof area (m²)', num('input.roof.area', i.roof.area), 'Pitched ≈ floor × 1.2–1.5')}
        ${field('Structure £/m²', num('input.roof.structurePerM2', i.roof.structurePerM2), '~0 flat, 40–60 pitched')}
      </div>
      <dl class="calc"><dt>Low – high</dt><dd>${out('roof.range')}</dd><dt>Midpoint (used)</dt><dd>${out('roof.mid')}</dd></dl>`,
      s,
    )}
    ${pkg(
      'electrical',
      'Electrics',
      `<div class="rooms-head"><span>Room</span><span>Sockets</span><span>Lights</span><span>Downl.</span><span>Switch</span><span></span></div>
      ${i.electrical.rooms
        .map(
          (r, idx) => `<div class="room">
            ${text(`input.electrical.rooms.${idx}.name`, r.name, 'aria-label="Room name"')}
            ${(['sockets', 'lights', 'downlights', 'switches'] as const).map((k) => num(`input.electrical.rooms.${idx}.${k}`, r[k], `aria-label="${k}"`)).join('')}
            <button type="button" class="icon" data-remove="electrical.rooms.${idx}" aria-label="Remove room">×</button>
            ${out(`electrical.rooms.${idx}`, 'cost room-cost')}
          </div>`,
        )
        .join('')}
      <button type="button" class="add" data-add="rooms">+ Add room</button>
      <h3>Fixed items &amp; certification</h3>
      ${fixedRows('input.electrical.fixed', i.electrical.fixed)}
      ${field('PC sum override £', num('input.electrical.override', i.electrical.override), 'Enter a £ figure to replace the schedule total; 0 = use schedule')}
      <dl class="calc"><dt>Schedule total</dt><dd>${out('electrical.schedule')}</dd></dl>`,
      s,
    )}
    ${pkg('plumbing', 'Plumbing &amp; heating', fixedRows('input.plumbing.lines', i.plumbing.lines), s)}
    ${pkg(
      'plant',
      'Plant hire',
      `<p class="hint">Actual hire-shop prices — not region/inflation uplifted.</p>
      ${i.plant.lines
        .map(
          (l, idx) => `<div class="line">
            <select data-path="input.plant.lines.${idx}.item" data-type="text" aria-label="Plant item">${options(plantNames, l.item, 'Choose kit…')}</select>
            <div class="line-nums">
              ${num(`input.plant.lines.${idx}.qty`, l.qty, 'aria-label="Quantity"')}
              ${num(`input.plant.lines.${idx}.weeks`, l.weeks, 'aria-label="Hire weeks"')}
              ${out(`plant.${idx}.cost`, 'cost')}
              <button type="button" class="icon" data-remove="plant.lines.${idx}" aria-label="Remove line">×</button>
            </div>
          </div>`,
        )
        .join('')}
      <p class="hint">Qty · weeks (1 day ≈ 0.2 wk)</p>
      <button type="button" class="add" data-add="plant">+ Add plant</button>
      ${field('Delivery &amp; collection £', num('input.plant.delivery', i.plant.delivery))}`,
      s,
    )}
    ${pkg(
      'waste',
      'Waste &amp; muck-away',
      `<p class="hint">Actual local prices — not uplifted. Foundation spoil is already in Footings.</p>
      ${check('input.waste.onHighway', i.waste.onHighway, 'Skip on public highway (council permit needed)')}
      ${fixedRows('input.waste.lines', i.waste.lines)}`,
      s,
    )}
    <div class="card fees">
      <h3>Other fees <span class="tag tag-at-cost">at cost</span></h3>
      <datalist id="fee-items">${lib.fees.map((f) => `<option value="${esc(f.item)}">£${f.low}–£${f.high} ${esc(f.unit)}</option>`).join('')}</datalist>
      ${i.fees
        .map(
          (f, idx) => `<div class="fee">
            ${text(`input.fees.${idx}.description`, f.description, 'list="fee-items" aria-label="Fee description"')}
            ${num(`input.fees.${idx}.amount`, f.amount, 'aria-label="Amount £"')}
            <button type="button" class="icon" data-remove="fees.${idx}" aria-label="Remove fee">×</button>
          </div>`,
        )
        .join('')}
      <button type="button" class="add" data-add="fees">+ Add fee</button>
    </div>
  </div>

  <h2>4. Price build-up</h2>
  <div class="card buildup">
    <div class="bu"><span>Labour + materials</span>${out('lm')}</div>
    <div class="bu"><span>Restricted access / double handling</span>${pctInput('input.accessPct', i.accessPct, 'Access uplift percent')}${out('access')}</div>
    <div class="bu"><span>Footings (in-house)</span>${out('footingsInHouse')}</div>
    <div class="bu strong"><span>Direct works</span>${out('direct')}</div>
    <div class="bu"><span>Contingency on direct works</span>${pctInput('input.contingencyPct', i.contingencyPct, 'Contingency percent')}${out('contingency')}</div>
    <div class="bu-note">${check('input.drawingsConfirmed', !!i.drawingsConfirmed, 'Drawings &amp; spec confirmed (12% → 8%)')}</div>
    <div class="bu"><span>Overhead &amp; profit on direct works</span>${pctInput('input.markupPct', i.markupPct, 'Markup percent')}${out('markup')}</div>
    <div class="bu"><span>Subbed: roof, electrics, plumbing</span>${out('subcontractBase')}</div>
    <div class="bu"><span>Subcontract markup</span>${pctInput('input.subcontractFeePct', i.subcontractFeePct, 'Subcontract markup percent')}${out('mgmtFee')}</div>
    <div class="bu"><span>Plant, waste &amp; fees (at cost)</span>${out('atCost')}</div>
    <div class="bu strong"><span>Net price (ex VAT)</span>${out('net')}</div>
    <div class="bu"><span>VAT</span>${out('vat')}</div>
  </div>

  <div class="result">
    <div class="cap">Total to client — inc VAT</div>
    <div class="range" data-out="total"></div>
    <div class="mid" data-out="perM2"></div>
  </div>

  <details class="card margin">
    <summary>Margin breakdown</summary>
    <dl class="calc">
      <dt>Total cost base (excl. contingency &amp; markup)</dt><dd>${out('m.costBase')}</dd>
      <dt>Contingency</dt><dd>${out('contingency2')}</dd>
      <dt>Overhead &amp; profit</dt><dd>${out('markup2')}</dd>
      <dt>Subcontract markup</dt><dd>${out('m.mgmtFee')}</dd>
      <dt>Gross margin (excl. contingency)</dt><dd>${out('m.margin')}</dd>
      <dt>Gross margin (incl. contingency)</dt><dd>${out('m.marginInc')}</dd>
    </dl>
    <p class="hint">Contingency is a risk allowance, not guaranteed profit — unspent, it becomes extra margin.</p>
  </details>

  <div class="actions">
    <button type="button" class="ghost" data-action="example">Load example job</button>
    <button type="button" class="ghost" data-action="clear">Start blank</button>
  </div>

  <div class="totalbar" aria-hidden="true"><span>Total inc VAT</span><b data-out="total"></b></div>`
}

function outputs(r: DetailedResult, s: State): Record<string, string> {
  const o: Record<string, string> = {
    uplift: `× ${(Math.round(uplift(rates, s.region) * 1000) / 1000).toFixed(3)}`,
    labourTotal: gbp.format(r.labourTotal),
    materialsTotal: gbp.format(r.materialsTotal),
    feesTotal: gbp.format(r.feesTotal),
    'footings.concreteVolume': String(r.footings.concreteVolume),
    'footings.concrete': gbp.format(r.footings.concrete),
    'footings.excavatedVolume': String(r.footings.excavatedVolume),
    'footings.excavation': gbp.format(r.footings.excavation),
    'footings.perLinM': r.footings.perLinM ? gbp.format(r.footings.perLinM) : '—',
    'roof.range': `${gbp.format(r.roof.low)} – ${gbp.format(r.roof.high)}`,
    'roof.mid': gbp.format(r.roof.mid),
    'electrical.schedule': gbp.format(r.electrical.schedule),
    lm: gbp.format(r.labourTotal + r.materialsTotal),
    access: gbp.format(r.access),
    direct: gbp.format(r.direct),
    contingency: gbp.format(r.contingency),
    contingency2: gbp.format(r.contingency),
    markup: gbp.format(r.markup),
    markup2: gbp.format(r.markup),
    footingsInHouse: gbp.format(r.footingsInHouse),
    subcontractBase: gbp.format(r.subcontractBase),
    mgmtFee: gbp.format(r.margin.mgmtFee),
    atCost: gbp.format(r.atCost),
    net: gbp.format(r.net),
    vat: gbp.format(r.vat),
    total: gbp2.format(r.total),
    perM2: s.input.area > 0 ? `${gbp.format(r.perM2)} /m² inc VAT · ${gbp2.format(r.net)} ex VAT` : `${gbp2.format(r.net)} ex VAT`,
    'm.costBase': gbp.format(r.margin.costBase),
    'm.mgmtFee': gbp.format(r.margin.mgmtFee),
    'm.margin': `${gbp.format(r.margin.totalMarkup)} · ${pct(r.margin.pct)}`,
    'm.marginInc': `${gbp.format(r.margin.inclContingency)} · ${pct(r.margin.inclContingencyPct)}`,
  }
  for (const p of r.packages) o[`pkg.${p.key}`] = gbp.format(p.amount)

  // Line outputs are indexed by input position; priced lines skip blank items.
  for (const sec of ['labour', 'materials'] as const) {
    let k = 0
    s.input[sec].forEach((l, idx) => {
      const pl = l.item ? r[sec][k++] : undefined
      o[`${sec}.${idx}.meta`] = pl ? `${pl.unit} @ ${gbp2.format(pl.rate)}` : ''
      o[`${sec}.${idx}.cost`] = pl ? gbp.format(pl.cost) : '—'
    })
  }
  r.electrical.rooms.forEach((rm, idx) => (o[`electrical.rooms.${idx}`] = gbp.format(rm.cost)))
  const fixedOut = (path: string, lines: { item: string }[], priced: { cost: number }[]) =>
    lines.forEach((_, idx) => (o[`${path}.${idx}.cost`] = gbp.format(priced[idx]?.cost ?? 0)))
  fixedOut('input.electrical.fixed', s.input.electrical.fixed, r.electrical.fixed)
  fixedOut('input.plumbing.lines', s.input.plumbing.lines, r.plumbing.lines)
  fixedOut('input.waste.lines', s.input.waste.lines, r.waste.lines)
  if (!s.input.waste.onHighway) {
    const idx = s.input.waste.lines.findIndex((l) => l.item === PERMIT_ITEM)
    if (idx >= 0) o[`input.waste.lines.${idx}.cost`] = 'n/a'
  }
  let k = 0
  s.input.plant.lines.forEach((l, idx) => (o[`plant.${idx}.cost`] = l.item ? gbp.format(r.plant.lines[k++].cost) : '—'))
  return o
}

export function mountDetailed(root: HTMLElement) {
  let state = load()

  const update = () => {
    const r = computeDetailed(state.input, lib, {
      uplift: uplift(rates, state.region),
      vatRegistered: true,
      vat: rates.vat,
    })
    const o = outputs(r, state)
    root.querySelectorAll<HTMLElement>('[data-out]').forEach((el) => {
      el.textContent = o[el.dataset.out!] ?? ''
    })
    root.querySelectorAll<HTMLDetailsElement>('[data-pkg]').forEach((d) => {
      d.classList.toggle('off', !(state.input as any)[d.dataset.pkg!].include)
    })
  }

  const render = () => {
    const open = new Set([...root.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.pkg ?? 'margin'))
    root.innerHTML = view(state)
    root.querySelectorAll<HTMLDetailsElement>('details').forEach((d) => {
      if (open.has(d.dataset.pkg ?? 'margin')) d.open = true
    })
    update()
  }

  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement
    const path = el.dataset.path
    if (!path) return
    const full = path.startsWith('input.') || path === 'region' ? path : `input.${path}`
    let value: unknown
    switch (el.dataset.type) {
      case 'num':
        value = el.value === '' && full === 'input.footings.concreteRate' ? null : parseFloat(el.value) || 0
        break
      case 'pct':
        value = (parseFloat(el.value) || 0) / 100
        break
      case 'bool':
        value = (el as HTMLInputElement).checked
        break
      default:
        value = el.value
    }
    setAt(state, full, value)
    if (full === 'input.drawingsConfirmed') {
      state.input.contingencyPct = value ? CONTINGENCY.confirmed : CONTINGENCY.preDrawings
      save(state)
      render()
      return
    }
    save(state)
    update()
  })

  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button')
    if (!btn) return
    const i = state.input
    if (btn.dataset.add) {
      const add: Record<string, () => void> = {
        labour: () => i.labour.push({ item: '', qty: 1 }),
        materials: () => i.materials.push({ item: '', qty: 1 }),
        rooms: () => i.electrical.rooms.push({ name: 'Room', sockets: 0, lights: 0, downlights: 0, switches: 0 }),
        plant: () => i.plant.lines.push({ item: '', qty: 1, weeks: 1 }),
        fees: () => i.fees.push({ description: '', amount: 0 }),
      }
      add[btn.dataset.add]()
    } else if (btn.dataset.remove) {
      const parts = btn.dataset.remove.split('.')
      const idx = Number(parts.pop())
      ;(getAt(i, parts.join('.')) as unknown[]).splice(idx, 1)
    } else if (btn.dataset.action === 'example') {
      state = exampleState()
    } else if (btn.dataset.action === 'clear') {
      if (!confirm('Clear this estimate and start blank?')) return
      state = blankState()
    } else return
    save(state)
    render()
  })

  render()
}
