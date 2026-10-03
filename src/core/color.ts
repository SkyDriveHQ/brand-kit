/**
 * Colour maths for brand kits. Pure functions, no DOM.
 *
 * Every colour that leaves this module is a strict lower-case `#rrggbb` string. That is the security
 * guarantee the rest of the package leans on: a value of that shape cannot carry CSS, HTML or a URL.
 *
 * Contrast follows WCAG 2 (the accessibility standard's "contrast ratio": 1:1 for identical colours,
 * 21:1 for black on white). Shades are computed in OKLCH, a colour space in which equal steps of
 * lightness look equally different to the eye, so a lightened brand colour still looks like the brand.
 */
import type { BrandKitColors, KitProblem, ThemeColors } from './kit.js'

const HEX6 = /^#[0-9a-f]{6}$/
const HEX_INPUT = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** True when `s` is already a strict lower-case `#rrggbb`. */
export function isStrictHex(s: unknown): s is string {
  return typeof s === 'string' && HEX6.test(s)
}

/**
 * Parse a colour written as hex (`#abc`, `#AABBCC`, with or without the `#`, surrounding spaces allowed)
 * into lower-case `#rrggbb`. Anything else, including CSS colour names and `rgb()`, is null.
 */
export function parseHex(s: string): string | null {
  if (typeof s !== 'string') return null
  const m = HEX_INPUT.exec(s.trim())
  if (!m || m[1] === undefined) return null
  let h = m[1].toLowerCase()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return `#${h}`
}

function channels(hex: string): [number, number, number] {
  const h = parseHex(hex)
  if (h === null) throw new Error(`Not a hex colour: ${JSON.stringify(String(hex).slice(0, 32))}`)
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}

function toHexByte(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)))
  return v.toString(16).padStart(2, '0')
}

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return c * 255
}

/** WCAG 2 relative luminance: 0 for black, 1 for white. Throws on a value that is not hex. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex)
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

/** WCAG 2 contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Black or white text for `bg`. White is preferred whenever it reaches 4.5:1, because white text on a
 * mid-tone brand colour (Google's blue, for example) is what brands expect; otherwise whichever of the
 * two reads better. One of them always reaches about 4.58:1 at worst.
 */
export function inkFor(bg: string): '#000000' | '#ffffff' {
  const white = contrastRatio('#ffffff', bg)
  if (white >= 4.5) return '#ffffff'
  return contrastRatio('#000000', bg) >= white ? '#000000' : '#ffffff'
}

// ---------------------------------------------------------------------------------------------------------
// OKLCH (Björn Ottosson's OKLab, in polar form). l is 0..1, c is chroma (0 = grey, ~0.37 max in sRGB),
// h is hue in degrees 0..360.
// ---------------------------------------------------------------------------------------------------------

export interface Oklch {
  l: number
  c: number
  h: number
}

function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = channels(hex)
  const [L, a, bb] = linearRgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b))
  const c = Math.sqrt(a * a + bb * bb)
  let h = c < 1e-6 ? 0 : (Math.atan2(bb, a) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: L, c, h }
}

function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180
  return oklabToLinearRgb(l, c * Math.cos(rad), c * Math.sin(rad))
}

function inGamut(rgb: [number, number, number]): boolean {
  const eps = 1e-6
  return rgb.every((v) => v >= -eps && v <= 1 + eps)
}

/**
 * OKLCH to `#rrggbb`. A colour outside what a screen can show is brought inside by lowering its chroma
 * (making it greyer) while keeping its lightness and hue, rather than by clipping channels, which would
 * shift the hue.
 */
export function oklchToHex(color: Oklch): string {
  const l = Math.max(0, Math.min(1, Number.isFinite(color.l) ? color.l : 0))
  const h = Number.isFinite(color.h) ? ((color.h % 360) + 360) % 360 : 0
  let c = Math.max(0, Number.isFinite(color.c) ? color.c : 0)
  if (!inGamut(oklchToLinear({ l, c, h }))) {
    let lo = 0
    let hi = c
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear({ l, c: mid, h }))) lo = mid
      else hi = mid
    }
    c = lo
  }
  const rgb = oklchToLinear({ l, c, h })
  return `#${rgb.map((v) => toHexByte(linearToSrgb(Math.max(0, Math.min(1, v))))).join('')}`
}

/**
 * Move `fg`'s OKLCH lightness (keeping its hue) until it reaches `min` contrast against `bg`, choosing
 * whichever direction (lighter or darker) needs the smaller change. Returns `fg` unchanged when it
 * already passes, and black or white when no shade of the hue can reach `min`.
 */
