import {
  addDays,
  redatePayments,
  stageDates,
  todayIso,
  TRADES,
  type Job,
  type PaymentStatus,
  type Person,
  type Stage,
  type Trade,
} from './lib/jobs'
import { deleteJob, deletePerson, jobsChanged, listJobs, listPeople, onJobsChanged, putJob, putPerson } from './lib/jobs-store'
import { newId } from './lib/saved'

const gbp2 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 })
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const opt = (v: string, label: string, sel: string) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(label)}</option>`

export function jobEnd(job: Job) {
  return job.weeks > 0 ? addDays(job.startDate, job.weeks * 7 - 3) : job.startDate
}

/** Which stages are on site today. */
export function currentStages(job: Job, today: string) {
  return job.stages.filter((s) => {
    const d = stageDates(job, s)
    return d.start <= today && today <= addDays(d.end, 2)
  })
}

type View = { kind: 'list' } | { kind: 'job'; id: string } | { kind: 'people' }

export interface JobsOptions {
  onOpenQuote: (quoteId: string) => void
  /** Optional markup above the job list (Google calendar/sheet status). */
  header?: () => string
}

export function mountJobs(root: HTMLElement, opts: JobsOptions) {
  let jobs: Job[] = []
  let people: Person[] = []
  let view: View = { kind: 'list' }
  const job = () => {
    const v = view
    return v.kind === 'job' ? jobs.find((j) => j.id === v.id) : undefined
  }
  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? '?'

  // ---------- list ----------
  const jobCard = (j: Job, today: string) => {
    const now = currentStages(j, today)
    const next = j.payments.find((p) => p.status !== 'paid')
    const status =
      j.status === 'complete'
        ? 'Complete'
        : today < j.startDate
          ? `Starts ${shortDate(j.startDate)}`
          : today > jobEnd(j)
            ? 'Past planned finish'
            : `On site: ${now.map((s) => esc(s.name)).join(', ') || '—'}`
    const unassigned = j.stages.filter((s) => !s.who.length).length
    return `<li><button type="button" class="job-card" data-open-job="${j.id}">
      <span class="saved-ref">${esc(j.ref || 'No ref')}</span>
      <span class="saved-addr">${esc(j.address)}</span>
      <span class="saved-meta">${shortDate(j.startDate)} – ${shortDate(jobEnd(j))} · ${j.weeks} wks · ${status}</span>
      ${next ? `<span class="saved-meta">Next payment: ${esc(next.label)} ${gbp2.format(next.amount)} due ${shortDate(next.due)}</span>` : ''}
      ${unassigned && j.status !== 'complete' ? `<span class="warn">${unassigned} stage${unassigned === 1 ? '' : 's'} with nobody assigned</span>` : ''}
    </button></li>`
  }

  const listView = () => {
    const today = todayIso()
    const live = jobs.filter((j) => j.status !== 'complete')
    const done = jobs.filter((j) => j.status === 'complete')
    return `
      <h1>Jobs</h1>
      <p class="lede">Won quotes become jobs: programme, who's on site, and the payment plan.</p>
      ${opts.header?.() ?? ''}
      <button type="button" class="ghost" data-people>Team &amp; subbies (${people.length})</button>
      <h2>Booked &amp; on site</h2>
      <div class="card">${
        live.length
          ? `<ul class="saved-list">${live.map((j) => jobCard(j, today)).join('')}</ul>`
          : '<p class="hint">No jobs yet. On the Quotes tab, tap “Won → job” on a quote.</p>'
      }</div>
      ${done.length ? `<h2>Complete</h2><div class="card"><ul class="saved-list">${done.map((j) => jobCard(j, today)).join('')}</ul></div>` : ''}`
  }

  // ---------- job ----------
  const stageRow = (j: Job, s: Stage, i: number) => {
    const d = stageDates(j, s)
    const sorted = [...people].sort((a, b) => Number(b.trade === s.trade) - Number(a.trade === s.trade))
    return `<div class="stage">
      <div class="stage-top">
        <input type="text" data-j="stages.${i}.name" value="${esc(s.name)}" aria-label="Stage name">
        <button type="button" class="icon" data-remove-stage="${i}" aria-label="Remove stage">×</button>
      </div>
      <div class="stage-grid">
        <label>Trade<select data-j="stages.${i}.trade">${(Object.keys(TRADES) as Trade[]).map((t) => opt(t, TRADES[t], s.trade)).join('')}</select></label>
        <label>Week<input type="number" min="1" step="1" inputmode="numeric" data-j="stages.${i}.startWeek" data-num value="${s.startWeek}"></label>
        <label>Weeks<input type="number" min="1" step="1" inputmode="numeric" data-j="stages.${i}.weeks" data-num value="${s.weeks}"></label>
      </div>
      <p class="hint">${shortDate(d.start)} – ${shortDate(d.end)}</p>
      <div class="chips">${
        sorted.length
          ? sorted
              .map(
                (p) =>
                  `<button type="button" class="chip${s.who.includes(p.id) ? ' on' : ''}${p.trade === s.trade ? ' match' : ''}" data-who="${i}:${p.id}" aria-pressed="${s.who.includes(p.id)}">${esc(p.name)}</button>`,
              )
              .join('')
          : '<span class="hint">Add your team and subbies to assign people.</span>'
      }</div>
    </div>`
  }

  const paymentRow = (p: Job['payments'][number], i: number) => `<div class="pay">
      <div class="pay-main"><b>${esc(p.label)}</b><span>${gbp2.format(p.amount)}</span></div>
      <div class="pay-meta">Invoice ${shortDate(p.invoiceDate)} · due ${shortDate(p.due)}${p.xero?.number ? ` · Xero ${esc(p.xero.number)}` : ''}</div>
      <div class="pay-status">
        <select data-j="payments.${i}.status" aria-label="Status">${(['scheduled', 'invoiced', 'paid'] as PaymentStatus[])
          .map((st) => opt(st, st[0].toUpperCase() + st.slice(1), p.status))
          .join('')}</select>
        ${p.status === 'paid' ? `<input type="date" data-j="payments.${i}.paidOn" value="${esc(p.paidOn ?? '')}" aria-label="Paid on">` : ''}
      </div>
    </div>`

  const jobView = (j: Job) => {
    const paid = j.payments.filter((p) => p.status === 'paid').reduce((a, p) => a + p.amount, 0)
    const total = j.payments.reduce((a, p) => a + p.amount, 0)
    return `
      <button type="button" class="linkish back" data-back>← All jobs</button>
      <h1>${esc(j.ref || 'Job')} · ${esc(j.address)}</h1>
      <p class="lede">${esc(j.client)} · ${esc(j.jobType)} · ${gbp2.format(total)} inc VAT · ${gbp2.format(paid)} paid</p>
      <div class="card">
        <div class="row">
          <div class="field"><label>Accepted</label><input type="date" data-j="acceptedOn" value="${esc(j.acceptedOn)}"></div>
          <div class="field"><label>Start on site</label><input type="date" data-j="startDate" value="${esc(j.startDate)}"></div>
        </div>
        <div class="field"><label>Client email (for Xero invoices)</label><input type="email" inputmode="email" data-j="clientEmail" value="${esc(j.clientEmail ?? '')}" placeholder="name@example.com"></div>
        <div class="row">
          <div class="field"><label>Weeks</label><input type="number" min="0" step="1" inputmode="numeric" data-j="weeks" data-num value="${j.weeks}"></div>
          <div class="field"><label>Payment terms (days)</label><input type="number" min="0" step="1" inputmode="numeric" data-j="termsDays" data-num value="${j.termsDays}"></div>
        </div>
        <p class="hint">Planned finish ${shortDate(jobEnd(j))}. Moving the start date moves the programme and any payments not yet invoiced.</p>
      </div>

      <h2>Programme — who, what, where</h2>
      <div class="card stages">${j.stages.map((s, i) => stageRow(j, s, i)).join('')}
        <button type="button" class="add" data-add-stage>+ Add stage</button>
      </div>

      <h2>Payments — one invoice each</h2>
      <div class="card pays">${j.payments.map(paymentRow).join('')}</div>

      <div class="actions">
        <button type="button" class="ghost" data-open-quote="${j.quoteId}">Open quote</button>
        <button type="button" class="ghost" data-complete>${j.status === 'complete' ? 'Reopen job' : 'Mark complete'}</button>
      </div>
      <button type="button" class="linkish danger-link" data-delete-job>Delete this job</button>`
  }

  // ---------- people ----------
  const peopleView = () => `
    <button type="button" class="linkish back" data-back>← All jobs</button>
    <h1>Team &amp; subbies</h1>
    <p class="lede">People you can put on a stage. Subbies don't need an account — just a name.</p>
    <div class="card people">${
      people
        .map(
          (p) => `<div class="person">
        <div class="stage-top">
          <input type="text" data-p="${p.id}:name" value="${esc(p.name)}" placeholder="Name or company" aria-label="Name">
          <button type="button" class="icon" data-remove-person="${p.id}" aria-label="Remove">×</button>
        </div>
        <div class="stage-grid">
          <label>Type<select data-p="${p.id}:kind">${opt('team', 'Team', p.kind)}${opt('subbie', 'Subbie', p.kind)}</select></label>
          <label>Trade<select data-p="${p.id}:trade">${(Object.keys(TRADES) as Trade[]).map((t) => opt(t, TRADES[t], p.trade)).join('')}</select></label>
        </div>
        <div class="stage-grid two">
          <label>Phone<input type="tel" data-p="${p.id}:phone" value="${esc(p.phone ?? '')}"></label>
          <label>Email<input type="email" data-p="${p.id}:email" value="${esc(p.email ?? '')}"></label>
        </div>
      </div>`,
        )
        .join('') || '<p class="hint">Nobody added yet.</p>'
    }
      <button type="button" class="add" data-add-person>+ Add person</button>
    </div>`

  const render = () => {
    const j = job()
    if (view.kind === 'job' && !j) view = { kind: 'list' }
    root.innerHTML = view.kind === 'people' ? peopleView() : view.kind === 'job' && j ? jobView(j) : listView()
  }

  const refresh = async () => {
    ;[jobs, people] = await Promise.all([listJobs(), listPeople()])
    render()
  }

  const saveJob = async (j: Job) => {
    j.updatedAt = new Date().toISOString()
    await putJob(j)
    jobsChanged()
  }

  root.addEventListener('change', async (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement
    const j = job()
    if (el.dataset.j && j) {
      const path = el.dataset.j.split('.')
      const value: unknown = el.hasAttribute('data-num') ? Math.max(0, Math.floor(Number(el.value) || 0)) : el.value
      let target: any = j
      for (const k of path.slice(0, -1)) target = target[k]
      const key = path.at(-1)!
      if ((key === 'startWeek' || key === 'weeks') && path[0] === 'stages') target[key] = Math.max(1, value as number)
      else target[key] = value
      if (path[0] === 'payments' && key === 'status' && value === 'paid') target.paidOn ??= todayIso()
      if (path[0] === 'payments' && key === 'status' && value !== 'paid') delete target.paidOn
      if (key === 'startDate' || key === 'termsDays' || key === 'acceptedOn') j.payments = redatePayments(j)
      await saveJob(j)
      render()
    } else if (el.dataset.p) {
      const [pid, key] = el.dataset.p.split(':')
      const p = people.find((x) => x.id === pid)
      if (!p) return
      ;(p as any)[key] = el.value
      await putPerson(p)
      jobsChanged()
    }
  })

  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('button')
    if (!b) return
    const j = job()
    if (b.dataset.openJob) view = { kind: 'job', id: b.dataset.openJob }
    else if (b.hasAttribute('data-back')) view = { kind: 'list' }
    else if (b.hasAttribute('data-people')) view = { kind: 'people' }
    else if (b.dataset.openQuote) return opts.onOpenQuote(b.dataset.openQuote)
    else if (b.dataset.who && j) {
      const [i, pid] = b.dataset.who.split(':')
      const s = j.stages[Number(i)]
      s.who = s.who.includes(pid) ? s.who.filter((x) => x !== pid) : [...s.who, pid]
      await saveJob(j)
    } else if (b.hasAttribute('data-add-stage') && j) {
      const last = j.stages.at(-1)
      j.stages.push({ id: newId(), name: 'New stage', trade: 'own', startWeek: last ? last.startWeek : 1, weeks: 1, who: [] })
      await saveJob(j)
    } else if (b.dataset.removeStage && j) {
      j.stages.splice(Number(b.dataset.removeStage), 1)
      await saveJob(j)
    } else if (b.hasAttribute('data-complete') && j) {
      j.status = j.status === 'complete' ? 'booked' : 'complete'
      await saveJob(j)
    } else if (b.hasAttribute('data-delete-job') && j) {
      if (!confirm(`Delete job ${j.ref || ''}? The quote stays saved.`)) return
      await deleteJob(j.id)
      jobsChanged()
      view = { kind: 'list' }
    } else if (b.hasAttribute('data-add-person')) {
      const p: Person = { id: newId(), name: '', kind: 'team', trade: 'own' }
      await putPerson(p)
      people.push(p)
      render()
      root.querySelector<HTMLInputElement>(`[data-p="${p.id}:name"]`)?.focus()
      return
    } else if (b.dataset.removePerson) {
      const p = people.find((x) => x.id === b.dataset.removePerson)
      if (!p || !confirm(`Remove ${p.name || 'this person'}? They'll be taken off any stages.`)) return
      await deletePerson(p.id)
      for (const jj of jobs.filter((x) => x.stages.some((s) => s.who.includes(p.id)))) {
        for (const s of jj.stages) s.who = s.who.filter((x) => x !== p.id)
        await putJob(jj)
      }
      jobsChanged()
    } else return
    await refresh()
    if (b.dataset.openJob || b.hasAttribute('data-back') || b.hasAttribute('data-people')) window.scrollTo(0, 0)
  })

  onJobsChanged(() => {
    if (!root.hidden) void refresh()
  })

  return {
    refresh,
    /** Re-render without reloading (e.g. sync status changed). */
    rerender: () => {
      if (!root.hidden && view.kind === 'list') render()
    },
    show(jobId: string) {
      view = { kind: 'job', id: jobId }
      return refresh()
    },
    personName,
  }
}
