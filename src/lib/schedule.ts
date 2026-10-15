export interface Payment {
  label: string
  amount: number
}

const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * Deposit then equal weekly payments (all inc VAT), as on the workbook's Client
 * Quote tab. Unlike the workbook, any rounding residue goes on the final week so
 * the schedule always sums exactly to the total.
 */
export function paymentSchedule(total: number, depositPct: number, weeks: number): Payment[] {
  const w = Math.max(0, Math.floor(weeks))
  const deposit = round2(total * depositPct)
  if (w === 0) return [{ label: 'Deposit on agreement of contract', amount: deposit }, { label: 'Balance on completion', amount: round2(total - deposit) }]
  const weekly = round2((total - deposit) / w)
  const rows: Payment[] = [{ label: 'Deposit on agreement of contract', amount: deposit }]
  for (let i = 1; i <= w; i++) rows.push({ label: `Week ${i}`, amount: weekly })
  rows[w].amount = round2(total - deposit - weekly * (w - 1))
  return rows
}
