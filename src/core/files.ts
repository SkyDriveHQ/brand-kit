/**
 * Bytes in, facts out. No DOM, no decoders: everything here reads raw bytes, so it runs the same in the
 * browser, in Node and in a Deno edge function (where the server re-checks what the browser sent).
 */
import { UPLOAD_LIMITS, type KitProblem } from './kit.js'

export type SniffedType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml' | 'application/pdf'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false
  return magic.every((b, i) => bytes[offset + i] === b)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let s = ''
  for (let i = offset; i < offset + length && i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0)
  return s
}

/** Bytes as Latin-1 text: one character per byte. Good enough to find ASCII markup in UTF-8. */
function latin1(bytes: Uint8Array, limit: number): string {
  const end = Math.min(bytes.length, limit)
  let s = ''
  for (let i = 0; i < end; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(end, i + 8192)))
  }
  return s
}

function u16be(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0)
}
function u16le(b: Uint8Array, o: number): number {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8)
}
function u24le(b: Uint8Array, o: number): number {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16)
}
function u32be(b: Uint8Array, o: number): number {
  return (((b[o] ?? 0) << 24) >>> 0) + (((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0))
}

/** How far into a file to look for the opening `<svg` element. */
const SVG_SNIFF_LIMIT = 64 * 1024

/**
 * True when the text's first element is `<svg`, after an optional byte-order mark, XML declaration,
 * processing instructions, comments, whitespace and a DOCTYPE (design tools write one; the deny scan
 * refuses it later, after the sanitiser has had the chance to remove it).
 */
function looksLikeSvg(text: string): boolean {
  let i = 0
  if (text.startsWith('\xef\xbb\xbf')) i = 3
  else if (text.startsWith('﻿')) i = 1
  for (;;) {
    while (i < text.length && /\s/.test(text[i] ?? '')) i++
    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2)
      if (end < 0) return false
      i = end + 2
    } else if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4)
      if (end < 0) return false
      i = end + 3
    } else if (text.slice(i, i + 9).toUpperCase() === '<!DOCTYPE') {
      const bracket = text.indexOf('[', i)
      const close = text.indexOf('>', i)
      if (close < 0) return false
      if (bracket >= 0 && bracket < close) {
        const subsetEnd = text.indexOf(']', bracket)
        if (subsetEnd < 0) return false
        const after = text.indexOf('>', subsetEnd)
        if (after < 0) return false
        i = after + 1
      } else {
        i = close + 1
      }
    } else {
      break
    }
  }
  return /^<svg[\s>/]/i.test(text.slice(i, i + 5))
}

/** The file's type, decided by its first bytes and never by its name or the browser's guess. */
export function sniffType(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, PNG_MAGIC)) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf'
  if (looksLikeSvg(latin1(bytes, SVG_SNIFF_LIMIT))) return 'image/svg+xml'
  return null
}

function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (!startsWith(b, PNG_MAGIC) || b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null
  return { width: u32be(b, 16), height: u32be(b, 20) }
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (!startsWith(b, [0xff, 0xd8])) return null
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) return null
    // Skip fill bytes.
    while (i < b.length && b[i] === 0xff) i++
    const marker = b[i]
    i++
    if (marker === undefined) return null
    // Markers with no length: TEM, RST0-7, SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (marker === 0xd9 || marker === 0xda) return null // end of image, or start of scan: no size found
    if (i + 2 > b.length) return null
    const len = u16be(b, i)
    if (len < 2) return null
    // Start-of-frame markers carry the size; C4 (Huffman), C8 (reserved) and CC (arithmetic) do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 > b.length) return null
      return { height: u16be(b, i + 3), width: u16be(b, i + 5) }
    }
    i += len
  }
  return null
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP' || b.length < 16) return null
  const chunk = ascii(b, 12, 4)
  if (chunk === 'VP8 ') {
    if (b.length < 30) return null
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    if (b.length < 25) return null
    if (b[20] !== 0x2f) return null
    const b0 = b[21] ?? 0
    const b1 = b[22] ?? 0
    const b2 = b[23] ?? 0
    const b3 = b[24] ?? 0
    return { width: 1 + (b0 | ((b1 & 0x3f) << 8)), height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) }
  }
  if (chunk === 'VP8X') {
    if (b.length < 30) return null
    return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) }
  }
  return null
}

