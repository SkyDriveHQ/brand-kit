/**
 * Brand-colour suggestions from a logo's pixels, by median cut. Pure: no DOM, no canvas.
 *
 * The customer still picks the colour (research §5.1): these are suggestions shown next to the picker.
 */

export interface PaletteEntry {
  /** Lower-case `#rrggbb`. */
  hex: string
  /** Share of the visible pixels this colour stands for, 0 to 1. */
  share: number
}

/** Pixels with alpha below this are ignored. */
export const PALETTE_MIN_ALPHA = 128
/** At most this many pixels are sampled (evenly), so a 4096 px logo costs the same as a small one. */
export const PALETTE_MAX_SAMPLES = 65_536

const NEAR_WHITE = 230
const NEAR_BLACK = 40

interface Bin {
  /** 5-bit-per-channel coordinates. */
  r: number
  g: number
  b: number
  count: number
  sumR: number
  sumG: number
  sumB: number
}

/**
 * Up to `max` dominant colours of the visible pixels (alpha 128 or more), by median cut over a
 * 5-bit-per-channel histogram.
 *
 * Near-white and near-black are included but sorted after every other colour, so the first entries are good
 * brand-colour suggestions; within each group, larger shares come first. Returns `[]` when nothing is
 * visible, `max` is below 1, or the buffer does not match the size.
 */
export function extractPalette(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  max = 5,
): PaletteEntry[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return []
  if (rgba.length !== width * height * 4) return []
  const limit = Math.floor(max)
  if (!(limit >= 1)) return []

  const total = width * height
  const step = Math.max(1, Math.ceil(total / PALETTE_MAX_SAMPLES))
  const bins = new Map<number, Bin>()
  let visible = 0
  for (let p = 0; p < total; p += step) {
    const i = p * 4
    if ((rgba[i + 3] ?? 0) < PALETTE_MIN_ALPHA) continue
    const r = rgba[i] ?? 0
    const g = rgba[i + 1] ?? 0
    const b = rgba[i + 2] ?? 0
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    let bin = bins.get(key)
    if (bin === undefined) {
      bin = { r: r >> 3, g: g >> 3, b: b >> 3, count: 0, sumR: 0, sumG: 0, sumB: 0 }
      bins.set(key, bin)
    }
    bin.count++
    bin.sumR += r
    bin.sumG += g
    bin.sumB += b
    visible++
  }
  if (visible === 0) return []

  const boxes: Bin[][] = [[...bins.values()]]
  while (boxes.length < limit) {
    // Split the box with the most pixels times its widest range; a box of one colour never splits.
    let best = -1
    let bestScore = 0
    for (let k = 0; k < boxes.length; k++) {
      const box = boxes[k]
      if (box === undefined || box.length < 2) continue
      const score = population(box) * widest(box).range
      if (score > bestScore) {
        bestScore = score
        best = k
      }
    }
    if (best < 0) break
    const box = boxes[best]
    if (box === undefined) break
    const [lo, hi] = split(box)
    boxes.splice(best, 1, lo, hi)
  }

  // Average each box, then merge any two that round to the same hex.
  const merged = new Map<string, number>()
  for (const box of boxes) {
    let n = 0
    let sr = 0
    let sg = 0
    let sb = 0
    for (const bin of box) {
      n += bin.count
      sr += bin.sumR
      sg += bin.sumG
      sb += bin.sumB
    }
    if (n === 0) continue
    const hex = toHex(Math.round(sr / n), Math.round(sg / n), Math.round(sb / n))
    merged.set(hex, (merged.get(hex) ?? 0) + n)
  }

  return [...merged.entries()]
    .map(([hex, n]) => ({ hex, share: n / visible, extreme: isNearWhiteOrBlack(hex) }))
    .sort((a, b) => Number(a.extreme) - Number(b.extreme) || b.share - a.share || (a.hex < b.hex ? -1 : 1))
    .map(({ hex, share }) => ({ hex, share }))
}

function population(box: Bin[]): number {
  let n = 0
  for (const bin of box) n += bin.count
  return n
}

function widest(box: Bin[]): { channel: 'r' | 'g' | 'b'; range: number } {
  let rMin = 31, rMax = 0, gMin = 31, gMax = 0, bMin = 31, bMax = 0
  for (const bin of box) {
    if (bin.r < rMin) rMin = bin.r
    if (bin.r > rMax) rMax = bin.r
    if (bin.g < gMin) gMin = bin.g
    if (bin.g > gMax) gMax = bin.g
    if (bin.b < bMin) bMin = bin.b
    if (bin.b > bMax) bMax = bin.b
  }
  const r = rMax - rMin
  const g = gMax - gMin
  const b = bMax - bMin
  if (g >= r && g >= b) return { channel: 'g', range: g }
  if (r >= b) return { channel: 'r', range: r }
  return { channel: 'b', range: b }
}

/** Splits at the weighted median of the widest channel. Both halves are non-empty. */
function split(box: Bin[]): [Bin[], Bin[]] {
  const { channel } = widest(box)
  const sorted = [...box].sort((a, b) => a[channel] - b[channel])
  const half = population(sorted) / 2
  let acc = 0
  let cut = 1
  for (let k = 0; k < sorted.length - 1; k++) {
    acc += sorted[k]?.count ?? 0
    cut = k + 1
    if (acc >= half) break
  }
  return [sorted.slice(0, cut), sorted.slice(cut)]
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')
}

function isNearWhiteOrBlack(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE) || (r <= NEAR_BLACK && g <= NEAR_BLACK && b <= NEAR_BLACK)
}