export function ensureContrast(fg: string, bg: string, min: number): string {
  const start = parseHex(fg)
  const ground = parseHex(bg)
  if (start === null || ground === null) throw new Error('ensureContrast needs two hex colours')
  if (contrastRatio(start, ground) >= min) return start
  const o = hexToOklch(start)
  const candidates: { hex: string; delta: number }[] = []
  for (const target of [1, 0]) {
    const at = (l: number) => oklchToHex({ l, c: o.c, h: o.h })
    if (contrastRatio(at(target), ground) < min) continue
    // Binary search for the smallest step towards `target` that passes.
    let pass = target
    let fail = o.l
    for (let i = 0; i < 40; i++) {
      const mid = (pass + fail) / 2
      if (contrastRatio(at(mid), ground) >= min) pass = mid
      else fail = mid
    }
    let hex = at(pass)
    // Rounding to whole channel values can land a hair under; step on until it passes.
    for (let i = 0; i < 100 && contrastRatio(hex, ground) < min; i++) {
      pass += target > o.l ? 0.002 : -0.002
      hex = at(Math.max(0, Math.min(1, pass)))
    }
    if (contrastRatio(hex, ground) >= min) candidates.push({ hex, delta: Math.abs(pass - o.l) })
  }
  candidates.sort((a, b) => a.delta - b.delta)
  return candidates[0]?.hex ?? inkFor(ground)
}

function shift(hex: string, dl: number, maxChroma = Infinity): string {
  const o = hexToOklch(hex)
  return oklchToHex({ l: o.l + dl, c: Math.min(o.c, maxChroma), h: o.h })
}

/** The dark ground the dark-screen repair measures against (a hangar TV, a dark web page). */
export const DARK_GROUND = '#111111'
export const LIGHT_GROUND = '#ffffff'
/** The minimum contrast for large shapes and interface parts (WCAG 2, 3:1). */
export const MIN_SHAPE_CONTRAST = 3
/** The minimum contrast for ordinary text (WCAG 2 level AA, 4.5:1). */
export const MIN_TEXT_CONTRAST = 4.5

const NEUTRAL_ACCENT = '#2563eb'

interface DerivedPair {
  base: string
  ink: string
  problems: KitProblem[]
}

/** A brand colour made safe for one ground, and the black-or-white text drawn on it. */
function derivePair(
  input: string,
  ground: 'light' | 'dark',
  field: string,
  report: boolean,
  words: { your: string; it: string },
): DerivedPair {
  const problems: KitProblem[] = []
  let base = input
  if (ground === 'dark' && contrastRatio(base, DARK_GROUND) < MIN_SHAPE_CONTRAST) {
    base = ensureContrast(base, DARK_GROUND, MIN_SHAPE_CONTRAST)
    if (report)
      problems.push({
        field,
        severity: 'repaired',
        message: `${words.your} is too dark to see on a dark screen, so a lighter shade of ${words.it} is used there.`,
      })
  }
  if (ground === 'light' && report && contrastRatio(base, LIGHT_GROUND) < MIN_SHAPE_CONTRAST) {
    problems.push({
      field,
      severity: 'warning',
      message: `${words.your} is very pale, so it is hard to see on a white page. Text drawn on top of it is dark so that it stays readable.`,
    })
  }
  let ink: string = inkFor(base)
  if (contrastRatio(ink, base) < MIN_TEXT_CONTRAST) {
    // With pure black and pure white inks this cannot happen (one of them always reaches about 4.58:1),
    // but the guarantee is cheap to keep in case the inks ever change.
    const adjusted = [ensureContrast(base, '#ffffff', MIN_TEXT_CONTRAST), ensureContrast(base, '#000000', MIN_TEXT_CONTRAST)]
    const firstAdjusted = adjusted[0] ?? base
    const pick = adjusted.reduce<string>((best, cand) => {
      const d = (x: string) => Math.abs(hexToOklch(x).l - hexToOklch(input).l)
      return d(cand) < d(best) ? cand : best
    }, firstAdjusted)
    base = pick
    ink = inkFor(base)
    if (report)
      problems.push({
        field,
        severity: 'repaired',
        message: `Neither black nor white text is easy to read on ${words.your.replace(/^Your/, 'your')}, so a slightly different shade of ${words.it} is used behind text.`,
      })
  }
  return { base, ink, problems }
}