/** Pixel size read from the file header: PNG (IHDR), JPEG (start-of-frame) and WebP (VP8, VP8L, VP8X). */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const size = pngSize(bytes) ?? jpegSize(bytes) ?? webpSize(bytes)
  if (size === null || size.width <= 0 || size.height <= 0) return null
  return size
}

/**
 * Defence in depth for SVG, run AFTER DOMPurify has cleaned it. Returns a plain-English reason for each
 * dangerous thing still present; an empty list means nothing was found. Deliberately over-cautious: a
 * false alarm refuses a logo (the customer can upload a PNG); a miss could run script.
 */
export function svgDenyScan(text: string): string[] {
  const reasons = new Set<string>()
  const t = String(text)
  if (/<script/i.test(t)) reasons.add('It contains a script.')
  // Event handlers (onload=, onclick=...) inside any tag, including after a slash: <svg/onload=...>.
  // Tags are cut at the next `<` so the scan stays linear on hostile input (no catastrophic backtracking).
  const tags = t.match(/<[^<>]*/g) ?? []
  if (tags.some((tag) => /[\s/"']on[a-z]+\s*=/i.test(tag))) reasons.add('It contains an event handler that could run code.')
  if (/<foreignObject/i.test(t)) reasons.add('It contains embedded web content (foreignObject).')
  if (/<iframe/i.test(t)) reasons.add('It contains an embedded page (iframe).')
  if (/<embed/i.test(t)) reasons.add('It contains embedded content (embed).')
  if (/<object/i.test(t)) reasons.add('It contains embedded content (object).')
  const href = /[\s/"'](?:[a-z0-9_-]+:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi
  for (let m = href.exec(t); m !== null; m = href.exec(t)) {
    const value = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (!value.startsWith('#')) {
      reasons.add('It links to something outside the file.')
      break
    }
  }
  // Animation elements can rewrite a link at run time (<set attributeName="href" to="javascript:...">).
  if (/attributeName\s*=\s*["']?\s*(?:[a-z0-9_-]+:)?href/i.test(t)) reasons.add('It changes a link while it plays.')
  if (/javascript\s*:/i.test(t)) reasons.add('It contains a javascript: address.')
  if (/@import/i.test(t)) reasons.add('It loads a style sheet from outside the file.')
  const url = /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))/gi
  for (let m = url.exec(t); m !== null; m = url.exec(t)) {
    const value = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (!value.startsWith('#')) {
      reasons.add('It loads something from outside the file.')
      break
    }
  }
  if (/<!ENTITY/i.test(t)) reasons.add('It defines XML entities, which can be used to attack the reader.')
  if (/<!DOCTYPE/i.test(t)) reasons.add('It contains a DOCTYPE, which can be used to attack the reader.')
  return [...reasons]
}

/**
 * The server-side check of an uploaded rendition: it really is a whole PNG, within the size limit, and
 * (when given) exactly the expected dimensions. `field` names the rendition in the problems.
 */
export function checkPng(
  bytes: Uint8Array,
  expected?: { width: number; height: number; maxBytes: number },
  field = 'file',
): KitProblem[] {
  const problems: KitProblem[] = []
  const refuse = (message: string) => problems.push({ field, severity: 'refused', message })
  const maxBytes = expected?.maxBytes ?? UPLOAD_LIMITS.renditionMaxBytes
  if (!startsWith(bytes, PNG_MAGIC)) {
    refuse('This file is not a PNG image.')
    return problems
  }
  if (bytes.length > maxBytes) {
    refuse(`This image is ${formatBytes(bytes.length)}, larger than the ${formatBytes(maxBytes)} allowed.`)
  }
  const size = pngSize(bytes)
  if (size === null || size.width === 0 || size.height === 0) {
    refuse('This PNG image is damaged: its size cannot be read.')
    return problems
  }
  // A whole PNG ends with an IEND chunk; anything after it, or a missing end, means a damaged or
  // disguised file.
  if (bytes.length < 45 || ascii(bytes, bytes.length - 8, 4) !== 'IEND') {
    refuse('This PNG image is damaged or incomplete.')
  }
  if (expected && (size.width !== expected.width || size.height !== expected.height)) {
    refuse(
      `This image is ${size.width} × ${size.height} pixels, but ${expected.width} × ${expected.height} was expected.`,
    )
  }
  return problems
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} bytes`
}
