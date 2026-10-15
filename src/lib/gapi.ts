import { DriveError, type Fetch } from './drive'
import type { CalEvent, Row } from './job-google'

/**
 * Minimal Google Calendar v3 and Sheets v4 clients for the jobs calendar and
 * payments sheet. Calendar uses `calendar.app.created` (only calendars the app
 * created); Sheets works on spreadsheets the app created under `drive.file`.
 */

abstract class Api {
  constructor(
    protected token: string,
    protected f: Fetch = (...a) => fetch(...a),
  ) {}

  protected async call<T>(url: string, init: RequestInit = {}, okStatuses: number[] = []): Promise<T | null> {
    const res = await this.f(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    if (okStatuses.includes(res.status)) return null
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
    return res.status === 204 ? null : ((await res.json()) as T)
  }
}

const CAL = 'https://www.googleapis.com/calendar/v3'

export class Calendar extends Api {
  /** Reuse a remembered calendar if it still exists, otherwise create one. */
  async ensureCalendar(name: string, description: string, knownId?: string): Promise<string> {
    if (knownId) {
      const found = await this.call<{ id: string }>(`${CAL}/calendars/${encodeURIComponent(knownId)}`, {}, [404, 403, 410])
      if (found) return found.id
    }
    const created = await this.call<{ id: string }>(`${CAL}/calendars`, {
      method: 'POST',
      body: JSON.stringify({ summary: name, description, timeZone: 'Europe/London' }),
    })
    return created!.id
  }

  /** Create or update an all-day event with a fixed id (re-confirms it if it was deleted). */
  async upsertEvent(calendarId: string, e: CalEvent, opts: { transparent?: boolean } = {}): Promise<void> {
    const body = {
      id: e.id,
      summary: e.summary,
      location: e.location,
      description: e.description,
      start: { date: e.start },
      end: { date: e.end },
      colorId: e.colorId,
      status: 'confirmed',
      transparency: opts.transparent ? 'transparent' : 'opaque',
    }
    const base = `${CAL}/calendars/${encodeURIComponent(calendarId)}/events`
    const updated = await this.call(`${base}/${e.id}`, { method: 'PUT', body: JSON.stringify(body) }, [404])
    if (updated === null) await this.call(base, { method: 'POST', body: JSON.stringify(body) })
  }

  async deleteEvent(calendarId: string, id: string): Promise<void> {
    await this.call(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${id}`, { method: 'DELETE' }, [404, 410])
  }
}

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'

export class Sheets extends Api {
  /** Reuse the remembered spreadsheet if it still exists, otherwise create it with the given tabs. */
  async ensureSpreadsheet(title: string, tabs: { title: string; header: string[] }[], knownId?: string): Promise<{ id: string; created: boolean }> {
    if (knownId) {
      const found = await this.call<{ spreadsheetId: string }>(`${SHEETS}/${encodeURIComponent(knownId)}?fields=spreadsheetId`, {}, [404, 403])
      if (found) return { id: found.spreadsheetId, created: false }
    }
    const created = await this.call<{ spreadsheetId: string }>(SHEETS, {
      method: 'POST',
      body: JSON.stringify({
        properties: { title, locale: 'en_GB', timeZone: 'Europe/London' },
        sheets: tabs.map((t, i) => ({ properties: { sheetId: i, title: t.title, gridProperties: { frozenRowCount: 1 } } })),
      }),
    })
    const id = created!.spreadsheetId
    // Bold header row on every tab.
    await this.call(`${SHEETS}/${id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: tabs.map((_, i) => ({
          repeatCell: {
            range: { sheetId: i, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        })),
      }),
    })
    return { id, created: true }
  }

  /** Data rows of a tab (header excluded). */
  async readRows(id: string, tab: string): Promise<Row[]> {
    const r = await this.call<{ values?: Row[] }>(`${SHEETS}/${id}/values/${encodeURIComponent(`'${tab}'!A2:Z`)}`)
    return r?.values ?? []
  }

  /** Replace a tab's contents with header + rows. */
  async writeTab(id: string, tab: string, header: string[], rows: Row[]): Promise<void> {
    await this.call(`${SHEETS}/${id}/values/${encodeURIComponent(`'${tab}'!A:Z`)}:clear`, { method: 'POST', body: '{}' })
    await this.call(`${SHEETS}/${id}/values/${encodeURIComponent(`'${tab}'!A1`)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [header, ...rows] }),
    })
  }
}
