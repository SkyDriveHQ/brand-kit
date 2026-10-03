/**
 * The one gate every brand kit passes through, in the browser and again on the server (an attacker can
 * skip the browser). It repairs what it safely can, refuses the rest, and says what it did in plain
 * English for the business owner.
 *
 * Nothing from the input is copied wholesale: the output kit is built field by field from known keys,
 * so unknown keys (and anything hidden in them) never survive.
 */
import { parseHex } from './color.js'
import { fontById } from './fonts.js'
import {
  BRAND_KIT_SCHEMA_VERSION,
  LOGO_SLOTS,
  LOGO_SOURCE_TYPES,
  PALETTE_KEEP,
  TEXT_LIMITS,
  UPLOAD_LIMITS,
  emptyKit,
  type BrandGuideRef,
  type BrandKit,
  type BrandStorageRules,
  type KitProblem,
  type LogoAsset,
  type LogoSlot,
  type LogoSourceType,
  type ParseResult,
  type Rendition,
  type RenditionName,
} from './kit.js'
import { isOwnPrivatePath, isOwnPublicAssetUrl, isSha256Hex, rulesAreValid } from './paths.js'


/** Thrown by `assertKit` (and by the browser helpers) when something was refused. */
export class KitError extends Error {
  readonly problems: KitProblem[]
  constructor(problems: KitProblem[], message?: string) {
    super(message ?? problems.find((p) => p.severity === 'refused')?.message ?? 'The brand kit was refused.')
    this.name = 'KitError'
    this.problems = problems
  }
}

export type ParseMode = 'strict' | 'lenient'

const RENDITION_NAMES: readonly RenditionName[] = ['web', 'web2x', 'email', 'pdf', 'print', 'icon32', 'icon192', 'icon512']
/** Longest display name kept for an uploaded file. */
const FILE_NAME_LIMIT = 255
/** Largest pixel size accepted for a rendition's width or height. */
const MAX_RENDITION_PX = 16384

const SLOT_WORDS: Record<LogoSlot, string> = {
  logo: 'Your logo',
  logoOnDark: 'Your logo for dark backgrounds',
  mark: 'Your square icon',
}

interface Ctx {
  rules: BrandStorageRules
  strict: boolean
  problems: KitProblem[]
}

function refuse(ctx: Ctx, field: string, message: string): void {
  if (ctx.strict) ctx.problems.push({ field, severity: 'refused', message })
}

function repair(ctx: Ctx, field: string, message: string): void {
  if (ctx.strict) ctx.problems.push({ field, severity: 'repaired', message })
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** An own property only: never something inherited from a prototype. */
function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined
}

/**
 * A short, quoted echo of what the customer typed, for messages. Only plain characters are echoed, so a
 * message is safe wherever a product shows it (a toast, an email, a log); anything else becomes "what
 * you entered".
 */
function echo(v: unknown): string {
  if (typeof v === 'string' && /^[A-Za-z0-9# .,:/_-]{1,24}$/.test(v)) return `"${v}"`
  return 'What you entered'
}

// Control characters, zero-width characters and bidirectional overrides (which can make text display in
// a misleading order) are removed; runs of whitespace become one space.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g

/** Trimmed, invisible characters removed, whitespace collapsed. */
export function cleanText(s: string): string {
  return s.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim()
}

function parseText(
  ctx: Ctx,
  value: unknown,
  field: 'name' | 'tagline',
  label: string,
): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    refuse(ctx, field, `${label} must be text.`)
    return undefined
  }
  const text = cleanText(value)
  if (text === '') return undefined
  const limit = TEXT_LIMITS[field]
  if (text.length > limit) {
    if (!ctx.strict) return text.slice(0, limit).trim()
    refuse(ctx, field, `${label} is ${text.length} characters long. The most that fits is ${limit}, so please shorten it.`)
    return undefined
  }
  return text
}

