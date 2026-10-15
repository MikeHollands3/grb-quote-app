import './styles.css'
import ratesData from './data/rates.json'
import { computeQuote, gbp } from './lib/pricing'
import type { Rates, Spec } from './lib/types'
import { mountDetailed } from './detailed-ui'

const rates = ratesData as unknown as Rates

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="wrap">
    <header>
      <svg class="mark" width="30" height="30" viewBox="0 0 48 48" aria-hidden="true" fill="none">
        <path d="M24 5 7 20h5v18h9V27h6v11h9V20h5L24 5Z" fill="currentColor"/>
      </svg>
      <div class="brand">
        <b>GRB</b>
        <span>Building &amp; Home Improvements</span>
      </div>
      <nav class="tabs" role="tablist">
        <button type="button" role="tab" data-tab="quick" aria-selected="true">Quick</button>
        <button type="button" role="tab" data-tab="detailed" aria-selected="false">Detailed</button>
      </nav>
    </header>

    <section id="quick">
    <h1>On-site ballpark estimator</h1>
    <p class="lede">Pick the job, the spec and the floor area for an indicative price range. For firm numbers, build it up on the detailed estimate from drawings.</p>

    <div class="card">
      <div class="field">
        <label for="job">Job type</label>
        <select id="job" aria-label="Job type"></select>
      </div>
      <div class="row">
        <div class="field">
          <label for="spec">Spec level</label>
          <select id="spec" aria-label="Spec level">
            <option>Budget</option><option selected>Standard</option><option>Premium</option>
          </select>
        </div>
        <div class="field">
          <label for="area">Floor area</label>
          <div class="unit"><input id="area" type="number" inputmode="decimal" min="1" step="1" value="25" aria-label="Floor area in square metres"></div>
        </div>
      </div>
      <div class="field">
        <label for="region">Region</label>
        <select id="region" aria-label="Region"></select>
      </div>
      <div class="field">
        <label for="roof">Roof type</label>
        <select id="roof" aria-label="Roof type"></select>
      </div>
    </div>

    <div class="result" role="status" aria-live="polite">
      <div class="cap">Indicative total — inc VAT</div>
      <div class="range" id="incRange">—</div>
      <div class="mid" id="midLine"></div>
      <div class="sub">
        <div><span class="k">Ex VAT</span><span class="v" id="exRange">—</span></div>
        <div><span class="k">Rate inc VAT</span><span class="v" id="perM2">—</span></div>
      </div>
    </div>

    <div class="notes">
      <p><b>Indicative only — not a quotation.</b> Figures are £/m² benchmarks × floor area, with a regional uplift, ${Math.round(rates.inflation * 100)}% inflation since the rates were last checked, and 20% VAT. They scope a conversation; they don't replace a measured, drawings-based estimate.</p>
      <p>Budget = straightforward spec and finishes · Standard = typical mid-range · Premium = high-end finishes, structural complexity, bespoke joinery.</p>
    </div>
    </section>

    <section id="detailed" hidden></section>

    <footer>GRB Builders (London) Ltd · rates reviewed Oct 2026</footer>
  </div>
`

const $ = (id: string) => document.getElementById(id) as HTMLSelectElement & HTMLInputElement

function fill(sel: HTMLElement, keys: string[]) {
  sel.innerHTML = keys.map((k) => `<option>${k}</option>`).join('')
}
fill($('job'), Object.keys(rates.benchmarks))
fill($('region'), Object.keys(rates.regions))
fill($('roof'), Object.keys(rates.roofs))
$('region').value = 'London / South-East (+30%)'

function calc() {
  const area = parseFloat($('area').value)
  const r = computeQuote(
    { job: $('job').value, spec: $('spec').value as Spec, area, region: $('region').value, roof: $('roof').value },
    rates,
  )
  if (!(area > 0)) {
    $('incRange').textContent = '—'
    $('midLine').textContent = 'Enter a floor area to see the range.'
    $('exRange').textContent = '—'
    $('perM2').textContent = '—'
    return
  }
  $('incRange').innerHTML = `${gbp.format(r.incLow)}<span class="dash">–</span>${gbp.format(r.incHigh)}`
  $('midLine').innerHTML = `Midpoint <b>${gbp.format(r.midpoint)}</b>`
  $('exRange').textContent = `${gbp.format(r.exLow)} – ${gbp.format(r.exHigh)}`
  $('perM2').textContent = `${gbp.format(r.perM2IncLow)} – ${gbp.format(r.perM2IncHigh)} /m²`
}

for (const id of ['job', 'spec', 'area', 'region', 'roof']) {
  $(id).addEventListener('input', calc)
  $(id).addEventListener('change', calc)
}
calc()

mountDetailed(document.getElementById('detailed')!)

const TAB = 'grb.tab'
function showTab(tab: string) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    const on = b.dataset.tab === tab
    b.setAttribute('aria-selected', String(on))
    document.getElementById(b.dataset.tab!)!.hidden = !on
  }
  try {
    localStorage.setItem(TAB, tab)
  } catch {
    /* ignore */
  }
}
document.querySelector('.tabs')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]')
  if (b) showTab(b.dataset.tab!)
})
let initialTab = 'quick'
try {
  initialTab = localStorage.getItem(TAB) === 'detailed' ? 'detailed' : 'quick'
} catch {
  /* ignore */
}
showTab(initialTab)
