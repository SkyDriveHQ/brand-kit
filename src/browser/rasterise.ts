/**
 * Turning a decoded logo into PNG renditions. Internal to the browser entry.
 *
 * Split in two on purpose:
 * - The GEOMETRY (how big each rendition is, where the logo sits in it, how big to decode an SVG) is pure
 *   and tested directly.
 * - The CANVAS work (`browserBackend`) is a few thin calls: decode, draw, read pixels, encode. jsdom has no
 *   canvas, so those calls are exercised only in a real browser; tests drive `prepareLogoWith` with a fake
 *   backend instead.
 */
import type { RenditionName } from '../core/kit.js'
import { RENDITION_HEIGHTS, UPLOAD_LIMITS } from '../core/kit.js'
import type { PixelBox } from '../core/analyse.js'

/** Padding around the trimmed logo in every rendition, per side, as a share of the rendition's height. */
export const RENDITION_PADDING = 0.04
/** An SVG is decoded for analysis with its shorter side at this many pixels... */
export const SVG_ANALYSIS_SHORT_PX = 1024
/** ...and its longer side at most at this many. */
export const SVG_ANALYSIS_LONG_PX = 4096
/** No canvas side larger than this is made (browsers' limits start at 16384; memory runs out well before). */
export const MAX_CANVAS_SIDE = 8192
/** A raster image with more pixels than this is refused before it is decoded (a decompression bomb guard). */
export const MAX_DECODE_PIXELS = 64 * 1024 * 1024

export type LogoShape = 'wide' | 'mark'

export interface RenditionLayout {
  name: RenditionName
  width: number
  height: number
  /** Where the trimmed logo is drawn. Everything outside it is transparent. */
  content: PixelBox
}

/**
 * The size of one rendition and the box the logo is drawn into.
 *
 * Wide: the rendition's height is `RENDITION_HEIGHTS[name]`; padding is 4% of that height on every side
 * (at least 1 px); the logo fills the height inside the padding and its width follows its aspect.
 * Mark: the rendition is a square of that size; the logo is fitted inside the padding without stretching
 * and centred.
 */
export function renditionLayout(name: RenditionName, aspect: number, shape: LogoShape): RenditionLayout {
  const size = RENDITION_HEIGHTS[name]
  const pad = Math.max(1, Math.round(size * RENDITION_PADDING))
  const inner = Math.max(1, size - 2 * pad)
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  if (shape === 'wide') {
    const w = Math.max(1, Math.round(inner * safeAspect))
    return { name, width: w + 2 * pad, height: size, content: { x: pad, y: pad, width: w, height: inner } }
  }
  const w = safeAspect >= 1 ? inner : Math.max(1, Math.round(inner * safeAspect))
  const h = safeAspect >= 1 ? Math.max(1, Math.round(inner / safeAspect)) : inner
  return {
    name,
    width: size,
    height: size,
    content: { x: Math.floor((size - w) / 2), y: Math.floor((size - h) / 2), width: w, height: h },
  }
}

export interface Placement {
  /** Where the WHOLE decoded image is drawn, so that its trimmed box lands on `clip`. */
  x: number
  y: number
  width: number
  height: number
  clip: PixelBox
}

/**
 * Where to draw the whole decoded image (`sourceWidth` × `sourceHeight`, the analysis size) so that its
 * trimmed box fills `content`. Drawing the whole image scaled, clipped to `content`, rather than copying a
 * source rectangle, lets the browser redraw an SVG at the target size (crisp) instead of scaling pixels.
 */
export function placement(trim: PixelBox, sourceWidth: number, sourceHeight: number, content: PixelBox): Placement {
  const kx = content.width / trim.width
  const ky = content.height / trim.height
  return {
    x: content.x - trim.x * kx,
    y: content.y - trim.y * ky,
    width: sourceWidth * kx,
    height: sourceHeight * ky,
    clip: content,
  }
}

/** The size a raster logo is decoded to for analysis: its own size, scaled down to `logoMaxPx` on its longer side. */
export function rasterAnalysisSize(width: number, height: number): { width: number; height: number; scale: number } {
  const scale = Math.min(1, UPLOAD_LIMITS.logoMaxPx / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale }
}

