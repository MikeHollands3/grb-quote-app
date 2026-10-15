import { Drive } from './lib/drive'
import { getQuote, listQuotes, putQuote, type SavedQuote } from './lib/saved'
import { fileBase, quotePdf, type EstimateState } from './quote-files'

/**
 * Uploads saved quotes (PDF + reopenable JSON) to a "GRB Quotes" folder in the
 * signed-in user's Google Drive. Sign-in uses Google Identity Services in the
 * browser — no server. Only Google Workspace accounts on HOSTED_DOMAIN are
 * accepted (and the OAuth consent screen should be set to "Internal").
 */

// GRB Workspace OAuth client ("GRB Quick Quote web"). Not a secret — it only works from the
// authorised origins set in Google Cloud. VITE_GOOGLE_CLIENT_ID overrides it (e.g. for testing).
const GRB_CLIENT_ID = '551976286145-qh78tqhsrd7cr9oqv9h28u8k06m1q8ut.apps.googleusercontent.com'
export const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || GRB_CLIENT_ID
export const HOSTED_DOMAIN = 'grbhomeimprovements.co.uk'
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const SETTINGS = 'grb.drive'
const TOKEN = 'grb.drive.token'

interface Settings {
  email: string
  folderId?: string
}
interface Token {
  value: string
  expiresAt: number
}

/* Minimal typing for the bits of Google Identity Services we use. */
interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}
interface TokenClient {
  requestAccessToken(o?: { prompt?: string; login_hint?: string }): void
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(c: {
        client_id: string
        scope: string
        hd?: string
        callback: (r: TokenResponse) => void
        error_callback?: (e: { type: string; message?: string }) => void
      }): TokenClient
      revoke(token: string, done?: () => void): void
    }
  }
}
declare global {
  interface Window {
    google?: Gis
  }
}

const read = <T>(k: string, store: Storage): T | null => {
  try {
    return JSON.parse(store.getItem(k) ?? 'null') as T | null
  } catch {
    return null
  }
}
const write = (k: string, v: unknown, store: Storage) => {
  try {
    if (v === null) store.removeItem(k)
    else store.setItem(k, JSON.stringify(v))
  } catch {
    /* storage unavailable */
  }
}

export type DriveState =
  | { kind: 'unconfigured' }
  | { kind: 'disconnected'; error?: string }
  | {
      kind: 'connected'
      email: string
      folderId?: string
      pending: number
      syncing: boolean
      needsSignIn: boolean
      error?: string
      lastSync?: string
    }

