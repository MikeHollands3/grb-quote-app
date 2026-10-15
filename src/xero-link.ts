import type { DriveSync } from './drive-sync'
import type { Job, JobPayment } from './lib/jobs'
import { jobsChanged, listJobs, putJob } from './lib/jobs-store'

/**
 * App side of the Xero link. Talks to /api/xero/* (Cloudflare Pages Functions),
 * authenticating with the signed-in GRB Google account. The Xero keys never
 * reach the browser.
 */

const SETTINGS = 'grb.xero.settings'

export interface XeroSettings {
  accountCode: string
  /** DRAFT: review and send from Xero. AUTHORISED: approved and emailed to the client by Xero. */
  mode: 'DRAFT' | 'AUTHORISED'
}

export type XeroState =
  | { kind: 'no-google' }
  | { kind: 'needs-google-signin' }
  | { kind: 'unknown'; busy: boolean; error?: string }
  | { kind: 'disconnected'; busy: boolean; error?: string }
  | { kind: 'connected'; busy: boolean; tenantName: string; connectedBy: string; error?: string; message?: string }

interface Status {
  connected: boolean
  tenantName?: string
  connectedBy?: string
}

const readSettings = (): XeroSettings => {
  try {
    return { accountCode: '200', mode: 'DRAFT', ...(JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') as Partial<XeroSettings>) }
  } catch {
    return { accountCode: '200', mode: 'DRAFT' }
  }
}

export function createXeroLink(drive: DriveSync) {
  let status: Status | null = null
  let busy = false
  let error: string | undefined
  let message: string | undefined
  let settings = readSettings()
  let lastPaymentCheck = 0
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  async function api<T>(path: string, body?: unknown): Promise<T> {
    const a = drive.access()
    if (!a) throw new Error('Google sign-in has expired — tap the button again to sign in.')
    const res = await fetch(`/api/xero/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({ error: `Server error ${res.status}` }))) as T & { error?: string }
    if (!res.ok) {
      if (res.status === 409) status = { connected: false }
      throw new Error(json.error ?? `Server error ${res.status}`)
    }
    return json
  }

  /** Run an action with Google access, signing in first if needed (call from a click). */
  function withGoogle(fn: () => Promise<void>) {
    const run = () => {
      busy = true
      error = undefined
      emit()
      void fn()
        .catch((err) => (error = (err as Error).message))
        .finally(() => {
          busy = false
          emit()
        })
    }
    if (drive.access()) run()
    else drive.authorize(run)
  }

  async function refreshStatus() {
    status = await api<Status>('status')
  }

  /** Create Xero invoices for these payments and mark them invoiced. */
  async function createFor(items: { job: Job; payment: JobPayment }[]) {
    const todo = items.filter((i) => i.payment.status === 'scheduled' && !i.payment.xero)
    if (!todo.length) return
    const res = await api<{ results: { key: string; ok: boolean; invoiceId?: string; number?: string; emailed?: boolean; error?: string }[] }>(
      'invoices',
      {
        accountCode: settings.accountCode,
        status: settings.mode,
        email: settings.mode === 'AUTHORISED',
        items: todo.map(({ job, payment: p }) => ({
          key: p.id,
          contactName: job.client || job.address,
          contactEmail: job.clientEmail || undefined,
          date: p.invoiceDate,
          dueDate: p.due,
          reference: `${job.ref} – ${p.label}`.trim(),
          description: `${job.jobType} at ${job.address}: ${p.label} (quote ${job.ref})`,
          amount: p.amount,
        })),
      },
    )
    const byKey = new Map(res.results.map((r) => [r.key, r]))
    const touched = new Set<Job>()
    for (const { job, payment } of todo) {
      const r = byKey.get(payment.id)
      if (!r?.ok || !r.invoiceId) continue
      const p = job.payments.find((x) => x.id === payment.id)!
      p.status = 'invoiced'
      p.xero = { invoiceId: r.invoiceId, number: r.number }
      touched.add(job)
    }
    for (const j of touched) await putJob(j)
    if (touched.size) jobsChanged()
    const failed = res.results.filter((r) => !r.ok)
    const okCount = res.results.length - failed.length
    const noEmail = settings.mode === 'AUTHORISED' ? res.results.filter((r) => r.ok && !r.emailed).length : 0
    message =
      `${okCount} invoice${okCount === 1 ? '' : 's'} created in Xero${settings.mode === 'DRAFT' ? ' as drafts' : ''}.` +
      (noEmail ? ` ${noEmail} not emailed (no client email) — send from Xero.` : '')
    if (failed.length) error = `${failed.length} failed: ${failed[0].error}`
  }

  /** Mark invoices paid in the app once Xero shows them paid. */
  async function checkPayments() {
    const jobs = await listJobs()
    const open = jobs.flatMap((job) => job.payments.filter((p) => p.status === 'invoiced' && p.xero).map((p) => ({ job, p })))
    if (!open.length) {
      message = 'No Xero invoices awaiting payment.'
      return
    }
    const { invoices } = await api<{ invoices: { id: string; number?: string; status: string; paidOn?: string }[] }>('invoice-status', {
      ids: open.map((o) => o.p.xero!.invoiceId),
    })
    const byId = new Map(invoices.map((i) => [i.id, i]))
    const touched = new Set<Job>()
    let paid = 0
    for (const { job, p } of open) {
      const inv = byId.get(p.xero!.invoiceId)
      if (!inv) continue
      if (inv.number && inv.number !== p.xero!.number) p.xero = { ...p.xero!, number: inv.number }
      if (inv.status === 'PAID') {
        p.status = 'paid'
        p.paidOn = inv.paidOn ?? new Date().toISOString().slice(0, 10)
        paid++
      } else if (inv.status === 'VOIDED' || inv.status === 'DELETED') {
        // Cancelled in Xero: back to scheduled so it can be raised again.
        p.status = 'scheduled'
        delete p.xero
      } else continue
      touched.add(job)
    }
    for (const j of touched) await putJob(j)
    if (touched.size) jobsChanged()
    lastPaymentCheck = Date.now()
    message = paid ? `${paid} payment${paid === 1 ? '' : 's'} received — marked paid.` : 'Checked Xero — no new payments.'
  }

  return {
    state(): XeroState {
      if (!drive.connected()) return { kind: 'no-google' }
      if (!drive.access()) return { kind: 'needs-google-signin' }
      if (!status) return { kind: 'unknown', busy, error }
      if (!status.connected) return { kind: 'disconnected', busy, error }
      return { kind: 'connected', busy, tenantName: status.tenantName ?? 'Xero', connectedBy: status.connectedBy ?? '', error, message }
    },
    settings: () => settings,
    saveSettings(s: Partial<XeroSettings>) {
      settings = { ...settings, ...s, accountCode: (s.accountCode ?? settings.accountCode).trim() || '200' }
      try {
        localStorage.setItem(SETTINGS, JSON.stringify(settings))
      } catch {
        /* storage unavailable */
      }
      emit()
    },
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    /** Quietly load connection status (and check payments at most every 10 minutes) when the Money tab opens. */
    async onShow() {
      if (!drive.access() || busy) return
      try {
        if (!status) await refreshStatus()
        if (status?.connected && Date.now() - lastPaymentCheck > 10 * 60_000) {
          busy = true
          emit()
          await checkPayments()
        }
      } catch (err) {
        error = (err as Error).message
      } finally {
        busy = false
        emit()
      }
    },
    signIn: () => withGoogle(refreshStatus),
    connect: () =>
      withGoogle(async () => {
        const { url } = await api<{ url: string }>('start', {})
        location.href = url
      }),
    create: (items: { job: Job; payment: JobPayment }[]) =>
      withGoogle(async () => {
        message = undefined
        if (!status) await refreshStatus()
        await createFor(items)
      }),
    checkPayments: () =>
      withGoogle(async () => {
        message = undefined
        await checkPayments()
      }),
    disconnect: () =>
      withGoogle(async () => {
        await api('disconnect', {})
        status = { connected: false }
        message = undefined
      }),
    /** After returning from Xero's consent page. */
    handleReturn(result: 'connected' | 'error', msg?: string) {
      status = null
      if (result === 'error') error = msg || 'Xero connection failed.'
      else message = 'Xero connected.'
      emit()
    },
  }
}

export type XeroLink = ReturnType<typeof createXeroLink>
