/**
 * Preparing a logo from a file on disk, in Node, with `sharp` (an optional peer dependency).
 *
 * Mirrors the browser `prepareLogo`: same checks and messages, same renditions at the same sizes, the same
 * pure measurement (`analysePixels`, `extractPalette`) run on raw RGBA, and the same result shape. Differences:
 * the type declared by the file extension plays the part of the browser's declared MIME type, and an SVG is
 * refused (not repaired) when `svgDenyScan` finds anything dangerous in it, because Node has no sanitiser.
 * An SVG is rasterised by sharp and is never written out or served: every output is a PNG named by its hash.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { KitProblem, LogoSlot, LogoSourceType, RenditionName } from '../core/kit.js'
import { LOGO_SLOTS, LOGO_SOURCE_TYPES, MARK_RENDITIONS, RENDITION_HEIGHTS, UPLOAD_LIMITS, WIDE_RENDITIONS } from '../core/kit.js'
import { analysePixels } from '../core/analyse.js'
import { extractPalette } from '../core/palette.js'
import { readImageSize, sniffType, svgDenyScan } from '../core/files.js'
import { KitError } from '../core/validate.js'
import { MAX_CANVAS_SIDE, MAX_DECODE_PIXELS, rasterAnalysisSize, renditionLayout, svgAnalysisSize } from '../browser/rasterise.js'
import type { LogoShape } from '../browser/rasterise.js'
import type { PreparedLogo, PreparedRendition } from '../browser/types.js'

type Sharp = typeof import('sharp').default

const EXTENSIONS: Record<LogoSourceType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }
const EXT_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
const TYPE_WORDS: Record<string, string> = {
  'image/png': 'a PNG',
  'image/jpeg': 'a JPEG',
  'image/webp': 'a WebP',
  'image/svg+xml': 'an SVG',
  'application/pdf': 'a PDF',
}
const MAX_ASPECT = 50

async function loadSharp(): Promise<Sharp> {
  try {
    const mod = (await import('sharp')) as unknown as { default?: Sharp }
    return (mod.default ?? (mod as unknown as Sharp)) as Sharp
  } catch {
    throw new Error('prepareLogoFile needs the "sharp" package. Install it with: npm install sharp')
  }
}

function refuse(field: string, message: string): never {
  throw new KitError([{ field, severity: 'refused', message }])
}

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Prepares the logo file at `path` for `slot`, writes its PNG renditions into `outDir` as `<sha256>.png`
 * (creating the folder), and returns what the browser `prepareLogo` returns. Refuses (throws `KitError`) in
 * the same cases: empty, over 5 MB, not PNG/JPEG/WebP/SVG by its bytes, bytes that disagree with the
 * extension, an unsafe or sizeless SVG, over 64 megapixels, nothing visible, under `logoMinPx` on the
 * trimmed shorter side, or longer than 50:1.
 */
