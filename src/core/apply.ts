/**
 * Painting a theme: CSS custom properties for web pages, and table-based HTML for email.
 *
 * Every value written here is re-checked at the point of writing, even though `deriveTheme` already made
 * it safe: colours must be strict `#rrggbb`, fonts must be one of the curated stacks, image addresses
 * must be plain https PNG addresses, and all text is HTML-escaped. A theme object built by hand, or
 * altered after `deriveTheme`, still cannot break out of a stylesheet or an email.
 */
import { isStrictHex } from './color.js'
import { isCuratedStack } from './fonts.js'
import type { BrandTheme } from './kit.js'
import { isValidWebsite } from './validate.js'

/** Every CSS variable a theme may set, in a fixed order. */
export const THEME_CSS_VARS = [
  '--brand-accent',
  '--brand-accent-ink',
  '--brand-accent-hover',
  '--brand-accent-soft',
  '--brand-secondary',
  '--brand-secondary-ink',
  '--brand-font-heading',
] as const
export type ThemeCssVar = (typeof THEME_CSS_VARS)[number]

/** Escape text for HTML element content and quoted attribute values. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
}

/**
 * The theme's CSS variables. Secondary colours and the heading font are omitted when the theme has none;
 * any value that is not a strict hex colour or a curated font stack is omitted too.
 */
export function themeCssVars(theme: BrandTheme): Record<string, string> {
  const out: Record<string, string> = {}
  const c = theme.colors
  const put = (k: ThemeCssVar, v: unknown) => {
    if (isStrictHex(v)) out[k] = v
  }
  put('--brand-accent', c.accent)
  put('--brand-accent-ink', c.accentInk)
  put('--brand-accent-hover', c.accentHover)
  put('--brand-accent-soft', c.accentSoft)
  if (c.secondary !== null) put('--brand-secondary', c.secondary)
  if (c.secondaryInk !== null) put('--brand-secondary-ink', c.secondaryInk)
  if (theme.headingFont !== null && isCuratedStack(theme.headingFont)) out['--brand-font-heading'] = theme.headingFont
  return out
}

// One compound selector: an optional element name, then any number of `:root`, `.class`, `#id` and
// `[data-x]` / `[data-x="y"]` parts. Element names may only lead, so no two parts can match the same
// characters (no catastrophic backtracking).
const COMPOUND =
  /^(?:[a-zA-Z][a-zA-Z0-9-]*)?(?::root|[.#][a-zA-Z_][a-zA-Z0-9_-]*|\[data-[a-z0-9-]+(?:="[A-Za-z0-9_-]*")?\])*$/

/** True for a selector made of simple parts separated by single spaces (descendant), at most 200 long. */
export function isSafeSelector(selector: unknown): selector is string {
  if (typeof selector !== 'string' || selector.length === 0 || selector.length > 200) return false
  return selector.split(' ').every((part) => part.length > 0 && COMPOUND.test(part))
}

/**
 * A complete CSS rule setting the theme's variables, e.g. `:root{--brand-accent:#1a73e8;...}`, safe to put
 * inside a `<style>` element. Throws if `selector` is not a simple selector (that is a programming
 * error: selectors come from product code, never from a customer).
 */
export function themeCssText(theme: BrandTheme, selector = ':root'): string {
  if (!isSafeSelector(selector)) {
    throw new Error('themeCssText: selector must be simple parts such as :root, .class, #id or [data-x="y"]')
  }
  const vars = themeCssVars(theme)
  const body = THEME_CSS_VARS.filter((k) => k in vars)
    .map((k) => `${k}:${vars[k]};`)
    .join('')
  return `${selector}{${body}}`
}

/** The structural slice of a DOM element this needs, so core never depends on the DOM. */
export interface StyleTarget {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void }
}

/** Set the theme's variables on an element, and remove any brand variable the theme does not set. */
export function applyThemeToElement(theme: BrandTheme, el: StyleTarget): void {
  const vars = themeCssVars(theme)
  for (const k of THEME_CSS_VARS) {
    const v = vars[k]
    if (v !== undefined) el.style.setProperty(k, v)
    else el.style.removeProperty(k)
  }
}

// ---------------------------------------------------------------------------------------------------------
// Email. Table layout, inline styles and `bgcolor` attributes only: no CSS variables, no <style>, no SVG,
// no data: URIs, and system fonts (most email clients ignore web fonts).
// ---------------------------------------------------------------------------------------------------------

const EMAIL_FONT = 'Helvetica,Arial,sans-serif'
const CHIP_BG = '#ffffff'

/** A plain https address of a PNG: no credentials, query, fragment, quotes, spaces or `..`. */
const SAFE_IMAGE_URL = /^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?\/[A-Za-z0-9._~/-]+\.png$/
/** A plain https address for a link: no credentials, query, fragment, quotes or spaces. */
const SAFE_LINK_URL = /^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~/-]*)?$/i

export function isSafeImageUrl(url: unknown): url is string {
  return typeof url === 'string' && SAFE_IMAGE_URL.test(url) && !url.includes('..') && !url.includes('//', 8)
}

