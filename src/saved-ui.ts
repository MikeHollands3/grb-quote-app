import { deleteQuote, exportFile, listQuotes, mergeImport, newId, parseImport, putQuote, type SavedQuote } from './lib/saved'
import { downloadBlob } from './quote-files'

const gbp2 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 })
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export interface SavedOptions {
  onOpen: (q: SavedQuote) => void
  onDeleted: (id: string) => void
  currentId: () => string | undefined
  /** Optional extra status line per quote (e.g. Drive sync state). */
  badge?: (q: SavedQuote) => string
  /** Optional header markup (e.g. Drive connect button). */
  header?: () => string
}

export function mountSaved(root: HTMLElement, opts: SavedOptions) {
  let quotes: SavedQuote[] = []
  let filter = ''
  let message = ''

  const row = (q: SavedQuote) => {
    const badge = opts.badge?.(q)
    return `
    <li class="saved${q.id === opts.currentId() ? ' current' : ''}">
      <button type="button" class="saved-main" data-open="${q.id}">
        <span class="saved-ref">${esc(q.ref || 'No ref')}</span>
        <span class="saved-addr">${esc(q.address || q.client || 'No address')}</span>
        <span class="saved-meta">${esc(q.client)}${q.client ? ' · ' : ''}Updated ${when(q.updatedAt)}${badge ? ` · ${badge}` : ''}</span>
      </button>
      <span class="saved-total">${gbp2.format(q.total)}</span>
      <span class="saved-actions">
        <button type="button" class="ghost small" data-copy="${q.id}">Duplicate</button>
        <button type="button" class="ghost small danger" data-delete="${q.id}">Delete</button>
      </span>
    </li>`
  }

  const render = () => {
    const f = filter.trim().toLowerCase()
    const shown = f ? quotes.filter((q) => `${q.ref} ${q.client} ${q.address}`.toLowerCase().includes(f)) : quotes
    root.innerHTML = `
      <h1>Saved quotes</h1>
      <p class="lede">Quotes are saved on this device and work offline. Export them to back up or move to another phone.</p>
      ${opts.header?.() ?? ''}
      <div class="card">
        <input type="search" placeholder="Search ref, client or address" value="${esc(filter)}" data-filter aria-label="Search saved quotes">
        ${
          shown.length
            ? `<ul class="saved-list">${shown.map(row).join('')}</ul>`
            : `<p class="hint">${quotes.length ? 'No quotes match.' : 'No saved quotes yet. Use “Save quote” on the Detailed tab — creating a PDF saves it too.'}</p>`
        }
      </div>
      <div class="actions">
        <button type="button" class="ghost" data-export ${quotes.length ? '' : 'disabled'}>Export all</button>
        <label class="ghost file-btn">Import<input type="file" accept="application/json,.json" data-import hidden></label>
      </div>
      <p class="hint" role="status">${esc(message)}</p>`
    const input = root.querySelector<HTMLInputElement>('[data-filter]')!
    if (f) {
      input.focus()
      input.setSelectionRange(filter.length, filter.length)
    }
  }

  const refresh = async () => {
    try {
      quotes = await listQuotes()
    } catch (err) {
      message = `Couldn't read saved quotes: ${(err as Error).message}`
    }
    render()
  }

  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement
    if (el.matches('[data-filter]')) {
      filter = el.value
      render()
    }
  })

  root.addEventListener('change', async (e) => {
    const el = e.target as HTMLInputElement
    if (!el.matches('[data-import]') || !el.files?.[0]) return
    try {
      const incoming = parseImport(await el.files[0].text())
      const { toWrite, skipped } = mergeImport(quotes, incoming)
      for (const q of toWrite) await putQuote({ ...q, drive: q.drive && { ...q.drive, status: 'pending' } })
      message = `Imported ${toWrite.length} quote${toWrite.length === 1 ? '' : 's'}${skipped ? ` (${skipped} already up to date)` : ''}.`
    } catch (err) {
      message = (err as Error).message
    }
    await refresh()
  })

  root.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('button')
    if (!btn) return
    const find = (id?: string) => quotes.find((q) => q.id === id)
    if (btn.dataset.open) {
      const q = find(btn.dataset.open)
      if (q) opts.onOpen(q)
    } else if (btn.dataset.copy) {
      const q = find(btn.dataset.copy)
      if (!q) return
      const now = new Date().toISOString()
      const id = newId()
      const ref = q.ref ? `${q.ref} (copy)` : ''
      const data = { ...structuredClone(q.data as { quote: { ref: string } }), id }
      data.quote.ref = ref
      await putQuote({ ...q, id, ref, createdAt: now, updatedAt: now, data, drive: { status: 'pending' } })
      message = `Duplicated ${q.ref || 'quote'}.`
      await refresh()
    } else if (btn.dataset.delete) {
      const q = find(btn.dataset.delete)
      if (!q || !confirm(`Delete ${q.ref || 'this quote'} from this device?`)) return
      await deleteQuote(q.id)
      opts.onDeleted(q.id)
      message = `Deleted ${q.ref || 'quote'} from this device.`
      await refresh()
    } else if (btn.matches('[data-export]')) {
      const stamp = new Date().toISOString().slice(0, 10)
      downloadBlob(new Blob([JSON.stringify(exportFile(quotes), null, 2)], { type: 'application/json' }), `GRB quotes ${stamp}.json`)
      message = `Exported ${quotes.length} quote${quotes.length === 1 ? '' : 's'}.`
      render()
    }
  })

  return { refresh, setMessage: (m: string) => ((message = m), render()) }
}
