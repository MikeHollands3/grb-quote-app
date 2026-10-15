import { moneyBuckets, sumOf, todayIso, type MoneyItem } from './lib/jobs'
import { jobsChanged, listJobs, onJobsChanged, putJob } from './lib/jobs-store'
import { shortDate } from './jobs-ui'

const gbp2 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 })
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export interface MoneyOptions {
  onOpenJob: (jobId: string) => void
}

export function mountMoney(root: HTMLElement, opts: MoneyOptions) {
  let items = new Map<string, MoneyItem>()

  const row = (it: MoneyItem, mode: 'invoice' | 'due' | 'paid') => {
    const { job, payment: p } = it
    const key = `${job.id}:${p.id}`
    items.set(key, it)
    const action =
      p.status === 'scheduled'
        ? `<button type="button" class="ghost small" data-set="${key}:invoiced">Mark invoiced</button>`
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
    const outstanding = [...b.toInvoice, ...b.overdue, ...b.thisWeek, ...b.nextFourWeeks, ...b.later]
    root.innerHTML = `
      <h1>Money in</h1>
      <p class="lede">Every payment due across your jobs. ${gbp2.format(sumOf(outstanding))} outstanding${b.overdue.length ? `, ${gbp2.format(sumOf(b.overdue))} overdue` : ''}.</p>
      ${
        jobs.length
          ? `${section('Invoices to raise', b.toInvoice, 'invoice', 'Due to go out now — raise these invoices, then mark them invoiced.', 'attn')}
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

  onJobsChanged(() => {
    if (!root.hidden) void refresh()
  })

  return { refresh }
}