export function createDriveSync() {
  let settings = read<Settings>(SETTINGS, localStorage)
  let token = read<Token>(TOKEN, sessionStorage)
  let client: TokenClient | null = null
  let gisLoading: Promise<void> | null = null
  let syncing: Promise<void> | null = null
  let pending = 0
  let error: string | undefined
  let lastSync: string | undefined
  let afterToken: (() => void) | null = null
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  const tokenValid = () => !!token && token.expiresAt - 60_000 > Date.now()

  function loadGis(): Promise<void> {
    if (window.google?.accounts?.oauth2) return Promise.resolve()
    gisLoading ??= new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        gisLoading = null
        reject(new Error('Couldn’t reach Google sign-in. Check your connection.'))
      }
      document.head.append(s)
    })
    return gisLoading
  }

  /** Prepare the sign-in client ahead of a tap, so the popup opens from the tap itself. */
  async function warmUp() {
    if (!CLIENT_ID || client || !navigator.onLine) return
    try {
      await loadGis()
      client = window.google!.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        hd: HOSTED_DOMAIN,
        callback: (r) => void onToken(r),
        error_callback: (e) => {
          error = e.type === 'popup_closed' ? 'Sign-in was cancelled.' : `Sign-in failed: ${e.message ?? e.type}`
          afterToken = null
          emit()
        },
      })
    } catch (err) {
      error = (err as Error).message
      emit()
    }
  }

  async function onToken(r: TokenResponse) {
    if (!r.access_token) {
      error = `Sign-in failed: ${r.error_description ?? r.error ?? 'no token'}`
      afterToken = null
      emit()
      return
    }
    token = { value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 }
    try {
      const email = await new Drive(token.value).whoAmI()
      if (!email.toLowerCase().endsWith(`@${HOSTED_DOMAIN}`)) {
        window.google?.accounts.oauth2.revoke(token.value)
        token = null
        settings = null
        write(SETTINGS, null, localStorage)
        error = `Please sign in with your @${HOSTED_DOMAIN} account (you used ${email || 'another account'}).`
        afterToken = null
        emit()
        return
      }
      settings = { ...settings, email }
      write(SETTINGS, settings, localStorage)
      write(TOKEN, token, sessionStorage)
      error = undefined
    } catch (err) {
      error = (err as Error).message
    }
    const next = afterToken
    afterToken = null
    emit()
    next?.()
  }

  /** Must be called synchronously inside a click handler (popup blockers). */
  function requestToken(then?: () => void) {
    if (!client) {
      error = navigator.onLine ? 'Google sign-in is still loading — try again in a moment.' : 'You’re offline. Quotes will upload when you’re back online.'
      void warmUp()
      emit()
      return
    }
    afterToken = then ?? null
    client.requestAccessToken({ prompt: settings ? '' : 'select_account', login_hint: settings?.email })
  }

  async function countPending() {
    try {
      pending = (await listQuotes()).filter((q) => q.drive?.status !== 'synced').length
    } catch {
      pending = 0
    }
  }

  async function uploadOne(d: Drive, folderId: string, q: SavedQuote) {
    const state = q.data as EstimateState
    const { bytes } = await quotePdf(state)
    const base = fileBase(state)
    const pdfId = await d.upsert({
      id: q.drive?.pdfId,
      name: `${base}.pdf`,
      mimeType: 'application/pdf',
      parent: folderId,
      body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
    })
    const json = { app: 'grb-quote-app', version: 1, exportedAt: new Date().toISOString(), quotes: [{ ...q, drive: undefined }] }
    const jsonId = await d.upsert({
      id: q.drive?.jsonId,
      name: `${base}.json`,
      mimeType: 'application/json',
      parent: folderId,
      body: new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
    })
    // Only mark synced if the quote wasn't re-saved while uploading.
    const latest = await getQuote(q.id)
    if (!latest) return
    const synced = latest.updatedAt === q.updatedAt
    await putQuote({
      ...latest,
      drive: { status: synced ? 'synced' : 'pending', pdfId, jsonId, syncedAt: new Date().toISOString() },
    })
  }

  /** Upload every quote that has changed since its last upload. */
  function syncNow(): Promise<void> {
    if (syncing) return syncing
    syncing = (async () => {
      if (!settings || !tokenValid() || !navigator.onLine) return
      emit()
      const d = new Drive(token!.value)
      try {
        const folderId = await d.ensureFolder(settings.folderId)
        if (folderId !== settings.folderId) {
          settings = { ...settings, folderId }
          write(SETTINGS, settings, localStorage)
        }
        const todo = (await listQuotes()).filter((q) => q.drive?.status !== 'synced')
        let failed = 0
        for (const q of todo) {
          try {
            await uploadOne(d, folderId, q)
          } catch (err) {
            failed++
            error = `Couldn’t upload ${q.ref || 'a quote'}: ${(err as Error).message}`
            await putQuote({ ...q, drive: { ...q.drive, status: 'error', error: (err as Error).message } })
          }
        }
        if (!failed) error = undefined
        lastSync = new Date().toISOString()
      } catch (err) {
        error = (err as Error).message
      }
    })().finally(async () => {
      syncing = null
      await countPending()
      emit()
    })
    return syncing
  }

  // Retry automatically when the connection comes back (if still signed in).
  window.addEventListener('online', () => {
    void warmUp()
    if (tokenValid()) void syncNow()
  })
  void warmUp()
  void countPending().then(emit)

  return {
    state(): DriveState {
      if (!CLIENT_ID) return { kind: 'unconfigured' }
      if (!settings) return { kind: 'disconnected', error }
      return { kind: 'connected', email: settings.email, folderId: settings.folderId, pending, syncing: !!syncing, needsSignIn: !tokenValid(), error, lastSync }
    },
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    /** Click handler: connect, or sign in again and sync. */
    connectOrSync() {
      if (tokenValid()) void syncNow()
      else requestToken(() => void syncNow())
    },
    /**
     * Call synchronously at the start of a Save click: if Drive is connected but
     * the hour-long Google token has expired, re-authorise now (inside the tap).
     */
    beforeSave() {
      if (settings && !tokenValid() && navigator.onLine) requestToken(() => void syncNow())
    },
    /** After a quote is saved locally. */
    afterSave() {
      void countPending().then(() => {
        emit()
        if (tokenValid()) void syncNow()
      })
    },
    disconnect() {
      if (token) window.google?.accounts.oauth2.revoke(token.value)
      token = null
      settings = null
      error = undefined
      write(SETTINGS, null, localStorage)
      write(TOKEN, null, sessionStorage)
      emit()
    },
    warmUp,
  }
}

export type DriveSync = ReturnType<typeof createDriveSync>
