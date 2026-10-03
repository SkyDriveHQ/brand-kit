/**
 * The customer's brand kit, as data.
 *
 * A dropzone, rigging shop or video business arrives with its own brand: logos, colours, maybe a font and
 * a brand-guide PDF. It drops that kit into a SkyDrive product, which stores it (in the product's OWN
 * database and storage, never a shared service: Rule 13) and applies it to the screens, emails and
 * documents the business's customers see. We do not design anyone's brand.
 *
 * Two kinds of data, kept apart on purpose:
 *
 * - `BrandKit` is CUSTOMER data. It arrives from an upload form, is validated (`parseKit`), and can never
 *   change how the product itself works.
 * - `ProductIdentity` is PRODUCT configuration, written in code: the product's own name, its fallback
 *   colours, the "Powered by" label. A customer kit can never reach it. (The suite helper this replaces
 *   mixed the two: a customer record could set localStorage key prefixes.)
 *
 * Every field of a kit is optional. An empty kit is "unbranded", and every surface must look right with it:
 * the business's name as text, in the product's neutral theme.
 */

export const BRAND_KIT_SCHEMA_VERSION = 1 as const

/**
 * The three logo slots every comparator product converges on.
 *
 * - `logo`: the wide logo (wordmark or lockup) for LIGHT backgrounds. The main one.
 * - `logoOnDark`: the same, made for DARK backgrounds. Optional. Without it, a dark logo on a dark
 *   screen (a hangar TV) is drawn on a light "chip" (`LogoChoice.chip`).
 * - `mark`: the square icon. Optional. Without it, favicons and small spots fall back to text initials.
 */
export type LogoSlot = 'logo' | 'logoOnDark' | 'mark'
export const LOGO_SLOTS: readonly LogoSlot[] = ['logo', 'logoOnDark', 'mark']

/** What a customer may upload as a logo. SVG is accepted ONLY as a source: it is cleaned, turned into PNGs and never served. */
export type LogoSourceType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'
export const LOGO_SOURCE_TYPES: readonly LogoSourceType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

/**
 * The PNGs generated from a logo at upload time, each for a surface that cannot use the original.
 * Heights are for wide logos; a square mark uses the same number as its width and height.
 *
 * - `web` 96 px high, `web2x` 192 px high: web pages and the React preview.
 * - `email` 120 px high: shown at 60 px in email (2x for sharp screens). Emails cannot use SVG or data: URIs.
 * - `pdf` 240 px high: jsPDF cannot draw SVG.
 * - `print` 600 px high: QR waiver posters and anything printed.
 * - `icon32`, `icon192`, `icon512`: square marks only: favicon and home-screen icons.
 */
export type RenditionName = 'web' | 'web2x' | 'email' | 'pdf' | 'print' | 'icon32' | 'icon192' | 'icon512'

export const RENDITION_HEIGHTS: Readonly<Record<RenditionName, number>> = {
  web: 96,
  web2x: 192,
  email: 120,
  pdf: 240,
  print: 600,
  icon32: 32,
  icon192: 192,
  icon512: 512,
}

/** Renditions made for a wide logo, and for a square mark. */
export const WIDE_RENDITIONS: readonly RenditionName[] = ['web', 'web2x', 'email', 'pdf', 'print']
export const MARK_RENDITIONS: readonly RenditionName[] = ['web', 'web2x', 'email', 'pdf', 'icon32', 'icon192', 'icon512']

/** One generated PNG, publicly served at an address that never changes (see `paths.ts`). */
export interface Rendition {
  url: string
  width: number
  height: number
  bytes: number
  /** Lower-case hex SHA-256 of the PNG bytes; also its file name. */
  sha256: string
}

/** What was measured about a logo when it was uploaded (see `core/analyse.ts`). */
export interface LogoTone {
  /** Mean relative luminance (0 = black, 1 = white) of the logo's visible pixels. */
  luminance: number
  /** True when the logo has a transparent background, so the surface behind it shows through. */
  transparent: boolean
}

export interface LogoAsset {
  /** Storage path of the customer's original file in the PRIVATE bucket. Never a public URL. */
  originalPath: string
  originalType: LogoSourceType
  /** The file name the customer uploaded, for display only. */
  originalName: string
  /** Width ÷ height of the logo's visible content after transparent or blank margins are trimmed. */
  aspect: number
  tone: LogoTone
  renditions: Partial<Record<RenditionName, Rendition>>
  /**
   * The logo's main colours, most useful first (see `core/palette.ts`), kept so the colour picker can
   * suggest them again after a reload. Up to `PALETTE_KEEP`. Suggestions only: never applied by themselves.
   */
  palette?: { hex: string; share: number }[]
}

export const PALETTE_KEEP = 8

/** Curated, open-licence Google Fonts the customer may pick for web headings (see `fonts.ts`). No uploads in version 1. */
export type CuratedFontId = string

export interface BrandKitColors {
  /** The brand colour, `#rrggbb`. Everything else (text on it, hover, tint, a dark-screen variant) is derived. */
  primary?: string
  /** An optional second brand colour, `#rrggbb`. */
  secondary?: string
}

export interface BrandKitFonts {
  /** A `CURATED_FONTS` id. Used for headings on web pages only; emails and PDFs always use system fonts. */
  heading?: CuratedFontId
}

/** The customer's brand-guide PDF, stored privately for reference. Nothing is read from it automatically in version 1. */
export interface BrandGuideRef {
  path: string
  name: string
  bytes: number
  /** ISO time. */
  uploadedAt: string
}

