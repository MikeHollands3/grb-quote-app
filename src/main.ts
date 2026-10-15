import './styles.css'
import ratesData from './data/rates.json'
import { computeQuote, gbp } from './lib/pricing'
import type { Rates, Spec } from './lib/types'
import { mountDetailed } from './detailed-ui'
import { mountSaved } from './saved-ui'
import { createDriveSync, HOSTED_DOMAIN } from './drive-sync'
import { mountJobs } from './jobs-ui'
import { createJobsSync } from './jobs-sync'
import { createXeroLink } from './xero-link'
import { mountMoney } from './money-ui'
import { jobFromQuote } from './job-from-quote'
import { jobsChanged, listJobs, onJobsChanged, putJob } from './lib/jobs-store'
import { getQuote } from './lib/saved'
import type { SavedQuote } from './lib/saved'
import { HELP_HTML } from './help'

const rates = ratesData as unknown as Rates

const ICONS: Record<string, string> = {
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  calc: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  pound: '<path d="M17 6.5A4.5 4.5 0 0 0 8.5 8.5V20M6 13h8M6 20h12"/>',
}
const icon = (k: string) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`

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
      <button type="button" class="help-btn" data-help aria-pressed="false" aria-label="How to use the app">?</button>
    </header>
    <nav class="tabs bottom-nav" role="tablist" aria-label="Sections">
      <button type="button" role="tab" data-tab="quick" aria-selected="true">${icon('bolt')}<span>Quick</span></button>
      <button type="button" role="tab" data-tab="detailed" aria-selected="false">${icon('calc')}<span>Estimate</span></button>
      <button type="button" role="tab" data-tab="saved" aria-selected="false">${icon('doc')}<span>Quotes</span></button>
      <button type="button" role="tab" data-tab="jobs" aria-selected="false">${icon('cal')}<span>Jobs</span></button>
      <button type="button" role="tab" data-tab="money" aria-selected="false">${icon('pound')}<span>Money</span></button>
    </nav>

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

    <section id="jobs" hidden></section>

    <section id="money" hidden></section>

    <section id="help" hidden>${HELP_HTML}</section>

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
// quoteId -> jobId, for the Won / View job buttons on the Quotes tab
let jobByQuote = new Map<string, string>()
const loadJobIndex = async () => {
  jobByQuote = new Map((await listJobs()).map((j) => [j.quoteId, j.id]))
}

const saved = mountSaved(document.getElementById('saved')!, {
  header: driveCard,
  badge: driveBadge,
  actions: (q) =>
    jobByQuote.has(q.id)
      ? `<button type="button" class="ghost small" data-view-job="${jobByQuote.get(q.id)}">View job</button>`
      : `<button type="button" class="ghost small won" data-won="${q.id}">Won → job</button>`,
  onOpen: (q) => {
    detailed.open(q)
    showTab('detailed')
    window.scrollTo(0, 0)
  },
  onDeleted: (id) => detailed.forget(id),
  currentId: () => detailed.currentId(),
})

const jobsSync = createJobsSync(drive)
const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

function googleCard(): string {
  const st = jobsSync.state()
  if (st.kind === 'off')
    return `<div class="card drive"><h3>Google Calendar &amp; Sheet</h3><p class="hint">Connect Google Drive on the Quotes tab to put jobs in a shared “GRB Jobs” calendar and the “GRB Jobs &amp; Payments” sheet.</p></div>`
  if (st.kind === 'needs-auth')
    return `<div class="card drive"><h3>Google Calendar &amp; Sheet</h3>
      <p class="hint">${st.reason === 'calendar' ? 'One more permission needed: allow GRB Quick Quote to create its own “GRB Jobs” calendar.' : 'Google sign-in has expired.'}</p>
      <button type="button" class="primary" data-gsync>${st.reason === 'calendar' ? 'Allow calendar &amp; sync' : 'Sign in &amp; sync'}</button></div>`
  const links = [
    st.calJobs && `<a class="ghost file-btn" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(st.calJobs)}">Jobs calendar</a>`,
    st.sheetId && `<a class="ghost file-btn" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/${encodeURIComponent(st.sheetId)}">Sheet</a>`,
  ].filter(Boolean)
  return `<div class="card drive"><h3>Google Calendar &amp; Sheet <span class="tag tag-in-house">on</span></h3>
    <p class="hint">${st.syncing ? 'Syncing…' : st.lastSync ? `Up to date · ${when(st.lastSync)}` : 'Not synced yet'}</p>
    ${st.error ? `<p class="drive-error">${escHtml(st.error)}</p>` : ''}
    <div class="actions"><button type="button" class="ghost" data-gsync ${st.syncing ? 'disabled' : ''}>Sync now</button>${links.join('')}</div>
  </div>`
}

