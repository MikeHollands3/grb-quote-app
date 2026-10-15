import { moneyBuckets, sumOf, todayIso, type MoneyItem } from './lib/jobs'
import { jobsChanged, listJobs, onJobsChanged, putJob } from './lib/jobs-store'
import { shortDate } from './jobs-ui'
import type { XeroLink } from './xero-link'

const gbp2 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 })
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export interface MoneyOptions {
  onOpenJob: (jobId: string) => void
  xero?: XeroLink
}

export function mountMoney(root: HTMLElement, opts: MoneyOptions) {
  let items = new Map<string, MoneyItem>()
  let toRaise: MoneyItem[] = []
  const x = opts.xero
  const xeroOn = () => x?.state().kind === 'connected'

  const xeroCard = () => {
    if (!x) return ''
    const st = x.state()
    const busy = 'busy' in st && st.busy
    const err = 'error' in st && st.error ? `<p class="drive-error">${esc(st.error)}</p>` : ''
    const msg = st.kind === 'connected' && st.message ? `<p class="hint ok">${esc(st.message)}</p>` : ''
    if (st.kind === 'no-google')
      return `<div class="card drive"><h3>Xero</h3><p class="hint">Connect Google Drive on the Quotes tab first — Xero uses your GRB Google sign-in.</p></div>`
    if (st.kind === 'needs-google-signin' || st.kind === 'unknown')
      return `<div class="card drive"><h3>Xero</h3>${err}<button type="button" class="ghost" data-x="signin" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Check Xero connection'}</button></div>`
    if (st.kind === 'disconnected')
      return `<div class="card drive"><h3>Xero</h3><p class="hint">Create invoices in Xero straight from here, and see payments come in.</p>${err}
        <button type="button" class="primary" data-x="connect" ${busy ? 'disabled' : ''}>Connect Xero</button></div>`
    const set = x.settings()
    return `<div class="card drive"><h3>Xero <span class="tag tag-in-house">connected</span></h3>
      <p class="hint">${esc(st.tenantName)}${st.connectedBy ? ` · connected by ${esc(st.connectedBy)}` : ''}</p>
      ${msg}${err}
      <div class="row">
        <div class="field"><label>New invoices</label><select data-xs="mode">
          <option value="DRAFT"${set.mode === 'DRAFT' ? ' selected' : ''}>Draft</option>
          <option value="AUTHORISED"${set.mode === 'AUTHORISED' ? ' selected' : ''}>Approve + email</option>
        </select></div>
        <div class="field"><label>Sales account</label><input type="text" inputmode="numeric" data-xs="accountCode" value="${esc(set.accountCode)}"></div>
      </div>
      <p class="hint">${set.mode === 'DRAFT' ? 'Drafts: review and send them from Xero.' : 'Approved invoices are emailed to the client by Xero (needs the client’s email on the job).'}</p>
      <div class="actions"><button type="button" class="ghost" data-x="check" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : 'Check payments'}</button></div>
      <button type="button" class="linkish" data-x="disconnect">Disconnect Xero</button>
    </div>`
  }

  const row = (it: MoneyItem, mode: 'invoice' | 'due' | 'paid') => {
    const { job, payment: p } = it
    const key = `${job.id}:${p.id}`
    items.set(key, it)
    const action =
      p.status === 'scheduled'
        ? (xeroOn() && mode === 'invoice' ? `<button type="button" class="ghost small won" data-xcreate="${key}">Create in Xero</button>` : '') +
          `<button type="button" class="ghost small" data-set="${key}:invoiced">Mark invoiced</button>`
        : p.status === 'invoiced'
          ? `<button type="button" class="ghost small" data-set="${key}:paid">Mark paid</button>`
          : `<button type="button" class="ghost small" data-set="${key}:invoiced">Undo paid</button>`
    const date = mode === 'invoice' ? `Invoice ${shortDate(p.invoiceDate)}` : mode === 'paid' ? `Paid ${shortDate(p.paidOn ?? p.due)}` : `Due ${shortDate(p.due)}`
    return `<li class="money">
      <button type="button" class="saved-main" data-open-job="${job.id}">
        <span class="saved-ref">${esc(job.ref || 'No ref')} · ${esc(p.label)}</span>
        <span class="saved-addr">${esc(job.client || job.address)}</span>
        <span class="saved-meta">${date} · ${p.status}${p.xero?.number ? ` · Xero ${esc(p.xero.number)}` : ''}</span>
      </button>
      <span class="saved-total">${gbp2.format(p.amount)}</span>
      <span class="saved-actions">${action}</span>
    </li>`
  }

  const section = (title: string, list: MoneyItem[], mode: 'invoice' | 'due' | 'paid', hint = '', cls = '') =>
    list.length
      ? `<h2 class="${cls}">${title}<span class="h-total">${gbp2.format(sumOf(list))}</span></h2>
         ${hint ? `<p class="hint">${hint}</p>` : ''}
         <div class="card"><ul class="saved-list">${list.map((i) => row(i, mode)).join('')}</ul></div>`
      : ''

  const render = (jobs: Awaited<ReturnType<typeof listJobs>>) => {
    items = new Map()
    const b = moneyBuckets(jobs.filter((j) => j.payments.length), todayIso())
    toRaise = b.toInvoice
    const outstanding = [...b.toInvoice, ...b.overdue, ...b.thisWeek, ...b.nextFourWeeks, ...b.later]
    root.innerHTML = `
      <h1>Money in</h1>
      <p class="lede">Every payment due across your jobs. ${gbp2.format(sumOf(outstanding))} outstanding${b.overdue.length ? `, ${gbp2.format(sumOf(b.overdue))} overdue` : ''}.</p>
      ${xeroCard()}
      ${xeroOn() && b.toInvoice.length > 1 ? `<button type="button" class="primary" data-x="create-all">Create all ${b.toInvoice.length} in Xero</button>` : ''}
      ${
        jobs.length
          ? `${section('Invoices to raise', b.toInvoice, 'invoice', xeroOn() ? 'Due to go out now — create them in Xero.' : 'Due to go out now — raise these invoices, then mark them invoiced.', 'attn')}
             ${section('Overdue', b.overdue, 'due', 'Chase these, or mark paid once they show in the bank.', 'late')}
             ${section('Due this week', b.thisWeek, 'due')}
             ${section('Next 4 weeks', b.nextFourWeeks, 'due')}
             ${section('Later', b.later, 'due')}
             ${section('Paid in the last 30 days', b.paidLast30, 'paid')}
             ${outstanding.length || b.paidLast30.length ? '' : '<div class="card"><p class="hint">Nothing outstanding.</p></div>'}`
          : '<div class="card"><p class="hint">No jobs yet. Mark a quote as won to see its payments here.</p></div>'
      }`
  }

  const refresh = async () => render(await listJobs())

  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('button')
    if (!b) return
    if (b.dataset.openJob) return opts.onOpenJob(b.dataset.openJob)
    if (x && b.dataset.x) {
      const a = b.dataset.x
      if (a === 'signin') x.signIn()
      else if (a === 'connect') x.connect()
      else if (a === 'check') x.checkPayments()
      else if (a === 'create-all') x.create(toRaise)
      else if (a === 'disconnect' && confirm('Disconnect Xero? Invoices already in Xero are not affected.')) x.disconnect()
      return
    }
    if (x && b.dataset.xcreate) {
      const it = items.get(b.dataset.xcreate)
      if (it) x.create([it])
      return
    }
    if (!b.dataset.set) return
    const [jobId, payId, status] = b.dataset.set.split(':')
    const it = items.get(`${jobId}:${payId}`)
    if (!it) return
    const p = it.job.payments.find((x) => x.id === payId)!
    p.status = status as typeof p.status
    if (status === 'paid') p.paidOn = todayIso()
    else delete p.paidOn
    await putJob(it.job)
    jobsChanged()
    await refresh()
  })

  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement
    if (x && el.dataset.xs) x.saveSettings({ [el.dataset.xs]: el.value })
  })

  onJobsChanged(() => {
    if (!root.hidden) void refresh()
  })
  x?.subscribe(() => {
    if (!root.hidden) void refresh()
  })

  return {
    refresh,
    /** Tab shown: refresh, and let Xero quietly check for payments. */
    show: () => {
      void refresh()
      void x?.onShow()
    },
  }
}
