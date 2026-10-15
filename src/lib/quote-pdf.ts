import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib'
import { paymentSchedule } from './schedule'

/**
 * Branded client quotation, matching GRB's existing ReportLab layout (e.g.
 * quote SJA12/1): logo + teal header, TO / quote details, letter, scope of
 * works, price table, notes; then payment schedule, bank details and acceptance.
 */

export interface Company {
  name: string
  address: string
  email: string
  phone: string
  companyNo: string
  vatNo: string
  signatory: string
  bank: { accountName: string; bank: string; sortCode: string; accountNo: string }
}

export interface QuoteDoc {
  ref: string
  /** ISO date, yyyy-mm-dd */
  date: string
  durationWeeks: number
  drawings: string
  clientName: string
  /** Not printed; carried to the job so Xero can email invoices. */
  clientEmail?: string
  clientAddress: string
  salutation: string
  letter: string
  scope: string
  notes: string
  depositPct: number
}

export interface QuotePrices {
  net: number
  vat: number
  total: number
}

const A4: [number, number] = [595.28, 841.89]
const M = 48 // side margin
const TEAL = rgb(0, 112 / 255, 96 / 255)
const TEAL_SOFT = rgb(226 / 255, 239 / 255, 236 / 255)
const RULE = rgb(0.62, 0.8, 0.76)
const INK = rgb(0.08, 0.1, 0.1)
const GREY = rgb(0.42, 0.45, 0.45)
const WHITE = rgb(1, 1, 1)

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 })

export function formatDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter(Boolean)

/** Standard PDF fonts only cover WinAnsi; swap anything else for a safe equivalent. */
function safe(font: PDFFont, s: string) {
  const map: Record<string, string> = { '≈': '~', '→': '->', '≥': '>=', '≤': '<=', '\t': ' ' }
  let out = ''
  for (const ch of s) {
    const c = map[ch] ?? ch
    try {
      font.encodeText(c)
      out += c
    } catch {
      out += '?'
    }
  }
  return out
}

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next
      else {
        out.push(line)
        line = word
      }
    }
    out.push(line)
  }
  return out
}