const HOST = String.raw`(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}`
const PATH = String.raw`(?:[/?#][A-Za-z0-9\-._~!$&*+,;=:@%/?#]*)?`
const WEBSITE_URL = new RegExp(String.raw`^https?://${HOST}(?::[0-9]{1,5})?${PATH}$`, 'i')
const WEBSITE_BARE = new RegExp(String.raw`^${HOST}(?::[0-9]{1,5})?${PATH}$`, 'i')

/** True for a bare host (`example.com`, `example.com/path`) or an http(s) address. Nothing else. */
export function isValidWebsite(s: unknown): s is string {
  if (typeof s !== 'string' || s.length === 0 || s.length > TEXT_LIMITS.website) return false
  return WEBSITE_URL.test(s) || (!/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s) && WEBSITE_BARE.test(s))
}

function parseWebsite(ctx: Ctx, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    refuse(ctx, 'website', 'Your website address must be text.')
    return undefined
  }
  const text = value.replace(INVISIBLE, '').trim()
  if (text === '') return undefined
  if (text.length > TEXT_LIMITS.website) {
    refuse(ctx, 'website', `Your website address is longer than ${TEXT_LIMITS.website} characters, so it was not saved.`)
    return undefined
  }
  if (!isValidWebsite(text)) {
    refuse(
      ctx,
      'website',
      `${echo(text)} is not a website address we can show. Please enter it like example.com or https://example.com.`,
    )
    return undefined
  }
  return text
}

function parseColor(ctx: Ctx, value: unknown, field: 'colors.primary' | 'colors.secondary'): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const label = field === 'colors.primary' ? 'Your brand colour' : 'Your second brand colour'
  const hex = typeof value === 'string' ? parseHex(value) : null
  if (hex === null) {
    refuse(
      ctx,
      field,
      `${echo(value)} is not a colour code we can use. Please enter it as a six-digit code such as #1a73e8.`,
    )
    return undefined
  }
  if (hex !== value) {
    repair(ctx, field, `${label} was written as ${echo(value)}. It is saved as ${hex}, which is the same colour.`)
  }
  return hex
}

function isPositiveInt(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= max
}

function parseRendition(ctx: Ctx, value: unknown, field: string, slotLabel: string): Rendition | null {
  const damaged = () => refuse(ctx, field, `${slotLabel} has a damaged image record, so that image was not used.`)
  if (!isRecord(value)) {
    damaged()
    return null
  }
  const url = own(value, 'url')
  const sha256 = own(value, 'sha256')
  const width = own(value, 'width')
  const height = own(value, 'height')
  const bytes = own(value, 'bytes')
  if (!isOwnPublicAssetUrl(url, ctx.rules)) {
    refuse(
      ctx,
      `${field}.url`,
      `${slotLabel} points at an image that is not stored with your business's brand files, so it was not used.`,
    )
    return null
  }
  if (!isSha256Hex(sha256) || !(url as string).endsWith(`/${sha256}.png`)) {
    refuse(ctx, `${field}.sha256`, `${slotLabel} has an image whose fingerprint does not match its file, so it was not used.`)
    return null
  }
  if (
    !isPositiveInt(width, MAX_RENDITION_PX) ||
    !isPositiveInt(height, MAX_RENDITION_PX) ||
    !isPositiveInt(bytes, UPLOAD_LIMITS.renditionMaxBytes)
  ) {
    damaged()
    return null
  }
  return { url: url as string, width, height, bytes, sha256 }
}

