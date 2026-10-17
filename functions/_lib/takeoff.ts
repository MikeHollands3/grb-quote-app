import Anthropic from '@anthropic-ai/sdk'
import libData from '../../src/data/rate-library.json'
import { catalogueText, takeoffSchema, type Takeoff } from '../../src/lib/takeoff'
import type { RateLibrary } from '../../src/lib/types'
import { HttpError } from './xero'

/**
 * Drawings → takeoff. Claude reads the uploaded drawings (PDF or photos) and
 * returns quantities against GRB's rate library, as structured output. The app
 * turns the result into a draft estimate (src/lib/takeoff.ts applyTakeoff).
 */

const lib = libData as unknown as RateLibrary

export const MODEL = 'claude-opus-5-5'
/** Raw bytes across all files; base64 grows this by a third and the API takes 32 MB per request. */
export const MAX_BYTES = 20 * 1024 * 1024

export interface DrawingFile {
  name: string
  type: string
  /** base64, no data: prefix */
  data: string
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type ImageType = (typeof IMAGE_TYPES)[number]

export const SYSTEM_PROMPT = `You are the estimator for GRB Builders (London) Ltd, a small builder in South London doing extensions, loft conversions and refurbishments. You are given an architect's drawing set and produce a quantity takeoff that GRB's pricing tool turns into a draft estimate. A GRB estimator will check every line before it goes to a client, so be accurate, show your measurements, and say plainly what you assumed.

How to read the drawings
- Price only the PROPOSED works. Existing drawings are for reference. If the set contains more than one proposal (for example a concept sheet and a later planning set that differ), price the most complete, most recent proposal and say which one you priced in the assumptions; list the other option as a question.
- Take dimensions from figured dimensions first; scale from the drawing only when no dimension is given, using the stated scale or scale bar, and say so in the measurement's source.
- Ignore any cost figures printed on the drawings (they are someone else's estimate). Do not let them steer your quantities.
- Record every quantity you derive in "measurements" (what, quantity, unit, and the drawing and dimensions it came from), so the estimator can follow your working.

How GRB prices
- Labour is in days per trade. Size it for a small, competent team: a GRB crew of a general builder plus labourer, with trades brought in as needed. Use the labour items only for work GRB does itself.
- Materials are in the units shown in brackets in the catalogue (bricks per 1,000, blocks per 100, timber per length, boards each, and so on). Allow normal waste (about 10%).
- Footings are dug and poured by GRB: give the trench length (m), width (m), concrete depth (m) and excavation depth (m). Typical London clay strip footing: 0.6 m wide, about 1.0 m deep. Loft conversions and internal works have no footings.
- Roof: the roof package is subcontracted. Give the covering and the roof area in m² of new or re-covered roof (a dormer's flat roof counts; existing roof slopes left alone do not). Do not also list roof labour or roof coverings as materials.
- Electrics and plumbing are subcontracted. For electrics, list each new or substantially altered room with its sockets, pendant lights, downlights and switches; add fixed items (new circuits, test & certification) as needed. For plumbing, list fixtures and allowances from the plumbing catalogue only.
- Plant hire: machines needed and weeks on hire. Waste: skips, grab lorries or muck-away sized to the spoil and strip-out (London streets usually need a council skip permit when a skip sits on the road).
- Fees: include Building Control and structural engineer fees when the work needs them (amount within the range shown). Do not include planning or architect's fees, which the client has normally paid already.
- Do not include items the client supplies or that are excluded by GRB's standard quote (kitchen units and appliances, sanitaryware choice above a standard suite, floor finishes, decoration beyond mist coat) unless the drawings or the notes say they are in scope.
- "area" is the new or converted floor area in m² (for a loft, the usable floor area of the new room(s)). "durationWeeks" is a realistic programme length on site.
- "jobType" is the closest match from the list; if the job combines types, pick the largest element and say so in the assumptions.
- "scope" is the scope of works for the client quote: short plain bullets, one line each, in build order.
- "summary" is one or two sentences saying what the job is.
- "clientName", "siteAddress" and "drawingsRef" (drawing numbers and revision) come from the title block; use an empty string if not shown.
- "assumptions": what you assumed where the drawings are silent (spec, foundation depth, structure). "questions": what the estimator should check on site or ask the client. Keep each to one sentence.
- Use only item names from the catalogue below, spelt exactly as written. Leave out anything with zero quantity.

CATALOGUE

${catalogueText(lib)}`

function contentFor(files: DrawingFile[], notes: string): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = files.map((f) =>
    f.type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data }, title: f.name }
      : { type: 'image', source: { type: 'base64', media_type: f.type as ImageType, data: f.data } },
  )
  const names = files.map((f) => `- ${f.name}`).join('\n')
  blocks.push({
    type: 'text',
    text: `Drawings attached:\n${names}\n\n${notes.trim() ? `Notes from the GRB estimator (these override the drawings where they differ):\n${notes.trim()}\n\n` : ''}Produce the takeoff for the proposed works.`,
  })
  return blocks
}

export function checkFiles(files: unknown): DrawingFile[] {
  if (!Array.isArray(files) || !files.length) throw new HttpError(400, 'Add at least one drawing (PDF or photo).')
  let bytes = 0
  return files.map((f) => {
    const file = f as Partial<DrawingFile>
    if (typeof file.data !== 'string' || typeof file.type !== 'string') throw new HttpError(400, 'A drawing could not be read.')
    if (file.type !== 'application/pdf' && !(IMAGE_TYPES as readonly string[]).includes(file.type))
      throw new HttpError(400, `${file.name ?? 'A file'} isn't a PDF or photo.`)
    bytes += Math.floor((file.data.length * 3) / 4)
    if (bytes > MAX_BYTES) throw new HttpError(413, 'The drawings are too large together (20 MB limit). Send fewer sheets.')
    return { name: String(file.name ?? 'drawing'), type: file.type, data: file.data }
  })
}

/** Ask Claude for the takeoff. Streams under the hood so long reads don't time out. */
export async function readDrawings(apiKey: string, files: DrawingFile[], notes: string, client?: Anthropic): Promise<Takeoff> {
  const anthropic = client ?? new Anthropic({ apiKey })
  try {
    const stream = anthropic.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: takeoffSchema(lib) } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contentFor(files, notes) }],
    })
    const msg = await stream.finalMessage()
    if (msg.stop_reason === 'refusal') throw new HttpError(422, 'Claude could not read these drawings. Try fewer sheets, or price them by hand.')
    if (msg.stop_reason === 'max_tokens') throw new HttpError(502, 'The drawings were too much to read in one go. Try fewer sheets.')
    const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    try {
      return JSON.parse(text) as Takeoff
    } catch {
      throw new HttpError(502, 'Claude returned an unreadable answer. Try again.')
    }
  } catch (e) {
    if (e instanceof HttpError) throw e
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(500, 'The drawings reader is not set up on the server (Anthropic API key).')
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The drawings reader is busy. Try again in a minute.')
    if (e instanceof Anthropic.BadRequestError) throw new HttpError(400, `The drawings couldn't be read: ${e.message}`)
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `The drawings reader failed (${e.status ?? 'network'}). Try again.`)
    throw e
  }
}
