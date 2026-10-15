/**
 * Minimal Google Drive v3 client for saving quotes.
 *
 * Uses the `drive.file` scope: the app can only see and change files it created
 * itself (the "GRB Quotes" folder and the quotes in it), never the rest of the
 * user's Drive. `supportsAllDrives` keeps it working if the folder is moved into
 * a shared drive.
 */

export const FOLDER_NAME = 'GRB Quotes'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export type Fetch = typeof fetch

export class Drive {
  constructor(
    private token: string,
    private f: Fetch = (...a) => fetch(...a),
  ) {}

  private async call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.f(url, { ...init, headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) } })
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        if (body.error?.message) msg = body.error.message
      } catch {
        /* non-JSON error */
      }
      throw new DriveError(msg, res.status)
    }
    return (await res.json()) as T
  }

  /** The signed-in user's email (about.get works with drive.file). */
  async whoAmI(): Promise<string> {
    const r = await this.call<{ user?: { emailAddress?: string } }>(`${API}/about?fields=user(emailAddress)`)
    return r.user?.emailAddress ?? ''
  }

  /** Find the app's quotes folder (preferring a remembered id), or create it. */
  async ensureFolder(knownId?: string): Promise<string> {
    if (knownId) {
      try {
        const f = await this.call<{ id: string; trashed?: boolean }>(
          `${API}/files/${encodeURIComponent(knownId)}?fields=id,trashed&supportsAllDrives=true`,
        )
        if (!f.trashed) return f.id
      } catch (err) {
        if (!(err instanceof DriveError && err.status === 404)) throw err
      }
    }
    const q = `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`
    const list = await this.call<{ files: { id: string }[] }>(
      `${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    )
    if (list.files[0]) return list.files[0].id
    const created = await this.call<{ id: string }>(`${API}/files?fields=id&supportsAllDrives=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    })
    return created.id
  }

  /**
   * Create or replace a file. With an existing id the content and name are
   * updated in place (same file, so shared links keep working); if that file
   * has since been deleted from Drive, a new one is created.
   */
  async upsert(opts: { id?: string; name: string; mimeType: string; parent: string; body: Blob }): Promise<string> {
    if (opts.id) {
      try {
        return await this.multipart('PATCH', `${UPLOAD}/files/${encodeURIComponent(opts.id)}`, { name: opts.name }, opts)
      } catch (err) {
        if (!(err instanceof DriveError && err.status === 404)) throw err
      }
    }
    return this.multipart('POST', `${UPLOAD}/files`, { name: opts.name, parents: [opts.parent] }, opts)
  }

  private async multipart(method: string, url: string, meta: object, opts: { mimeType: string; body: Blob }) {
    const boundary = `grb${Math.random().toString(36).slice(2)}`
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`,
      opts.body,
      `\r\n--${boundary}--`,
    ])
    const r = await this.call<{ id: string }>(`${url}?uploadType=multipart&fields=id&supportsAllDrives=true`, {
      method,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
    return r.id
  }
}