const jobsUi = mountJobs(document.getElementById('jobs')!, {
  header: googleCard,
  onOpenQuote: async (quoteId) => {
    const q = await getQuote(quoteId)
    if (!q) return alert('That quote is no longer saved on this device.')
    detailed.open(q)
    showTab('detailed')
    window.scrollTo(0, 0)
  },
})
const xero = createXeroLink(drive)
const money = mountMoney(document.getElementById('money')!, {
  xero,
  onOpenJob: (id) => {
    showTab('jobs')
    void jobsUi.show(id)
    window.scrollTo(0, 0)
  },
})
onJobsChanged(() => void loadJobIndex())
jobsSync.subscribe(() => jobsUi.rerender())
drive.subscribe(() => jobsUi.rerender())
document.getElementById('jobs')!.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-gsync]')) jobsSync.connectAndSync()
})

document.getElementById('saved')!.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-won],[data-view-job]')
  if (!b) return
  let jobId = b.dataset.viewJob
  if (b.dataset.won) {
    const q = await getQuote(b.dataset.won)
    if (!q) return
    if (!(q.total > 0)) return alert('This quote has no price yet.')
    const job = jobFromQuote(q)
    await putJob(job)
    jobsChanged()
    jobId = job.id
  }
  showTab('jobs')
  await jobsUi.show(jobId!)
  window.scrollTo(0, 0)
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
  document.getElementById('help')!.hidden = tab !== 'help'
  document.querySelector('[data-help]')!.setAttribute('aria-pressed', String(tab === 'help'))
  if (tab === 'help') window.scrollTo(0, 0)
  if (tab === 'saved') void loadJobIndex().then(saved.refresh)
  if (tab === 'jobs') void jobsUi.refresh()
  if (tab === 'money') money.show()
  try {
    localStorage.setItem(TAB, tab)
    if (tab !== 'help') localStorage.setItem('grb.lastTab', tab)
  } catch {
    /* ignore */
  }
}
document.querySelector('.bottom-nav')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]')
  if (b) showTab(b.dataset.tab!)
})
document.querySelector('[data-help]')!.addEventListener('click', () => {
  let back = 'quick'
  try {
    back = localStorage.getItem('grb.lastTab') ?? 'quick'
  } catch {
    /* ignore */
  }
  showTab(document.getElementById('help')!.hidden ? 'help' : back)
})
let initialTab = 'quick'
try {
  const t = localStorage.getItem(TAB)
  // First visit on this device: open the guide.
  initialTab = t === null ? 'help' : ['detailed', 'saved', 'jobs', 'money', 'help'].includes(t) ? t : 'quick'
} catch {
  /* ignore */
}
showTab(initialTab)

// Back from Xero's consent page: /?xero=connected or /?xero=error&msg=…
{
  const q = new URLSearchParams(location.search)
  const r = q.get('xero')
  if (r === 'connected' || r === 'error') {
    xero.handleReturn(r, q.get('msg') ?? undefined)
    history.replaceState(null, '', location.pathname)
    showTab('money')
  }
}
