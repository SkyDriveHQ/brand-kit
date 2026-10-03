/**
 * Preparing a dropped-in file in the customer's browser, before anything is uploaded (research §4.3):
 * check it, clean it, measure it, and make the PNG renditions every surface needs.
 *
 * Everything refused throws `KitError` with plain-English problems. Repairs and warnings travel on the
 * result's `problems`, so the drop-in can show them next to the preview.
 */
import type { KitProblem, LogoSlot, LogoSourceType, RenditionName } from '../core/kit.js'
import { LOGO_SLOTS, LOGO_SOURCE_TYPES, MARK_RENDITIONS, RENDITION_HEIGHTS, UPLOAD_LIMITS, WIDE_RENDITIONS } from '../core/kit.js'
import { analysePixels } from '../core/analyse.js'
import { extractPalette } from '../core/palette.js'
import { readImageSize, sniffType } from '../core/files.js'
import { KitError } from '../core/validate.js'
import { readBytes, sha256Hex } from './hash.js'
import { sanitizeSvg } from './sanitize.js'
import {
  browserBackend,
  MAX_CANVAS_SIDE,
  MAX_DECODE_PIXELS,
  placement,
  rasterAnalysisSize,
  renditionLayout,
  svgAnalysisSize,
  svgIntrinsicSize,
  svgWithSize,
} from './rasterise.js'
import type { DecodedImage, LogoShape, RasterBackend } from './rasterise.js'
import type { PreparedGuide, PreparedLogo, PreparedRendition } from './types.js'

const EXTENSIONS: Record<LogoSourceType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

const TYPE_WORDS: Record<string, string> = {
  'image/png': 'a PNG',
  'image/jpeg': 'a JPEG',
  'image/webp': 'a WebP',
  'image/svg+xml': 'an SVG',
  'application/pdf': 'a PDF',
}

/** A logo longer or narrower than this (width ÷ height) cannot be shown anywhere usefully. */
const MAX_ASPECT = 50

/** Declared types that are only a browser's guess at "some file", so they cannot disagree with the bytes. */
const UNINFORMATIVE_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream'])

/** Browsers' other spellings of the same types. */
const TYPE_ALIASES: Record<string, string> = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/x-png': 'image/png' }

export interface PrepareDeps {
  backend: RasterBackend
}

function refuse(field: string, message: string): never {
  throw new KitError([{ field, severity: 'refused', message }])
}

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

function displayName(name: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^.*[\\/]/, '').trim()
  return (clean === '' ? fallback : clean).slice(0, 255)
}

