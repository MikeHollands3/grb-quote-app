export type Spec = 'Budget' | 'Standard' | 'Premium'

export interface Rates {
  vat: number
  benchmarks: Record<string, Record<Spec, [number, number]>>
  regions: Record<string, number>
  roofs: Record<string, [number, number]>
}

export interface QuoteInput {
  job: string
  spec: Spec
  area: number
  region: string
  roof: string
}

export interface QuoteResult {
  exLow: number
  exHigh: number
  incLow: number
  incHigh: number
  midpoint: number
  perM2IncLow: number
  perM2IncHigh: number
}
