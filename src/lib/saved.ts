/**
 * Saved quotes, per device, in IndexedDB. Each record holds the whole estimate
 * (region + inputs + client quote) so it can be reopened and edited.
 */

export interface DriveInfo {
  /** pending = needs uploading; synced = Drive matches this version. */
  status: 'pending' | 'synced' | 'error'
  pdfId?: string
  jsonId?: string
  syncedAt?: string
  error?: string
}

export interface SavedQuote {
  id: string
  ref: string
  client: string
  address: string
  total: number
  createdAt: string
  updatedAt: string
  /** The estimate screen's state; opaque to this module. */
  data: unknown
  drive?: DriveInfo
}

export interface ExportFile {
  app: 'grb-quote-app'
  version: 1
  exportedAt: string
  quotes: SavedQuote[]
}

const DB = 'grb-quotes'
const STORE = 'quotes'

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

let dbPromise: Promise<IDBDatabase> | undefined
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' })
      store.createIndex('updatedAt', 'updatedAt')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = undefined
      reject(req.error)
    }
  })
  return dbPromise
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(req.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export async function listQuotes(): Promise<SavedQuote[]> {
  const all = await tx('readonly', (s) => s.getAll() as IDBRequest<SavedQuote[]>)
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export const getQuote = (id: string) => tx('readonly', (s) => s.get(id) as IDBRequest<SavedQuote | undefined>)
export const putQuote = (q: SavedQuote) => tx('readwrite', (s) => s.put(q)).then(() => q)
export const deleteQuote = (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => undefined)

export function exportFile(quotes: SavedQuote[]): ExportFile {
  return { app: 'grb-quote-app', version: 1, exportedAt: new Date().toISOString(), quotes }
}

/** Validate an export file. Throws with a readable message if it isn't one. */
export function parseImport(text: string): SavedQuote[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('That file isn’t a GRB quotes export (not valid JSON).')
  }
  const f = json as Partial<ExportFile>
  if (f?.app !== 'grb-quote-app' || !Array.isArray(f.quotes)) throw new Error('That file isn’t a GRB quotes export.')
  return f.quotes.filter(
    (q): q is SavedQuote =>
      !!q && typeof q.id === 'string' && typeof q.updatedAt === 'string' && typeof q.data === 'object' && q.data !== null,
  )
}

/** Imported quotes only replace a local copy when they are newer. */
export function mergeImport(local: SavedQuote[], incoming: SavedQuote[]) {
  const byId = new Map(local.map((q) => [q.id, q]))
  const toWrite = incoming.filter((q) => {
    const mine = byId.get(q.id)
    return !mine || q.updatedAt > mine.updatedAt
  })
  return { toWrite, skipped: incoming.length - toWrite.length }
}