function declaredType(file: File): string {
  const t = (file.type ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
  return TYPE_ALIASES[t] ?? t
}

/**
 * Prepares a logo for one slot. See `PreparedLogo`.
 *
 * Refuses (throws `KitError`): an empty file, one over 5 MB, one whose bytes are not PNG, JPEG, WebP or SVG,
 * one whose bytes disagree with the type the browser declared, an SVG that cannot be made safe or has no
 * size, a raster over 64 megapixels, a logo with nothing visible, a raster whose trimmed shorter side is
 * under `logoMinPx`, and a logo more than 50 times longer than it is high (or the reverse).
 */
export function prepareLogo(file: File, slot: LogoSlot): Promise<PreparedLogo> {
  return prepareLogoWith(file, slot, { backend: browserBackend })
}

/** `prepareLogo` with the canvas backend passed in. Internal: tests use it with a fake canvas. */
export async function prepareLogoWith(file: File, slot: LogoSlot, deps: PrepareDeps): Promise<PreparedLogo> {
  if (!LOGO_SLOTS.includes(slot)) throw new Error(`Unknown logo slot: ${String(slot)}`)
  const field = `logos.${slot}`
  const problems: KitProblem[] = []

  if (file.size === 0) refuse(field, 'This file is empty. Please choose your logo file again.')
  if (file.size > UPLOAD_LIMITS.logoMaxBytes) {
    refuse(field, `This file is ${mb(file.size)}; logos can be up to ${mb(UPLOAD_LIMITS.logoMaxBytes)}. Export a smaller PNG or an SVG.`)
  }

  const bytes = await readBytes(file)
  const sniffed = sniffType(bytes)
  if (sniffed === 'application/pdf') {
    refuse(field, 'This is a PDF. Logos must be PNG, JPEG, WebP or SVG files. (A brand guide PDF goes in the brand guide box.)')
  }
  if (sniffed === null || !(LOGO_SOURCE_TYPES as readonly string[]).includes(sniffed)) {
    refuse(
      field,
      'We could not read this file as a logo. Logos must be PNG, JPEG, WebP or SVG files; GIF, HEIC, AI and EPS files need exporting as PNG or SVG first.',
    )
  }
  const type = sniffed as LogoSourceType
  const declared = declaredType(file)
  if (!UNINFORMATIVE_TYPES.has(declared) && declared !== type) {
    refuse(
      field,
      `This file is named as ${TYPE_WORDS[declared] ?? `"${declared}"`} file but its contents are ${TYPE_WORDS[type] ?? type} image. Export it again from your design program, or rename it to match.`,
    )
  }

  const shape: LogoShape = slot === 'mark' ? 'mark' : 'wide'
  let originalBlob: Blob = file
  let originalBytes: Uint8Array = bytes
  let decoded: DecodedImage
  let analysisWidth: number
  let analysisHeight: number
  /** Analysis pixels per original pixel, for rasters (at most 1); null for SVG, which has no pixels. */
  let rasterScale: number | null

  if (type === 'image/svg+xml') {
    const text = new TextDecoder('utf-8').decode(bytes)
    const cleaned = sanitizeSvg(text)
    if (cleaned.removed.length > 0) {
      problems.push({
        field,
        severity: 'repaired',
        message: `We removed things a logo does not need from your SVG (${cleaned.removed.join(', ')}). Check the preview looks right.`,
      })
    }
    const size = svgIntrinsicSize(cleaned.svg)
    if (size === null) {
      refuse(field, 'This SVG has no size (no width and height, and no viewBox). Export it again with a viewBox, or upload a PNG.')
    }
    originalBytes = new TextEncoder().encode(cleaned.svg)
    originalBlob = new Blob([cleaned.svg], { type })
    const a = svgAnalysisSize(size.width, size.height)
    analysisWidth = a.width
    analysisHeight = a.height
    rasterScale = null
    decoded = await deps.backend.decodeSvg(svgWithSize(cleaned.svg, analysisWidth, analysisHeight))
  } else {
    const header = readImageSize(bytes)
    if (header !== null && header.width * header.height > MAX_DECODE_PIXELS) {
      refuse(field, `This image is ${header.width} × ${header.height} pixels, too large to process. Export it at 4096 pixels or less on its longer side.`)
    }
    try {
      decoded = await deps.backend.decodeRaster(file)
    } catch {
      refuse(field, 'Your browser could not open this image; the file may be damaged. Export it again as PNG.')
    }
    const a = rasterAnalysisSize(decoded.width, decoded.height)
    analysisWidth = a.width
    analysisHeight = a.height
    rasterScale = a.scale
  }

  try {
    const surface = deps.backend.surface(analysisWidth, analysisHeight)
    surface.draw(decoded, 0, 0, analysisWidth, analysisHeight)
    const pixels = surface.readPixels()
    const analysis = analysePixels(pixels, analysisWidth, analysisHeight)
    if (analysis === null) refuse(field, 'This logo has nothing visible in it: every pixel is transparent.')
    const { trim, tone, aspect } = analysis

    if (rasterScale !== null) {
      const shorter = Math.round(Math.min(trim.width, trim.height) / rasterScale)
      if (shorter < UPLOAD_LIMITS.logoMinPx) {
        refuse(
          field,
          `Once its empty margins are trimmed, this logo is only ${shorter} pixels on its shorter side; the smallest we accept is ${UPLOAD_LIMITS.logoMinPx}. Upload a larger PNG (512 pixels or more is best) or an SVG.`,
        )
      }
      const largest = Math.max(...(shape === 'mark' ? MARK_RENDITIONS : WIDE_RENDITIONS).map((n) => RENDITION_HEIGHTS[n]))
      if (trim.height / rasterScale < largest * 0.75) {
        problems.push({
          field,
          severity: 'warning',
          message: `This logo is ${Math.round(trim.height / rasterScale)} pixels high. It will look soft when printed large; an SVG or a PNG at least ${largest} pixels high is better.`,
        })
      }
    }
    if (aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT) {
      refuse(field, 'This logo is too long and thin to show anywhere. Upload a version with less empty space or a more compact layout.')
    }
    if (shape === 'mark' && (aspect < 0.8 || aspect > 1.25)) {
      problems.push({ field, severity: 'warning', message: 'This icon is not square, so it will be centred with space around it.' })
    }
    if (shape === 'wide' && aspect < 0.8) {
      problems.push({ field, severity: 'warning', message: 'This logo is taller than it is wide, so it will look small in headers. A wide version works better here.' })
    }

    const palette = extractPalette(pixels, analysisWidth, analysisHeight)

    const renditions: PreparedRendition[] = []
    for (const name of shape === 'mark' ? MARK_RENDITIONS : WIDE_RENDITIONS) {
      const r = await renderOne(deps.backend, decoded, name, shape, trim, analysisWidth, analysisHeight, aspect)
      if (r === 'too-wide') {
        problems.push({ field, severity: 'warning', message: `This logo is too wide to make its ${name} size, so that size was skipped.` })
      } else if (r === 'too-big') {
        problems.push({ field, severity: 'warning', message: `This logo's ${name} size came out over ${mb(UPLOAD_LIMITS.renditionMaxBytes)}, so it was skipped.` })
      } else {
        renditions.push(r)
      }
    }
    if (renditions.length === 0) refuse(field, 'We could not make any usable images from this logo. Try a PNG.')

    return {
      slot,
      original: {
        blob: originalBlob,
        type,
        name: displayName(file.name, `logo.${EXTENSIONS[type]}`),
        sha256: await sha256Hex(originalBytes),
        ext: EXTENSIONS[type],
      },
      renditions,
      tone,
      aspect,
      palette,
      problems,
    }
  } finally {
    decoded.close()
  }
}

async function renderOne(
  backend: RasterBackend,
  decoded: DecodedImage,
  name: RenditionName,
  shape: LogoShape,
  trim: { x: number; y: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
  aspect: number,
): Promise<PreparedRendition | 'too-wide' | 'too-big'> {
  const layout = renditionLayout(name, aspect, shape)
  if (layout.width > MAX_CANVAS_SIDE) return 'too-wide'
  const surface = backend.surface(layout.width, layout.height)
  const at = placement(trim, sourceWidth, sourceHeight, layout.content)
  surface.draw(decoded, at.x, at.y, at.width, at.height, at.clip)
  const blob = await surface.toPng()
  if (blob.size > UPLOAD_LIMITS.renditionMaxBytes) return 'too-big'
  return { name, blob, width: layout.width, height: layout.height, sha256: await sha256Hex(blob) }
}

/**
 * Prepares a brand-guide PDF: at most 25 MB, and really a PDF by its first bytes. Nothing is read from it.
 */
export async function prepareGuide(file: File): Promise<PreparedGuide> {
  const field = 'guide'
  if (file.size === 0) refuse(field, 'This file is empty. Please choose your brand guide again.')
  if (file.size > UPLOAD_LIMITS.guideMaxBytes) {
    refuse(field, `This file is ${mb(file.size)}; a brand guide can be up to ${mb(UPLOAD_LIMITS.guideMaxBytes)}.`)
  }
  const bytes = await readBytes(file)
  if (sniffType(bytes) !== 'application/pdf') refuse(field, 'A brand guide must be a PDF file. This file is not one.')
  return { blob: file, name: displayName(file.name, 'brand-guide.pdf'), bytes: file.size, sha256: await sha256Hex(bytes) }
}