/** The size an SVG is drawn at for analysis: shorter side 1024 px, longer side at most 4096 px. */
export function svgAnalysisSize(width: number, height: number): { width: number; height: number } {
  let scale = SVG_ANALYSIS_SHORT_PX / Math.min(width, height)
  if (Math.max(width, height) * scale > SVG_ANALYSIS_LONG_PX) scale = SVG_ANALYSIS_LONG_PX / Math.max(width, height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const LENGTH = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/i
const UNIT_PX: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }

function lengthPx(value: string | null): number | null {
  if (value === null) return null
  const m = LENGTH.exec(value)
  if (m === null) return null
  const n = Number(m[1]) * (UNIT_PX[(m[2] ?? 'px').toLowerCase()] ?? 1)
  return Number.isFinite(n) && n > 0 ? n : null
}

function viewBoxOf(root: Element): { x: number; y: number; width: number; height: number } | null {
  const raw = root.getAttribute('viewBox')
  if (raw === null) return null
  const parts = raw.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [x = 0, y = 0, width = 0, height = 0] = parts
  return width > 0 && height > 0 ? { x, y, width, height } : null
}

function parseSvgRoot(svgText: string): { doc: Document; root: Element } | null {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const root = doc.documentElement
  if (root === null || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) return null
  return { doc, root }
}

/**
 * The intrinsic size of an SVG, from its `width` and `height` (absolute units only) or else its `viewBox`.
 * Null when it has neither: such an SVG has no size or shape, and browsers disagree about how to draw it.
 */
export function svgIntrinsicSize(svgText: string): { width: number; height: number } | null {
  const parsed = parseSvgRoot(svgText)
  if (parsed === null) return null
  const { root } = parsed
  const w = lengthPx(root.getAttribute('width'))
  const h = lengthPx(root.getAttribute('height'))
  const vb = viewBoxOf(root)
  if (w !== null && h !== null) return { width: w, height: h }
  if (vb !== null) {
    if (w !== null) return { width: w, height: (w * vb.height) / vb.width }
    if (h !== null) return { width: (h * vb.width) / vb.height, height: h }
    return { width: vb.width, height: vb.height }
  }
  return null
}

/**
 * A copy of the SVG with its root `width` and `height` set, so every browser decodes it at a known size
 * (an SVG with only a `viewBox` has no natural size in some browsers). When it has no `viewBox`, one is
 * added from its original size first, so the new size scales the drawing instead of cropping it.
 */
export function svgWithSize(svgText: string, width: number, height: number): string {
  const parsed = parseSvgRoot(svgText)
  if (parsed === null) throw new Error('Not an SVG document')
  const { root } = parsed
  if (viewBoxOf(root) === null) {
    const size = svgIntrinsicSize(svgText)
    if (size === null) throw new Error('This SVG has no size')
    root.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`)
  }
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  return new XMLSerializer().serializeToString(root)
}

// ---------------------------------------------------------------------------------------------------------
// The canvas: thin on purpose.
// ---------------------------------------------------------------------------------------------------------

export interface DecodedImage {
  width: number
  height: number
  source: CanvasImageSource
  close(): void
}

export interface RasterSurface {
  readonly width: number
  readonly height: number
  /** Draws `image` at (x, y, width, height), clipped to `clip` when given. */
  draw(image: DecodedImage, x: number, y: number, width: number, height: number, clip?: PixelBox): void
  readPixels(): Uint8ClampedArray
  toPng(): Promise<Blob>
}

export interface RasterBackend {
  /** Decodes a PNG, JPEG or WebP. */
  decodeRaster(blob: Blob): Promise<DecodedImage>
  /** Decodes CLEANED SVG text, through an `Image` loaded from a Blob URL (never into the page). */
  decodeSvg(svgText: string): Promise<DecodedImage>
  surface(width: number, height: number): RasterSurface
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function loadImage(blob: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.decoding = 'async'
  return new Promise<DecodedImage>((resolve, reject) => {
    img.onload = () =>
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        source: img,
        close: () => URL.revokeObjectURL(url),
      })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The browser could not draw this image'))
    }
    img.src = url
  })
}

function makeCanvas(width: number, height: number): { ctx: Context2D; toPng(): Promise<Blob> } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('This browser cannot draw images (no 2D canvas)')
    return { ctx, toPng: () => canvas.convertToBlob({ type: 'image/png' }) }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('This browser cannot draw images (no 2D canvas)')
  return {
    ctx,
    toPng: () =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b === null ? reject(new Error('The browser could not make a PNG')) : resolve(b)), 'image/png'),
      ),
  }
}

/** The real backend: `createImageBitmap` / `Image`, and `OffscreenCanvas` where available, else `<canvas>`. */
export const browserBackend: RasterBackend = {
  async decodeRaster(blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(blob)
        return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() }
      } catch {
        // Some browsers cannot decode every type through createImageBitmap; fall back to an <img>.
      }
    }
    return loadImage(blob)
  },
  decodeSvg(svgText) {
    return loadImage(new Blob([svgText], { type: 'image/svg+xml' }))
  },
  surface(width, height) {
    const { ctx, toPng } = makeCanvas(width, height)
    return {
      width,
      height,
      draw(image, x, y, w, h, clip) {
        ctx.save()
        if (clip !== undefined) {
          ctx.beginPath()
          ctx.rect(clip.x, clip.y, clip.width, clip.height)
          ctx.clip()
        }
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(image.source, x, y, w, h)
        ctx.restore()
      },
      readPixels() {
        return ctx.getImageData(0, 0, width, height).data
      },
      toPng,
    }
  },
}