export async function prepareLogoFile(path: string, slot: LogoSlot, outDir: string): Promise<PreparedLogo> {
  if (!LOGO_SLOTS.includes(slot)) throw new Error(`Unknown logo slot: ${String(slot)}`)
  const field = `logos.${slot}`
  const problems: KitProblem[] = []
  const sharp = await loadSharp()

  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    refuse(field, 'This file could not be found. Check the path to your logo.')
  }
  if (size === 0) refuse(field, 'This file is empty. Please choose your logo file again.')
  if (size > UPLOAD_LIMITS.logoMaxBytes) {
    refuse(field, `This file is ${mb(size)}; logos can be up to ${mb(UPLOAD_LIMITS.logoMaxBytes)}. Export a smaller PNG or an SVG.`)
  }
  const bytes = new Uint8Array(await readFile(path))
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
  const declared = EXT_TYPES[extname(path).toLowerCase()]
  if (declared !== undefined && declared !== type) {
    refuse(
      field,
      `This file is named as ${TYPE_WORDS[declared] ?? declared} file but its contents are ${TYPE_WORDS[type] ?? type} image. Export it again from your design program, or rename it to match.`,
    )
  }

  const shape: LogoShape = slot === 'mark' ? 'mark' : 'wide'
  let pixels: Uint8Array
  let width: number
  let height: number
  let rasterScale: number | null

  if (type === 'image/svg+xml') {
    const reasons = svgDenyScan(new TextDecoder('utf-8').decode(bytes))
    if (reasons.length > 0) refuse(field, `This SVG cannot be used as it is: ${reasons.join(' ')} Export a plain SVG, or upload a PNG.`)
    let meta: { width?: number; height?: number }
    try {
      meta = await sharp(bytes).metadata()
    } catch {
      refuse(field, 'We could not read this SVG. Export it again, or upload a PNG.')
    }
    if (!meta.width || !meta.height) {
      refuse(field, 'This SVG has no size (no width and height, and no viewBox). Export it again with a viewBox, or upload a PNG.')
    }
    const a = svgAnalysisSize(meta.width, meta.height)
    const density = Math.min(20000, Math.max(1, (72 * a.width) / meta.width))
    const out = await sharp(bytes, { density })
      .resize(a.width, a.height, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    pixels = new Uint8Array(out.data)
    width = out.info.width
    height = out.info.height
    rasterScale = null
  } else {
    const header = readImageSize(bytes)
    if (header !== null && header.width * header.height > MAX_DECODE_PIXELS) {
      refuse(field, `This image is ${header.width} × ${header.height} pixels, too large to process. Export it at 4096 pixels or less on its longer side.`)
    }
    try {
      const meta = await sharp(bytes, { limitInputPixels: MAX_DECODE_PIXELS }).metadata()
      const turned = (meta.orientation ?? 1) >= 5
      const w = turned ? meta.height : meta.width
      const h = turned ? meta.width : meta.height
      if (!w || !h) throw new Error('no size')
      const a = rasterAnalysisSize(w, h)
      let pipeline = sharp(bytes, { limitInputPixels: MAX_DECODE_PIXELS }).rotate()
      if (a.scale < 1) pipeline = pipeline.resize(a.width, a.height, { fit: 'fill' })
      const out = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      pixels = new Uint8Array(out.data)
      width = out.info.width
      height = out.info.height
      rasterScale = a.scale
    } catch {
      refuse(field, 'This image could not be opened; the file may be damaged. Export it again as PNG.')
    }
  }

  const analysis = analysePixels(pixels, width, height)
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

  const palette = extractPalette(pixels, width, height)

  const renditions: PreparedRendition[] = []
  const names: readonly RenditionName[] = shape === 'mark' ? MARK_RENDITIONS : WIDE_RENDITIONS
  for (const name of names) {
    const layout = renditionLayout(name, aspect, shape)
    if (layout.width > MAX_CANVAS_SIDE) {
      problems.push({ field, severity: 'warning', message: `This logo is too wide to make its ${name} size, so that size was skipped.` })
      continue
    }
    const c = layout.content
    const png = await sharp(pixels, { raw: { width, height, channels: 4 } })
      .extract({ left: trim.x, top: trim.y, width: trim.width, height: trim.height })
      .resize(c.width, c.height, { fit: 'fill', kernel: 'lanczos3' })
      .extend({
        left: c.x,
        top: c.y,
        right: layout.width - c.x - c.width,
        bottom: layout.height - c.y - c.height,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toBuffer()
    if (png.length > UPLOAD_LIMITS.renditionMaxBytes) {
      problems.push({ field, severity: 'warning', message: `This logo's ${name} size came out over ${mb(UPLOAD_LIMITS.renditionMaxBytes)}, so it was skipped.` })
      continue
    }
    const hash = sha256(png)
    renditions.push({ name, blob: new Blob([png], { type: 'image/png' }), width: layout.width, height: layout.height, sha256: hash })
    await mkdir(outDir, { recursive: true })
    await writeFile(join(outDir, `${hash}.png`), png)
  }
  if (renditions.length === 0) refuse(field, 'We could not make any usable images from this logo. Try a PNG.')

  return {
    slot,
    original: {
      blob: new Blob([bytes], { type }),
      type,
      // eslint-disable-next-line no-control-regex
      name: basename(path).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || `logo.${EXTENSIONS[type]}`,
      sha256: sha256(bytes),
      ext: EXTENSIONS[type],
    },
    renditions,
    tone,
    aspect,
    palette,
    problems,
  }
}
