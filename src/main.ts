import './styles.css'
import ratesData from './data/rates.json'
import { computeQuote, gbp } from './lib/pricing'
import type { Rates, Spec } from './lib/types'
import { mountDetailed } from './detailed-ui'
import { mountSaved } from './saved-ui'
import { createDriveSync, HOSTED_DOMAIN } from './drive-sync'
import type { SavedQuote } from './lib/saved'

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
        <button type="button" role="tab" data-tab="saved" aria-selected="false">Saved</button>
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

    <section id="saved" hidden></section>

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

const drive = createDriveSync()
const escHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function driveCard(): string {
  const st = drive.state()
  if (st.kind === 'unconfigured')
    return `<div class="card drive"><p class="hint">Google Drive saving isn’t switched on in this build yet.</p></div>`
  if (st.kind === 'disconnected')
    return `<div class="card drive">
      <h3>Google Drive</h3>
      <p class="hint">Save every quote (PDF + editable copy) to a “GRB Quotes” folder in your GRB Google Drive. Use your @${HOSTED_DOMAIN} account.</p>
      ${st.error ? `<p class="drive-error">${escHtml(st.error)}</p>` : ''}
      <button type="button" class="primary" data-drive="connect">Connect Google Drive</button>
    </div>`
  const status = st.syncing
    ? 'Uploading…'
    : st.pending
      ? `${st.pending} quote${st.pending === 1 ? '' : 's'} waiting to upload`
      : 'All quotes uploaded'
  return `<div class="card drive">
    <h3>Google Drive <span class="tag tag-in-house">connected</span></h3>
    <p class="hint">${escHtml(st.email)} · ${status}${!navigator.onLine ? ' · offline' : ''}</p>
    ${st.error ? `<p class="drive-error">${escHtml(st.error)}</p>` : ''}
    <div class="actions">
      <button type="button" class="ghost" data-drive="sync" ${st.syncing ? 'disabled' : ''}>${st.needsSignIn ? 'Sign in &amp; sync' : 'Sync now'}</button>
      ${st.folderId ? `<a class="ghost file-btn" href="https://drive.google.com/drive/folders/${encodeURIComponent(st.folderId)}" target="_blank" rel="noopener">Open folder</a>` : ''}
    </div>
    <button type="button" class="linkish" data-drive="disconnect">Disconnect Google Drive on this device</button>
  </div>`
}

function driveBadge(q: SavedQuote): string {
  if (drive.state().kind !== 'connected') return ''
  return q.drive?.status === 'synced' ? 'On Drive ✓' : q.drive?.status === 'error' ? 'Upload failed' : 'Waiting to upload'
}

const detailed = mountDetailed(document.getElementById('detailed')!, {
  beforeSave: () => drive.beforeSave(),
  onSaved: () => drive.afterSave(),
})
const saved = mountSaved(document.getElementById('saved')!, {
  header: driveCard,
  badge: driveBadge,
  onOpen: (q) => {
    detailed.open(q)
    showTab('detailed')
    window.scrollTo(0, 0)
  },
  onDeleted: (id) => detailed.forget(id),
  currentId: () => detailed.currentId(),
})

drive.subscribe(() => {
  if (!document.getElementById('saved')!.hidden) void saved.refresh()
})
document.getElementById('saved')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-drive]')
  if (!b) return
  if (b.dataset.drive === 'disconnect') {
    if (confirm('Disconnect Google Drive on this device? Quotes already on Drive stay there.')) drive.disconnect()
  } else drive.connectOrSync()
})

const TAB = 'grb.tab'
function showTab(tab: string) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    const on = b.dataset.tab === tab
    b.setAttribute('aria-selected', String(on))
    document.getElementById(b.dataset.tab!)!.hidden = !on
  }
  if (tab === 'saved') void saved.refresh()
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
  const t = localStorage.getItem(TAB)
  initialTab = t === 'detailed' || t === 'saved' ? t : 'quick'
} catch {
  /* ignore */
}
showTab(initialTab)