export async function buildQuotePdf(q: QuoteDoc, prices: QuotePrices, co: Company, logoPng?: Uint8Array) {
  const doc = await PDFDocument.create()
  doc.setTitle(`GRB Quotation ${q.ref} - ${q.clientAddress.split('\n')[0] ?? ''}`.trim())
  doc.setAuthor(co.name)
  doc.setCreator('GRB Quick Quote')
  const reg = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo: PDFImage | undefined = logoPng ? await doc.embedPng(logoPng) : undefined

  const W = A4[0] - 2 * M
  let page!: PDFPage
  let y = 0
  const pages: PDFPage[] = []

  const text = (s: string, x: number, yy: number, size: number, font = reg, color = INK) =>
    page.drawText(safe(font, s), { x, y: yy, size, font, color })
  const right = (s: string, xr: number, yy: number, size: number, font = reg, color = INK) => {
    const t = safe(font, s)
    page.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y: yy, size, font, color })
  }

  const newPage = () => {
    page = doc.addPage(A4)
    pages.push(page)
    const top = A4[1] - 40
    if (logo) {
      const h = 60
      page.drawImage(logo, { x: M + 6, y: top - h, width: (h * logo.width) / logo.height, height: h })
    }
    right('QUOTATION', A4[0] - M, top - 18, 22, bold, TEAL)
    right(`${co.name}  ·  ${co.address}`, A4[0] - M, top - 32, 7.5, reg, GREY)
    right(`${co.email}  ·  ${co.phone}`, A4[0] - M, top - 42, 7.5, reg, GREY)
    right(`Company No. ${co.companyNo}  ·  VAT No. ${co.vatNo}`, A4[0] - M, top - 52, 7.5, reg, GREY)
    page.drawLine({ start: { x: M, y: top - 60 }, end: { x: A4[0] - M, y: top - 60 }, thickness: 0.8, color: RULE })
    y = top - 88
  }
  const ensure = (h: number) => {
    if (y - h < 60) newPage()
  }
  const heading = (s: string) => {
    ensure(40)
    y -= 6
    text(s, M + 6, y, 10.5, bold, TEAL)
    y -= 16
  }
  const para = (s: string, size = 8.6, font = reg, color = INK, indent = 6) => {
    for (const l of wrap(font, size, safe(font, s), W - indent * 2)) {
      ensure(12)
      text(l, M + indent, y, size, font, color)
      y -= size + 3.6
    }
  }
  const bullets = (items: string[]) => {
    for (const item of items) {
      const ls = wrap(reg, 8.6, safe(reg, item), W - 26)
      ensure(ls.length * 12.2)
      ls.forEach((l, i) => {
        if (i === 0) text('•', M + 8, y, 8.6)
        text(l, M + 17, y, 8.6)
        y -= 12.2
      })
      y -= 1.2
    }
    y -= 4
  }

  // ---------------- page 1 ----------------
  newPage()
  text('TO', M + 6, y, 9, bold)
  const meta: [string, string][] = [
    ['Quote ref:', q.ref],
    ['Date:', formatDate(q.date)],
    ['Duration:', `${q.durationWeeks} weeks`],
  ]
  if (q.drawings.trim()) meta.push(['Drawings:', q.drawings])
  meta.forEach(([k, v], i) => {
    const yy = y - i * 13.5
    const vw = reg.widthOfTextAtSize(safe(reg, v), 9)
    right(v, A4[0] - M, yy, 9)
    right(k, A4[0] - M - vw - 3, yy, 9, bold)
  })
  const to = [q.clientName, ...q.clientAddress.split('\n')].map((s) => s.trim()).filter(Boolean)
  to.forEach((l, i) => text(l, M + 6, y - 13.5 * (i + 1), 9))
  y -= 13.5 * Math.max(to.length + 1, meta.length) + 16

  para(q.salutation || 'Dear Sir / Madam,')
  y -= 5
  for (const p of q.letter.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    para(p.replace(/\n/g, ' '))
    y -= 5
  }
  ensure(14)
  const ys = 'Yours sincerely, '
  text(ys, M + 6, y, 8.6)
  let x = M + 6 + reg.widthOfTextAtSize(ys, 8.6) + 2
  text(co.signatory, x, y, 8.6, bold)
  x += bold.widthOfTextAtSize(safe(bold, co.signatory), 8.6) + 2
  text(` - ${co.name}`, x, y, 8.6)
  y -= 22

  heading('SCOPE OF WORKS')
  bullets(lines(q.scope))

  heading('PRICE')
  ensure(70)
  const priceRows: [string, number, boolean][] = [
    ['Net price for the works (excluding VAT)', prices.net, false],
    [`VAT @ ${Math.round((prices.vat / (prices.net || 1)) * 100)}%`, prices.vat, false],
    ['TOTAL PRICE (including VAT)', prices.total, true],
  ]
  if (!prices.vat) priceRows.splice(1, 1)
  for (const [label, amount, total] of priceRows) {
    const h = 18
    if (total) page.drawRectangle({ x: M, y: y - 5.5, width: W, height: h, color: TEAL })
    else page.drawLine({ start: { x: M, y: y - 5.5 }, end: { x: A4[0] - M, y: y - 5.5 }, thickness: 0.6, color: RULE })
    text(label, M + 6, y, 9, total ? bold : reg, total ? WHITE : INK)
    right(money.format(amount), A4[0] - M - 6, y, 9, total ? bold : reg, total ? WHITE : INK)
    y -= h
  }
  y -= 10

  const notes = lines(q.notes)
  if (notes.length) {
    heading('NOTES & QUALIFICATIONS')
    bullets(notes)
  }

  // ---------------- page 2: payment schedule ----------------
  newPage()
  heading('PAYMENT SCHEDULE')
  const weeks = Math.max(0, Math.floor(q.durationWeeks))
  para(
    weeks
      ? `${Math.round(q.depositPct * 100)}% deposit to secure the start date, then equal weekly payments over the ${weeks}-week programme.`
      : `${Math.round(q.depositPct * 100)}% deposit to secure the start date, balance on completion.`,
    7.8,
    reg,
    GREY,
  )
  y -= 4
  const cols = { stage: M + 6, amount: M + 360, method: M + 372, due: M + 440 }
  const row = (cells: [string, string, string, string], opts: { head?: boolean; total?: boolean } = {}) => {
    ensure(20)
    const h = 19
    if (opts.head) page.drawRectangle({ x: M, y: y - 6, width: W, height: h, color: TEAL })
    else if (opts.total) page.drawRectangle({ x: M, y: y - 6, width: W, height: h, color: TEAL_SOFT })
    else page.drawLine({ start: { x: M, y: y - 6 }, end: { x: A4[0] - M, y: y - 6 }, thickness: 0.6, color: RULE })
    const f = opts.head || opts.total ? bold : reg
    const c = opts.head ? WHITE : INK
    text(cells[0], cols.stage, y, 8.6, f, c)
    right(cells[1], cols.amount, y, 8.6, f, c)
    text(cells[2], cols.method, y, 8.6, f, c)
    text(cells[3], cols.due, y, 8.6, f, c)
    y -= h
  }
  row(['Stage / week', 'Amount (inc VAT)', 'Method', 'Due'], { head: true })
  const sched = paymentSchedule(prices.total, q.depositPct, weeks)
  sched.forEach((p, i) => {
    const last = i === sched.length - 1 && weeks > 0
    row([last ? `${p.label} (final, on completion)` : p.label, money.format(p.amount), 'BACS', i === 0 ? 'Immediate' : ''])
  })
  row(['TOTAL', money.format(prices.total), '', ''], { total: true })
  y -= 18

  // Bank details | Acceptance
  ensure(110)
  const boxH = 96
  const half = W / 2
  page.drawRectangle({ x: M, y: y - boxH + 12, width: W, height: boxH, borderColor: TEAL, borderWidth: 0.8 })
  page.drawLine({ start: { x: M + half, y: y + 12 }, end: { x: M + half, y: y - boxH + 12 }, thickness: 0.8, color: TEAL })
  const by = y - 4
  text('BANK DETAILS (BACS)', M + 8, by, 8.8, bold)
  text(`Account name: ${co.bank.accountName}`, M + 8, by - 14, 8.4)
  text(`Bank: ${co.bank.bank}`, M + 8, by - 27, 8.4)
  text(`Sort code: ${co.bank.sortCode}  ·  Account no: ${co.bank.accountNo}`, M + 8, by - 40, 8.4)
  text(`Reference: ${q.ref}`, M + 8, by - 53, 8.4)
  const ax = M + half + 8
  text('ACCEPTANCE', ax, by, 8.8, bold)
  wrap(reg, 8.4, 'To proceed, please confirm acceptance by email and pay the deposit to secure the start date.', half - 16).forEach(
    (l, i) => text(l, ax, by - 14 - i * 12, 8.4),
  )
  const sy = by - 62
  text('Signed:', ax, sy, 8.4)
  page.drawLine({ start: { x: ax + 32, y: sy - 1.5 }, end: { x: ax + 150, y: sy - 1.5 }, thickness: 0.5, color: GREY })
  text('Date:', ax + 158, sy, 8.4)
  page.drawLine({ start: { x: ax + 182, y: sy - 1.5 }, end: { x: M + W - 8, y: sy - 1.5 }, thickness: 0.5, color: GREY })

  // footers
  pages.forEach((p, i) => {
    const f = safe(reg, `${co.name}  ·  Quotation ${q.ref}  ·  Page ${i + 1} of ${pages.length}`)
    p.drawText(f, { x: (A4[0] - reg.widthOfTextAtSize(f, 7)) / 2, y: 30, size: 7, font: reg, color: GREY })
  })

  return doc.save()
}
