import { describe, it, expect } from 'vitest'
import { exportFile, mergeImport, parseImport, type SavedQuote } from './saved'

const q = (id: string, updatedAt: string): SavedQuote => ({
  id,
  ref: id,
  client: 'Client',
  address: 'Address',
  total: 1000,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt,
  data: { input: {} },
})

describe('import / export', () => {
  it('round-trips an export file', () => {
    const quotes = [q('a', '2026-10-02T00:00:00Z')]
    expect(parseImport(JSON.stringify(exportFile(quotes)))).toEqual(quotes)
  })

  it('rejects files that are not GRB exports', () => {
    expect(() => parseImport('not json')).toThrow(/not valid JSON/)
    expect(() => parseImport('{"quotes":[]}')).toThrow(/isn’t a GRB quotes export/)
  })

  it('drops malformed records', () => {
    const f = { ...exportFile([q('a', '2026-10-02T00:00:00Z')]), quotes: [q('a', '2026-10-02T00:00:00Z'), { id: 3 }, null] }
    expect(parseImport(JSON.stringify(f))).toHaveLength(1)
  })

  it('only overwrites a local quote when the imported one is newer', () => {
    const local = [q('a', '2026-10-05T00:00:00Z'), q('b', '2026-10-01T00:00:00Z')]
    const incoming = [q('a', '2026-10-03T00:00:00Z'), q('b', '2026-10-04T00:00:00Z'), q('c', '2026-10-01T00:00:00Z')]
    const { toWrite, skipped } = mergeImport(local, incoming)
    expect(toWrite.map((x) => x.id)).toEqual(['b', 'c'])
    expect(skipped).toBe(1)
  })
})