function isSafeLinkUrl(url: unknown): url is string {
  return typeof url === 'string' && SAFE_LINK_URL.test(url) && !url.includes('..')
}

function hex(v: unknown, fallback: string): string {
  return isStrictHex(v) ? v : fallback
}

function dims(n: unknown, max: number): number | null {
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= max ? n : null
}

interface EmailPalette {
  bg: string
  text: string
  muted: string
  accent: string
}

function emailPalette(theme: BrandTheme): EmailPalette {
  const dark = theme.ground === 'dark'
  return {
    bg: dark ? '#111111' : '#ffffff',
    text: dark ? '#ffffff' : '#111111',
    muted: dark ? '#b3b3b3' : '#5f6368',
    accent: hex(theme.colors.accent, dark ? '#8ab4f8' : '#1a73e8'),
  }
}

const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"'

/**
 * The top of a branded email. The logo sits in a cell with its own explicit background (attribute and
 * inline style), so the colour inversion some mail apps apply in dark mode cannot make it vanish. When the
 * theme asks for a chip, the cell is a light rounded panel. With no usable logo, the name is drawn as text.
 */
export function emailHeaderHtml(theme: BrandTheme): string {
  const p = emailPalette(theme)
  const name = escapeHtml(theme.name)
  const logo = theme.logo
  const width = logo ? dims(logo.width, 600) : null
  const height = logo ? dims(logo.height, 600) : null
  let mark: string
  if (logo && width !== null && height !== null && isSafeImageUrl(logo.url)) {
    const cellBg = logo.chip ? CHIP_BG : p.bg
    const chipStyle = logo.chip ? 'padding:8px 12px;border-radius:8px;' : 'padding:0;'
    mark =
      `<td align="center" bgcolor="${cellBg}" style="background-color:${cellBg};${chipStyle}">` +
      `<img src="${escapeHtml(logo.url)}" width="${width}" height="${height}" alt="${name}" style="display:block;border:0">` +
      `</td>`
  } else {
    mark =
      `<td align="center" bgcolor="${p.bg}" style="background-color:${p.bg};font-family:${EMAIL_FONT};` +
      `font-size:24px;line-height:30px;font-weight:bold;color:${p.text};">${name}</td>`
  }
  const tagline =
    theme.tagline !== null && theme.tagline !== ''
      ? `<tr><td align="center" bgcolor="${p.bg}" style="background-color:${p.bg};padding:8px 0 0 0;font-family:${EMAIL_FONT};` +
        `font-size:14px;line-height:20px;color:${p.muted};">${escapeHtml(theme.tagline)}</td></tr>`
      : ''
  return (
    `<table ${TABLE} width="100%" bgcolor="${p.bg}" style="background-color:${p.bg};border-collapse:collapse;">` +
    `<tr><td align="center" bgcolor="${p.bg}" style="background-color:${p.bg};padding:24px 16px;">` +
    `<table ${TABLE} align="center" style="border-collapse:collapse;">` +
    `<tr>${mark}</tr>${tagline}</table>` +
    `</td></tr>` +
    `<tr><td height="4" bgcolor="${p.accent}" style="background-color:${p.accent};height:4px;line-height:4px;font-size:4px;">&nbsp;</td></tr>` +
    `</table>`
  )
}

/**
 * The bottom of a branded email: the business name, its website (as text, and only if it is a valid
 * address), and the "Powered by" line in
 * the product's own neutral grey, linked only when the product gave a plain https address.
 */
export function emailFooterHtml(theme: BrandTheme): string {
  const p = emailPalette(theme)
  const cell = (inner: string, size: number, pad: string) =>
    `<tr><td align="center" bgcolor="${p.bg}" style="background-color:${p.bg};padding:${pad};font-family:${EMAIL_FONT};` +
    `font-size:${size}px;line-height:${size + 6}px;color:${p.muted};">${inner}</td></tr>`
  let rows = cell(escapeHtml(theme.name), 12, '16px 16px 0 16px')
  if (isValidWebsite(theme.website)) rows += cell(escapeHtml(theme.website), 12, '4px 16px 0 16px')
  if (theme.poweredBy) {
    const label = escapeHtml(theme.poweredBy.label)
    const href = theme.poweredBy.href
    const inner = isSafeLinkUrl(href)
      ? `<a href="${escapeHtml(href)}" style="color:${p.muted};text-decoration:underline;">${label}</a>`
      : label
    rows += cell(inner, 11, '12px 16px 16px 16px')
  } else {
    rows += cell('&nbsp;', 11, '0 16px 16px 16px')
  }
  return `<table ${TABLE} width="100%" bgcolor="${p.bg}" style="background-color:${p.bg};border-collapse:collapse;">${rows}</table>`
}

/** The logo for a PDF (jsPDF cannot draw SVG; this is always a PNG), with its width-to-height ratio. */
export function pdfLogo(theme: BrandTheme): { url: string; width: number; height: number; ratio: number } | null {
  const logo = theme.logo
  if (!logo || !isSafeImageUrl(logo.url)) return null
  const width = dims(logo.width, 100000)
  const height = dims(logo.height, 100000)
  if (width === null || height === null) return null
  return { url: logo.url, width, height, ratio: width / height }
}
