/**
 * Turning a kit into a theme for one surface: which logo, at what size, on what panel, in which colours.
 * A theme is plain data; `apply.ts` paints it.
 */
import { deriveColors, statusColourWarning } from './color.js'
import { fontById } from './fonts.js'
import type {
  ApplyOptions,
  BrandKit,
  BrandTheme,
  KitProblem,
  LogoAsset,
  LogoChoice,
  LogoSlot,
  ProductIdentity,
  RenditionName,
  Surface,
} from './kit.js'

/** Surfaces drawn on a dark ground. Everything else is light (email is designed light; see apply.ts). */
export const DARK_SURFACES: readonly Surface[] = ['web-dark', 'tv']
/** Surfaces that are web pages, where a heading web font can be loaded. */
export const WEB_SURFACES: readonly Surface[] = ['web-light', 'web-dark', 'tv']

export function groundFor(surface: Surface): 'light' | 'dark' {
  return DARK_SURFACES.includes(surface) ? 'dark' : 'light'
}

/**
 * The rendition each surface wants, first choice first. The first entry is the contract's choice; the
 * rest are fallbacks for a slot that lacks it (a square mark has no `print` rendition, for example).
 */
export const SURFACE_RENDITIONS: Readonly<Record<Surface, readonly RenditionName[]>> = {
  'web-light': ['web2x', 'web', 'email'],
  'web-dark': ['web2x', 'web', 'email'],
  tv: ['web2x', 'web', 'email'],
  email: ['email', 'web2x', 'web'],
  pdf: ['pdf', 'print', 'icon512'],
  print: ['print', 'icon512', 'pdf'],
}

/** Display height in CSS pixels, and the widest a very wide logo may be drawn. Null: true pixel size. */
const DISPLAY: Readonly<Record<Surface, { height: number; maxWidth: number } | null>> = {
  'web-light': { height: 48, maxWidth: 320 },
  'web-dark': { height: 48, maxWidth: 320 },
  tv: { height: 48, maxWidth: 320 },
  email: { height: 60, maxWidth: 300 },
  pdf: null,
  print: null,
}

/** A logo this dark (mean luminance of its visible pixels) needs a light panel on a dark ground. */
export const CHIP_LUMINANCE = 0.4

function needsChip(asset: LogoAsset): boolean {
  return asset.tone.transparent && asset.tone.luminance < CHIP_LUMINANCE
}

function pick(asset: LogoAsset | undefined, surface: Surface) {
  if (!asset) return null
  for (const name of SURFACE_RENDITIONS[surface]) {
    const r = asset.renditions[name]
    if (r && r.width > 0 && r.height > 0) return { name, r }
  }
  return null
}

/**
 * The logo a surface should draw, or null to draw the business name as text.
 *
 * - Dark surfaces (`web-dark`, `tv`) prefer `logoOnDark`; then `logo`, then `mark`, each on a light
 *   "chip" panel when it is transparent and dark (it would vanish on the dark ground otherwise).
 * - Light surfaces use `logo`, then `mark`. `logoOnDark` is never used on a light ground: it is usually
 *   white and would vanish.
 * - Size: 48 px high on web and TV, 60 px in email (both capped in width for very wide logos), and the
 *   rendition's true pixel size on PDF and print.
 */
export function chooseLogo(kit: BrandKit, surface: Surface): LogoChoice | null {
  const dark = groundFor(surface) === 'dark'
  const order: { slot: LogoSlot; chipIfDark: boolean }[] = dark
    ? [
        { slot: 'logoOnDark', chipIfDark: false },
        { slot: 'logo', chipIfDark: true },
        { slot: 'mark', chipIfDark: true },
      ]
    : [
        { slot: 'logo', chipIfDark: false },
        { slot: 'mark', chipIfDark: false },
      ]
  for (const { slot, chipIfDark } of order) {
    const asset = kit.logos[slot]
    const found = pick(asset, surface)
    if (!asset || !found) continue
    const { r, name } = found
    const display = DISPLAY[surface]
    let width = r.width
    let height = r.height
    if (display) {
      const ratio = r.width / r.height
      height = display.height
      width = Math.max(1, Math.round(height * ratio))
      if (width > display.maxWidth) {
        width = display.maxWidth
        height = Math.max(1, Math.round(width / ratio))
      }
    }
    return { slot, rendition: name, url: r.url, width, height, chip: dark && chipIfDark && needsChip(asset) }
  }
  return null
}

/**
 * Everything a surface needs to show the kit. Problems are the colour repairs for this surface, a warning
 * when a brand colour could be mistaken for a status colour, and a warning when a dark logo is put on a
 * light panel because there is no version made for dark backgrounds.
 */
export function deriveTheme(kit: BrandKit, identity: ProductIdentity, options: ApplyOptions): BrandTheme {
  const surface = options.surface
  const ground = groundFor(surface)
  const derived = deriveColors(kit.colors, identity.fallbackAccent, ground)
  const problems: KitProblem[] = [...derived.problems]
  if (kit.colors.primary !== undefined) {
    const w = statusColourWarning(kit.colors.primary, 'colors.primary')
    if (w) problems.push(w)
  }
  if (kit.colors.secondary !== undefined) {
    const w = statusColourWarning(kit.colors.secondary, 'colors.secondary')
    if (w) problems.push(w)
  }
  const logo = chooseLogo(kit, surface)
  if (logo?.chip) {
    problems.push({
      field: 'logos.logoOnDark',
      severity: 'warning',
      message:
        'Your logo is dark, so on dark screens it is shown on a light panel to keep it visible. Upload a version made for dark backgrounds to show it without the panel.',
    })
  }
  const font = WEB_SURFACES.includes(surface) && kit.fonts.heading !== undefined ? fontById(kit.fonts.heading) : undefined
  const showPoweredBy = options.showPoweredBy ?? true
  return {
    surface,
    ground,
    name: kit.name ?? options.fallbackName,
    tagline: kit.tagline ?? null,
    website: kit.website ?? null,
    logo,
    colors: derived.colors,
    headingFont: font ? font.stack : null,
    headingFontCss: font ? font.cssUrl : null,
    poweredBy: showPoweredBy ? { label: identity.poweredByLabel, href: identity.poweredByHref ?? null } : null,
    problems,
  }
}