/**
 * Turn the customer's one or two brand colours into everything a surface needs.
 *
 * - On a dark ground, a brand colour too dark to see against `#111111` (below 3:1) is lightened, keeping
 *   its hue, and the repair is reported.
 * - `accentInk` is black or white and always reaches 4.5:1 on `accent`.
 * - `accentHover` moves away from the ink, so text on a hovered button is never harder to read.
 * - `accentSoft` is a pale tint (a deep one on a dark ground) for panels behind accent-coloured text.
 *
 * Problems are reported only for the customer's own colours, never for the product's `fallbackAccent`.
 */
export function deriveColors(
  colors: BrandKitColors,
  fallbackAccent: string,
  ground: 'light' | 'dark',
): { colors: ThemeColors; problems: KitProblem[] } {
  const problems: KitProblem[] = []
  const customer = colors.primary === undefined ? null : parseHex(colors.primary)
  const startAccent = customer ?? parseHex(fallbackAccent) ?? NEUTRAL_ACCENT
  const primary = derivePair(startAccent, ground, 'colors.primary', customer !== null, {
    your: 'Your brand colour',
    it: 'it',
  })
  problems.push(...primary.problems)
  const accent = primary.base
  const accentInk = primary.ink
  // Hover moves away from the ink (darker under white text, lighter under black), but must keep both
  // guarantees: the ink stays readable on it, and on a dark ground it stays visible against the ground.
  // The first candidate that keeps both wins; the accent itself always does.
  const away = accentInk === '#ffffff' ? -1 : 1
  const accentHover =
    [0.07 * away, 0.035 * away, -0.07 * away, -0.035 * away]
      .map((dl) => shift(accent, dl))
      .find((h) => contrastRatio(h, accentInk) >= 4.5 && (ground === 'light' || contrastRatio(h, DARK_GROUND) >= MIN_SHAPE_CONTRAST)) ?? accent
  const accentSoft = ground === 'light' ? oklchFixedL(accent, 0.965, 0.03) : oklchFixedL(accent, 0.28, 0.05)

  let secondary: string | null = null
  let secondaryInk: string | null = null
  const second = colors.secondary === undefined ? null : parseHex(colors.secondary)
  if (second !== null) {
    const pair = derivePair(second, ground, 'colors.secondary', true, { your: 'Your second brand colour', it: 'it' })
    problems.push(...pair.problems)
    secondary = pair.base
    secondaryInk = pair.ink
  }
  return { colors: { accent, accentInk, accentHover, accentSoft, secondary, secondaryInk }, problems }
}

function oklchFixedL(hex: string, l: number, maxChroma: number): string {
  const o = hexToOklch(hex)
  return oklchToHex({ l, c: Math.min(o.c, maxChroma), h: o.h })
}

/** Hue ranges (OKLCH degrees) of the suite's fixed status colours a brand colour could be mistaken for. */
export const STATUS_HUES = {
  red: { from: 0, to: 45 },
  amber: { from: 45, to: 100 },
  /** Hue wraps at 360: magenta-reds (crimson, raspberry) read as red too. */
  redWrap: { from: 345, to: 360 },
} as const
/** Below this chroma a colour is too grey to be read as a status colour. */
export const STATUS_MIN_CHROMA = 0.08

/**
 * A warning when a brand colour could be mistaken for the suite's red (errors, danger) or amber
 * (cautions, weather holds). Brand colour never replaces status colours; this tells the customer so.
 * Returns null for anything else, including colours that are not hex.
 */
export function statusColourWarning(hex: string, field = 'colors.primary'): KitProblem | null {
  const h = parseHex(hex)
  if (h === null) return null
  const o = hexToOklch(h)
  if (o.c <= STATUS_MIN_CHROMA) return null
  const which = field === 'colors.secondary' ? 'Your second brand colour' : 'Your brand colour'
  if ((o.h >= STATUS_HUES.red.from && o.h < STATUS_HUES.red.to) || o.h >= STATUS_HUES.redWrap.from) {
    return {
      field,
      severity: 'warning',
      message: `${which} is close to the red used for errors and danger warnings. Your colour is still used for your name, buttons and headings, but red warnings always keep their own colour and also show an icon and a word, so nobody mistakes your brand for an alert.`,
    }
  }
  if (o.h >= STATUS_HUES.amber.from && o.h <= STATUS_HUES.amber.to) {
    return {
      field,
      severity: 'warning',
      message: `${which} is close to the amber used for cautions such as weather holds. Your colour is still used for your name, buttons and headings, but cautions always keep their own colour and also show an icon and a word, so nobody mistakes your brand for a caution.`,
    }
  }
  return null
}
