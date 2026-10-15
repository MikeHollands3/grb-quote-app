import type { DriveSync } from './drive-sync'
import { Drive } from './lib/drive'
import { Calendar, Sheets } from './lib/gapi'
import {
  mergeRows,
  PAYMENT_HEADER,
  paymentEvents,
  paymentRows,
  PROGRAMME_HEADER,
  programmeRows,
  stageEvents,
  type CalEvent,
} from './lib/job-google'
import { deletedJobIds, listJobs, listPeople, onJobsChanged, saveDeleted } from './lib/jobs-store'

/**
 * Keeps two Google Calendars ("GRB Jobs": one event per stage; "GRB Payments":
 * unpaid payments on their due dates) and the "GRB Jobs & Payments" sheet in
 * step with the jobs on this device. Only changed jobs are re-sent. The ids of
 * the calendars and sheet are stored in the GRB Quotes Drive folder so every
 * device signed in as the same person reuses them.
 */

const LOCAL = 'grb.google.jobs'
const SHARED_FILE = 'GRB app settings.json'

interface Ids {
  calJobs?: string
  calPayments?: string
  sheetId?: string
}
interface LocalState extends Ids {
  /** Per job: hash of what was last sent, and the event ids sent ("j:" jobs calendar, "p:" payments calendar). */
  jobs: Record<string, { hash: string; events: string[] }>
  lastSync?: string
}

export type JobsSyncState =
  | { kind: 'off' } // Google not connected on this device
  | { kind: 'needs-auth'; reason: 'expired' | 'calendar' }
  | { kind: 'ready'; syncing: boolean; error?: string; lastSync?: string; calJobs?: string; calPayments?: string; sheetId?: string }