function parseLogo(ctx: Ctx, value: unknown, slot: LogoSlot): LogoAsset | null {
  const field = `logos.${slot}`
  const label = SLOT_WORDS[slot]
  if (!isRecord(value)) {
    refuse(ctx, field, `${label} could not be read, so it was not used.`)
    return null
  }
  const path = own(value, 'originalPath')
  if (!isOwnPrivatePath(path, ctx.rules)) {
    refuse(
      ctx,
      `${field}.originalPath`,
      `${label} is stored somewhere that does not belong to your business, so it was not used.`,
    )
    return null
  }
  const type = own(value, 'originalType')
  if (typeof type !== 'string' || !(LOGO_SOURCE_TYPES as readonly string[]).includes(type)) {
    refuse(ctx, `${field}.originalType`, `${label} is not a PNG, JPEG, WebP or SVG file, so it was not used.`)
    return null
  }
  const name = own(value, 'originalName')
  if (typeof name !== 'string') {
    refuse(ctx, `${field}.originalName`, `${label} has no file name, so it was not used.`)
    return null
  }
  const aspect = own(value, 'aspect')
  const tone = own(value, 'tone')
  const luminance = isRecord(tone) ? own(tone, 'luminance') : undefined
  const transparent = isRecord(tone) ? own(tone, 'transparent') : undefined
  if (
    typeof aspect !== 'number' ||
    !Number.isFinite(aspect) ||
    aspect < 0.01 ||
    aspect > 100 ||
    typeof luminance !== 'number' ||
    !Number.isFinite(luminance) ||
    luminance < 0 ||
    luminance > 1 ||
    typeof transparent !== 'boolean'
  ) {
    refuse(ctx, field, `${label} is missing the measurements taken when it was uploaded. Please upload it again.`)
    return null
  }
  const renditionsIn = own(value, 'renditions')
  const renditions: Partial<Record<RenditionName, Rendition>> = {}
  if (isRecord(renditionsIn)) {
    for (const r of RENDITION_NAMES) {
      const rv = own(renditionsIn, r)
      if (rv === undefined) continue
      const parsed = parseRendition(ctx, rv, `${field}.renditions.${r}`, label)
      if (parsed) renditions[r] = parsed
    }
  }
  if (Object.keys(renditions).length === 0) {
    refuse(ctx, `${field}.renditions`, `${label} has no usable images, so it was not used. Please upload it again.`)
    return null
  }
  const asset: LogoAsset = {
    originalPath: path as string,
    originalType: type as LogoSourceType,
    originalName: cleanText(name).slice(0, FILE_NAME_LIMIT),
    aspect,
    tone: { luminance, transparent },
    renditions,
  }
  // Suggestions only, so a bad entry is dropped quietly rather than refused.
  const paletteIn = own(value, 'palette')
  if (Array.isArray(paletteIn)) {
    const palette: { hex: string; share: number }[] = []
    for (const p of paletteIn) {
      if (!isRecord(p)) continue
      const hex = typeof own(p, 'hex') === 'string' ? parseHex(own(p, 'hex') as string) : null
      const share = own(p, 'share')
      if (hex === null || typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1) continue
      if (!palette.some((x) => x.hex === hex)) palette.push({ hex, share })
      if (palette.length === PALETTE_KEEP) break
    }
    if (palette.length > 0) asset.palette = palette
  }
  return asset
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/

function parseGuide(ctx: Ctx, value: unknown): BrandGuideRef | undefined {
  if (value === undefined || value === null) return undefined
  const fail = (field: string, message: string): undefined => {
    refuse(ctx, field, message)
    return undefined
  }
  if (!isRecord(value)) return fail('guide', 'Your brand guide record could not be read, so it was not kept.')
  const path = own(value, 'path')
  if (!isOwnPrivatePath(path, ctx.rules) || !(path as string).endsWith('.pdf')) {
    return fail('guide.path', 'Your brand guide is stored somewhere that does not belong to your business, so it was not kept.')
  }
  const name = own(value, 'name')
  if (typeof name !== 'string') return fail('guide.name', 'Your brand guide has no file name, so it was not kept.')
  const bytes = own(value, 'bytes')
  if (!isPositiveInt(bytes, UPLOAD_LIMITS.guideMaxBytes)) {
    return fail('guide.bytes', 'Your brand guide is empty or larger than the 25 MB allowed, so it was not kept.')
  }
  const uploadedAt = own(value, 'uploadedAt')
  if (typeof uploadedAt !== 'string' || !ISO_TIME.test(uploadedAt) || !Number.isFinite(Date.parse(uploadedAt))) {
    return fail('guide.uploadedAt', 'Your brand guide has no valid upload time, so it was not kept.')
  }
  return { path: path as string, name: cleanText(name).slice(0, FILE_NAME_LIMIT), bytes, uploadedAt }
}

/**
 * Validate and normalise a brand kit.
 *
 * - `strict` (for writes): every bad field is dropped and reported as `refused`; repairs (such as
 *   `#ABC` → `#aabbcc`) are reported as `repaired`.
 * - `lenient` (for reading stored rows): the same checks, but bad fields are dropped silently and
 *   `problems` is always empty, so one bad value never blanks a screen. Over-long text is shortened
 *   rather than dropped, and a kit from a newer schema version is read as far as it can be.
 *
 * Throws only when `rules` itself is malformed, which is a product bug, not customer data.
 */
export function parseKit(input: unknown, rules: BrandStorageRules, mode: ParseMode): ParseResult {
  if (!rulesAreValid(rules)) {
    throw new Error('parseKit: invalid BrandStorageRules (see paths.ts rulesAreValid)')
  }
  const ctx: Ctx = { rules, strict: mode === 'strict', problems: [] }
  const kit = emptyKit()
  if (!isRecord(input)) {
    refuse(ctx, 'kit', 'This brand kit could not be read.')
    return { kit, problems: ctx.problems }
  }

  const version = own(input, 'schemaVersion')
  if (version !== undefined && version !== BRAND_KIT_SCHEMA_VERSION) {
    refuse(
      ctx,
      'schemaVersion',
      'This brand kit was saved by a newer version of the product and cannot be changed here.',
    )
  }

  const name = parseText(ctx, own(input, 'name'), 'name', 'Your business name')
  if (name !== undefined) kit.name = name
  const tagline = parseText(ctx, own(input, 'tagline'), 'tagline', 'Your tagline')
  if (tagline !== undefined) kit.tagline = tagline
  const website = parseWebsite(ctx, own(input, 'website'))
  if (website !== undefined) kit.website = website

  const logos = own(input, 'logos')
  if (isRecord(logos)) {
    for (const slot of LOGO_SLOTS) {
      const v = own(logos, slot)
      if (v === undefined || v === null) continue
      const logo = parseLogo(ctx, v, slot)
      if (logo) kit.logos[slot] = logo
    }
  } else if (logos !== undefined && logos !== null) {
    refuse(ctx, 'logos', 'Your logos could not be read, so none were used.')
  }

  const colors = own(input, 'colors')
  if (isRecord(colors)) {
    const primary = parseColor(ctx, own(colors, 'primary'), 'colors.primary')
    if (primary !== undefined) kit.colors.primary = primary
    const secondary = parseColor(ctx, own(colors, 'secondary'), 'colors.secondary')
    if (secondary !== undefined) kit.colors.secondary = secondary
  } else if (colors !== undefined && colors !== null) {
    refuse(ctx, 'colors', 'Your brand colours could not be read, so none were used.')
  }

  const fonts = own(input, 'fonts')
  if (isRecord(fonts)) {
    const heading = own(fonts, 'heading')
    if (heading !== undefined && heading !== null && heading !== '') {
      if (fontById(heading)) kit.fonts.heading = heading as string
      else
        refuse(
          ctx,
          'fonts.heading',
          'That heading font is not one of the fonts on offer, so your headings use the standard font.',
        )
    }
  } else if (fonts !== undefined && fonts !== null) {
    refuse(ctx, 'fonts', 'Your font choice could not be read, so the standard font is used.')
  }

  const guide = parseGuide(ctx, own(input, 'guide'))
  if (guide !== undefined) kit.guide = guide

  return { kit, problems: ctx.problems }
}

/** Strict parse that throws `KitError` (carrying every problem) when anything was refused. */
export function assertKit(input: unknown, rules: BrandStorageRules): BrandKit {
  const { kit, problems } = parseKit(input, rules, 'strict')
  if (problems.some((p) => p.severity === 'refused')) throw new KitError(problems)
  return kit
}