export interface BrandKit {
  schemaVersion: typeof BRAND_KIT_SCHEMA_VERSION
  /** The name customers know the business by. When absent, the product shows its own record's name. */
  name?: string
  /** A short line under the name. */
  tagline?: string
  /** The public website, shown as text. Bare host or https URL. */
  website?: string
  logos: Partial<Record<LogoSlot, LogoAsset>>
  colors: BrandKitColors
  fonts: BrandKitFonts
  guide?: BrandGuideRef
}

export const TEXT_LIMITS = { name: 80, tagline: 120, website: 200 } as const

/** A kit with nothing in it. */
export function emptyKit(): BrandKit {
  return { schemaVersion: BRAND_KIT_SCHEMA_VERSION, logos: {}, colors: {}, fonts: {} }
}

/**
 * The product's own configuration, written in code. Never customer data.
 */
export interface ProductIdentity {
  /** Short machine name: 'dzgo', 'rigging', 'skyvideo', 'skyweather'. */
  product: string
  /** The product's display name, e.g. "SkyWeather". */
  productName: string
  /**
   * The "Powered by" line's text, e.g. "Powered by SkyDrive". One string, so the suite's public name
   * (still undecided, TBD-001a) changes in one place. Shown by default; whether a plan may hide it is the
   * product's business logic, passed in as `ApplyOptions.showPoweredBy`.
   */
  poweredByLabel: string
  poweredByHref?: string
  /** The product's own neutral accent, `#rrggbb`, used when the kit has no brand colour. */
  fallbackAccent: string
}

/**
 * Where a product keeps brand files. Passed in by the product; the SAME object drives the URL check in
 * `parseKit`, the path helpers in `paths.ts`, and (by its documented defaults) `sql/brand_kit.sql`, so the
 * three can never disagree about which addresses are ours.
 */
export interface BrandStorageRules {
  /** The product's Supabase project origin, e.g. `https://abcd.supabase.co`. */
  storageOrigin: string
  /** Public bucket for PNG renditions. Default name in the SQL template: `brand-assets`. */
  publicBucket: string
  /** Private bucket for originals (including SVG) and brand guides. Default: `brand-originals`. */
  privateBucket: string
  /** The tenant (site, dropzone, shop) the kit belongs to. Every path starts with it. */
  tenantId: string
}

export const DEFAULT_BUCKETS = { publicBucket: 'brand-assets', privateBucket: 'brand-originals' } as const

/** Upload limits, checked in the browser AND again on the server. */
export const UPLOAD_LIMITS = {
  logoMaxBytes: 5 * 1024 * 1024,
  /** A logo smaller than this (on its shorter visible side, after trimming) is refused as too small to print. */
  logoMinPx: 64,
  /** Raster logos larger than this are scaled down before renditions are made. */
  logoMaxPx: 4096,
  guideMaxBytes: 25 * 1024 * 1024,
  renditionMaxBytes: 2 * 1024 * 1024,
} as const

// ---------------------------------------------------------------------------------------------------------
// Versions. A kit is never edited in place: the customer edits a draft, previews it, and publishes it.
// Published versions are immutable. The product's "live" kit is a pointer to one published version, so a
// rollback is a pointer change.
// ---------------------------------------------------------------------------------------------------------

export type VersionState = 'draft' | 'published'

export interface BrandKitVersion {
  id: string
  tenantId: string
  state: VersionState
  kit: BrandKit
  /** The published version this draft started from, if any. */
  basedOn: string | null
  createdAt: string
  createdBy: string | null
  publishedAt: string | null
  publishedBy: string | null
}

// ---------------------------------------------------------------------------------------------------------
// Validation results. The validator repairs before it refuses, and says what it did.
// ---------------------------------------------------------------------------------------------------------

export type ProblemSeverity = 'refused' | 'repaired' | 'warning'

export interface KitProblem {
  /** Dotted path of the field, e.g. `colors.primary`, `logos.logo.renditions.email.url`. */
  field: string
  severity: ProblemSeverity
  /** Plain English, shown to the customer as is. */
  message: string
}

export interface ParseResult {
  kit: BrandKit
  problems: KitProblem[]
}

// ---------------------------------------------------------------------------------------------------------
// Applying a kit. A kit is turned into a theme for one surface, then the theme is painted.
// ---------------------------------------------------------------------------------------------------------

/** Where a kit is being shown. Each has its own constraints (research §8). */
export type Surface = 'web-light' | 'web-dark' | 'email' | 'pdf' | 'print' | 'tv'

export interface ApplyOptions {
  surface: Surface
  /** The name to show when the kit has none: the product's own record of the business. */
  fallbackName: string
  /** Whether to show `ProductIdentity.poweredByLabel`. Default true. */
  showPoweredBy?: boolean
}

/** The logo a surface should draw, already chosen and sized, or null to draw the name as text. */
export interface LogoChoice {
  slot: LogoSlot
  rendition: RenditionName
  url: string
  width: number
  height: number
  /** Draw the logo on a light rounded panel, because it is dark and the surface is dark. */
  chip: boolean
}

export interface ThemeColors {
  accent: string
  /** Text drawn on the accent: always readable at WCAG AA (4.5:1). */
  accentInk: string
  accentHover: string
  /** A pale tint of the accent for backgrounds behind accent-coloured text. */
  accentSoft: string
  secondary: string | null
  secondaryInk: string | null
}

export interface BrandTheme {
  surface: Surface
  /** Light or dark ground, from the surface. */
  ground: 'light' | 'dark'
  name: string
  tagline: string | null
  website: string | null
  logo: LogoChoice | null
  colors: ThemeColors
  /** CSS font-family for headings on web surfaces; null means use the product's own. */
  headingFont: string | null
  /** A stylesheet URL to load for `headingFont`, or null. */
  headingFontCss: string | null
  poweredBy: { label: string; href: string | null } | null
  /** What was changed to make the kit readable on this surface, and any warnings. Shown in the preview. */
  problems: KitProblem[]
}
