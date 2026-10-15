import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { buildQuotePdf, type QuoteDoc, type Company } from './quote-pdf'
import quoteData from '../data/quote-example.json'
import companyData from '../data/company.json'

const logo = new Uint8Array(readFileSync(new URL('../assets/grb-logo.png', import.meta.url)))
const prices = { net: 78893.75, vat: 15778.75, total: 94672.5 }

describe('buildQuotePdf', () => {
  it('renders a two-page A4 quotation with the logo', async () => {
    const bytes = await buildQuotePdf(quoteData as QuoteDoc, prices, companyData as Company, logo)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getTitle()).toContain('CR30/1')
    if (process.env.QUOTE_PDF_OUT) writeFileSync(process.env.QUOTE_PDF_OUT, bytes)
  })

  it('flows a long scope onto extra pages and survives characters outside WinAnsi', async () => {
    const q = { ...(quoteData as QuoteDoc), scope: Array.from({ length: 60 }, (_, i) => `Item ${i + 1} ≈ 2m → done`).join('\n') }
    const doc = await PDFDocument.load(await buildQuotePdf(q, prices, companyData as Company))
    expect(doc.getPageCount()).toBeGreaterThan(2)
  })
})