const load = (): LocalState => {
  try {
    return { jobs: {}, ...(JSON.parse(localStorage.getItem(LOCAL) ?? '{}') as Partial<LocalState>) }
  } catch {
    return { jobs: {} }
  }
}
const store = (s: LocalState) => {
  try {
    localStorage.setItem(LOCAL, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

function hash(s: string) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function createJobsSync(drive: DriveSync) {
  let state = load()
  let running: Promise<void> | null = null
  let again = false
  let error: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  async function ensureIds(d: Drive, cal: Calendar, sheets: Sheets, folderHint?: string) {
    const folderId = await d.ensureFolder(folderHint)
    let settingsId: string | undefined
    // Pick up ids another device of the same person already created.
    if (!state.calJobs || !state.calPayments || !state.sheetId) {
      settingsId = await d.findFile(SHARED_FILE, folderId)
      if (settingsId) {
        const shared = await d.readJson<Ids>(settingsId).catch(() => ({}) as Ids)
        state = { ...state, calJobs: state.calJobs ?? shared.calJobs, calPayments: state.calPayments ?? shared.calPayments, sheetId: state.sheetId ?? shared.sheetId }
      }
    }
    const before = JSON.stringify([state.calJobs, state.calPayments, state.sheetId])
    const calJobs = await cal.ensureCalendar('GRB Jobs', 'GRB job programme — who, what, where. Managed by GRB Quick Quote.', state.calJobs)
    const calPayments = await cal.ensureCalendar('GRB Payments', 'Payments due from clients. Managed by GRB Quick Quote.', state.calPayments)
    const sheet = await sheets.ensureSpreadsheet(
      'GRB Jobs & Payments',
      [
        { title: 'Payments', header: PAYMENT_HEADER },
        { title: 'Programme', header: PROGRAMME_HEADER },
      ],
      state.sheetId,
    )
    if (sheet.created) await d.moveTo(sheet.id, folderId)
    if (calJobs !== state.calJobs || calPayments !== state.calPayments) state.jobs = {} // new calendars: resend everything
    state = { ...state, calJobs, calPayments, sheetId: sheet.id }
    if (JSON.stringify([calJobs, calPayments, sheet.id]) !== before) {
      const body = new Blob([JSON.stringify({ calJobs, calPayments, sheetId: sheet.id } satisfies Ids, null, 2)], { type: 'application/json' })
      await d.upsert({ id: settingsId ?? (await d.findFile(SHARED_FILE, folderId)), name: SHARED_FILE, mimeType: 'application/json', parent: folderId, body })
    }
    store(state)
  }

  async function run() {
    const a = drive.access()
    if (!a || !a.hasCalendar || !navigator.onLine) return
    const d = new Drive(a.token)
    const cal = new Calendar(a.token)
    const sheets = new Sheets(a.token)
    try {
      await ensureIds(d, cal, sheets, a.folderId)
      const [jobs, people] = await Promise.all([listJobs(), listPeople()])
      const deleted = deletedJobIds()

      // Calendar: only jobs whose events changed since the last sync.
      for (const job of jobs) {
        const stage = stageEvents(job, people)
        const pay = paymentEvents(job)
        const h = hash(JSON.stringify([stage, pay]))
        const prev = state.jobs[job.id]
        if (prev?.hash === h) continue
        const sent: string[] = []
        const put = async (calId: string, prefix: 'j' | 'p', evs: CalEvent[], transparent: boolean) => {
          for (const e of evs) {
            await cal.upsertEvent(calId, e, { transparent })
            sent.push(`${prefix}:${e.id}`)
          }
        }
        await put(state.calJobs!, 'j', stage, false)
        await put(state.calPayments!, 'p', pay, true)
        for (const old of prev?.events ?? []) if (!sent.includes(old)) await removeEvent(cal, old)
        state.jobs[job.id] = { hash: h, events: sent }
        store(state)
      }
      // Jobs deleted on this device: remove their events.
      for (const id of deleted) {
        for (const old of state.jobs[id]?.events ?? []) await removeEvent(cal, old)
        delete state.jobs[id]
        store(state)
      }

      // Sheet: merge this device's jobs into what's there.
      const local = new Set(jobs.map((j) => j.id))
      const [payRows, progRows] = await Promise.all([sheets.readRows(state.sheetId!, 'Payments'), sheets.readRows(state.sheetId!, 'Programme')])
      await sheets.writeTab(state.sheetId!, 'Payments', PAYMENT_HEADER, mergeRows(payRows, paymentRows(jobs), local, deleted))
      await sheets.writeTab(state.sheetId!, 'Programme', PROGRAMME_HEADER, mergeRows(progRows, programmeRows(jobs, people), local, deleted))
      saveDeleted(new Set([...deletedJobIds()].filter((id) => !deleted.has(id))))

      state.lastSync = new Date().toISOString()
      store(state)
      error = undefined
    } catch (err) {
      error = (err as Error).message
    }
  }

  async function removeEvent(cal: Calendar, key: string) {
    const [prefix, id] = key.split(':')
    await cal.deleteEvent(prefix === 'j' ? state.calJobs! : state.calPayments!, id)
  }

  function syncNow(): Promise<void> {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      emit()
      do {
        again = false
        await run()
      } while (again)
    })().finally(() => {
      running = null
      emit()
    })
    return running
  }

  // Re-sync a couple of seconds after any job change, and when Google access arrives.
  onJobsChanged(() => {
    clearTimeout(timer)
    timer = setTimeout(() => void syncNow(), 2000)
  })
  drive.subscribe(() => {
    if (drive.access()?.hasCalendar && !running && !state.lastSync) void syncNow()
  })
  window.addEventListener('online', () => void syncNow())

  return {
    state(): JobsSyncState {
      if (!drive.connected()) return { kind: 'off' }
      const a = drive.access()
      if (!a) return { kind: 'needs-auth', reason: 'expired' }
      if (!a.hasCalendar) return { kind: 'needs-auth', reason: 'calendar' }
      return { kind: 'ready', syncing: !!running, error, lastSync: state.lastSync, calJobs: state.calJobs, calPayments: state.calPayments, sheetId: state.sheetId }
    },
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    syncNow,
    /** Click handler: sign in / grant calendar access if needed, then sync. */
    connectAndSync() {
      const a = drive.access()
      if (a?.hasCalendar) void syncNow()
      else drive.authorize(() => void syncNow())
    },
  }
}

export type JobsSync = ReturnType<typeof createJobsSync>
