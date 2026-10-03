/**
 * Measuring a logo from its pixels. Pure: no DOM, no canvas. The browser side decodes the image into an
 * RGBA buffer (canvas `getImageData`) and hands it here, so this runs and is tested in plain Node.
 */
import type { LogoTone } from './kit.js'

export interface PixelBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PixelAnalysis {
  /** The logo's visible content, with transparent (or uniform near-white / near-black) margins removed. */
  trim: PixelBox
  tone: LogoTone
  /** `trim.width / trim.height`. */
  aspect: number
}

/** A pixel with alpha below this is a transparent margin. */
export const TRIM_ALPHA = 16
/** A pixel with alpha below this counts towards "has a transparent background". */
export const OPAQUE_ALPHA = 250
/** The share of not-quite-opaque pixels (inside the trimmed box) at which a logo counts as transparent. */
export const TRANSPARENT_SHARE = 0.05
/** Every channel at or above this is near-white. */
const NEAR_WHITE = 235
/** Every channel at or below this is near-black. */
const NEAR_BLACK = 20

/** sRGB 8-bit channel to linear light, per WCAG 2. A table, because it runs once per pixel. */
const LINEAR: Float64Array = (() => {
  const t = new Float64Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    t[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return t
})()

/** WCAG 2 relative luminance of one 8-bit sRGB colour. */
export function pixelLuminance(r: number, g: number, b: number): number {
  return 0.2126 * (LINEAR[r] ?? 0) + 0.7152 * (LINEAR[g] ?? 0) + 0.0722 * (LINEAR[b] ?? 0)
}

type Matte = 'white' | 'black' | null

function matteOf(r: number, g: number, b: number): Matte {
  if (r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE) return 'white'
  if (r <= NEAR_BLACK && g <= NEAR_BLACK && b <= NEAR_BLACK) return 'black'
  return null
}

/**
 * Measures a logo.
 *
 * - **Trim.** Rows and columns at the edges are removed while every pixel in them is transparent (alpha
 *   below 16). For a logo on an opaque background, they are also removed while every pixel in them is
 *   near-white, or every pixel is near-black, matching the background. The background is taken from the
 *   four corners: all four must be opaque and the same (near-white or near-black), otherwise nothing opaque
 *   is trimmed. If trimming an opaque background would leave nothing (a solid white or black image), the
 *   opaque trim is not applied.
 * - **Tone**, measured inside the trimmed box, because that is what the renditions show:
 *   `luminance` is the alpha-weighted mean WCAG relative luminance of pixels with alpha 16 or more;
 *   `transparent` is true when at least 5% of the box's pixels have alpha below 250.
 * - Returns null when no pixel is visible (every alpha below 16), or the buffer does not match the size.
 */
export function analysePixels(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): PixelAnalysis | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null
  if (rgba.length !== width * height * 4) return null

  const matte = cornerMatte(rgba, width, height)
  let box = contentBox(rgba, width, height, matte)
  if (box === null && matte !== null) box = contentBox(rgba, width, height, null)
  if (box === null) return null

  let weight = 0
  let lumSum = 0
  let notOpaque = 0
  for (let y = box.y; y < box.y + box.height; y++) {
    let i = (y * width + box.x) * 4
    for (let x = 0; x < box.width; x++, i += 4) {
      const a = rgba[i + 3] ?? 0
      if (a < OPAQUE_ALPHA) notOpaque++
      if (a < TRIM_ALPHA) continue
      weight += a
      lumSum += a * pixelLuminance(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0)
    }
  }
  const area = box.width * box.height
  return {
    trim: box,
    tone: {
      luminance: weight > 0 ? clamp01(lumSum / weight) : 0,
      transparent: notOpaque / area >= TRANSPARENT_SHARE,
    },
    aspect: box.width / box.height,
  }
}

/** The shared near-white / near-black of the four corners, when all four are opaque and agree. */
function cornerMatte(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Matte {
  const corners = [0, width - 1, (height - 1) * width, height * width - 1]
  let found: Matte = null
  for (const p of corners) {
    const i = p * 4
    if ((rgba[i + 3] ?? 0) < OPAQUE_ALPHA) return null
    const m = matteOf(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0)
    if (m === null || (found !== null && m !== found)) return null
    found = m
  }
  return found
}

/** The bounding box of every pixel that is not blank. Equivalent to peeling blank edge rows and columns. */
function contentBox(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  matte: Matte,
): PixelBox | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    let i = y * width * 4
    for (let x = 0; x < width; x++, i += 4) {
      const a = rgba[i + 3] ?? 0
      if (a < TRIM_ALPHA) continue
      if (matte !== null && a >= OPAQUE_ALPHA && matteOf(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0) === matte) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}
