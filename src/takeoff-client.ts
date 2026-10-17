import type { DriveSync } from './drive-sync'
import type { Takeoff } from './lib/takeoff'

/**
 * Sends drawings to /api/takeoff with the GRB Google sign-in and returns the
 * takeoff. Call from a click: it may need to open Google sign-in first.
 */

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 20 * 1024 * 1024

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(new Error(`Couldn't read ${file.name}.`))
    r.readAsDataURL(file)
  })
}

export function checkDrawings(files: File[]): string | null {
  if (!files.length) return 'Choose the drawings first (PDF or photos).'
  const bad = files.find((f) => !ACCEPTED.includes(f.type))
  if (bad) return `${bad.name} isn't a PDF or photo.`
  if (files.reduce((a, f) => a + f.size, 0) > MAX_BYTES) return 'The drawings are too large together (20 MB limit). Choose fewer sheets.'
  return null
}

export function createTakeoffClient(drive: DriveSync) {
  async function post(token: string, files: File[], notes: string): Promise<Takeoff> {
    const payload = { notes, files: await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, data: await base64(f) }))) }
    const res = await fetch('/api/takeoff', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    // The body is padded with spaces while the server waits on Claude.
    const text = await res.text()
    let json: { takeoff?: Takeoff; error?: string }
    try {
      json = JSON.parse(text.trim() || '{}')
    } catch {
      throw new Error(`The server didn't answer properly (${res.status}). Try again.`)
    }
    if (!res.ok || !json.takeoff) throw new Error(json.error ?? `Server error ${res.status}`)
    return json.takeoff
  }

  return {
    /** Resolves with the takeoff; rejects with a message to show. */
    read(files: File[], notes: string): Promise<Takeoff> {
      const problem = checkDrawings(files)
      if (problem) return Promise.reject(new Error(problem))
      if (!navigator.onLine) return Promise.reject(new Error('Reading drawings needs signal. Try again when you’re online.'))
      if (!drive.connected()) return Promise.reject(new Error('Connect Google Drive on the Quotes tab first — reading drawings uses your GRB Google sign-in.'))
      const a = drive.access()
      if (a) return post(a.token, files, notes)
      return new Promise((resolve, reject) => {
        drive.authorize(() => {
          const b = drive.access()
          if (!b) reject(new Error('Google sign-in didn’t finish. Tap Read drawings again.'))
          else post(b.token, files, notes).then(resolve, reject)
        })
      })
    },
  }
}
export type TakeoffClient = ReturnType<typeof createTakeoffClient>
