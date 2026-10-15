/**
 * The heading fonts a customer may pick. No uploads in version 1: desktop font licences rarely allow web
 * embedding, and most email clients ignore web fonts anyway (emails and PDFs always use system fonts).
 *
 * Every family here is published under the SIL Open Font Licence, and ships inside this package as woff2
 * files under `fonts/<id>/` with its licence text (`OFL.txt`) beside them. Nothing is ever loaded from
 * Google's servers: the CSS this package writes uses `@font-face` with relative addresses to those files
 * (`fontFaceCss`, `fonts/fonts.css`). The files and their unicode ranges come from the `@fontsource`
 * packages (see `fonts-data.ts`).
 *
 * `stack` is the exact CSS `font-family` value used for headings. `apply.ts` only ever writes a value
 * that is one of these stacks, so nothing a customer types can reach a stylesheet through a font.
 */

import { FONT_FILES, type FontFileInfo } from './fonts-data.js'

export type { FontFileInfo } from './fonts-data.js'

export type FontCategory = 'sans' | 'serif' | 'display' | 'mono'

export interface CuratedFont {
  /** Stable id stored in a kit (`fonts.heading`). */
  id: string
  /** The family name as Google Fonts spells it. */
  family: string
  /** System fonts to use while the web font loads, or if it fails. */
  fallback: string
  category: FontCategory
  /** Licence of the font files, e.g. `OFL-1.1`. The licence text is `fonts/<id>/OFL.txt`. */
  license: string
  /** The woff2 files that ship in the package: latin, plus latin-ext where the family has it. */
  files: readonly FontFileInfo[]
  /** The full CSS `font-family` value: the family, then the fallback. */
  stack: string
}

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
const SERIF = "Georgia, Cambria, 'Times New Roman', Times, serif"
const CONDENSED = "Impact, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif"

function font(id: string, family: string, category: FontCategory, fallback: string): CuratedFont {
  const data = FONT_FILES[id]
  if (data === undefined) throw new Error(`fonts: no font files recorded for "${id}"`)
  return {
    id,
    family,
    fallback,
    category,
    license: data.license,
    files: Object.freeze(data.files.map((f) => Object.freeze({ ...f }))),
    stack: `'${family}', ${fallback}`,
  }
}

export const CURATED_FONTS: readonly CuratedFont[] = Object.freeze([
  font('inter', 'Inter', 'sans', SANS),
  font('roboto', 'Roboto', 'sans', SANS),
  font('open-sans', 'Open Sans', 'sans', SANS),
  font('montserrat', 'Montserrat', 'sans', SANS),
  font('lato', 'Lato', 'sans', SANS),
  font('poppins', 'Poppins', 'sans', SANS),
  font('raleway', 'Raleway', 'sans', SANS),
  font('questrial', 'Questrial', 'sans', SANS),
  font('roboto-condensed', 'Roboto Condensed', 'sans', SANS),
  // Orange Skies' heading font.
  font('aldrich', 'Aldrich', 'display', SANS),
  font('merriweather', 'Merriweather', 'serif', SERIF),
  font('playfair-display', 'Playfair Display', 'serif', SERIF),
  font('source-serif-4', 'Source Serif 4', 'serif', SERIF),
  font('oswald', 'Oswald', 'display', CONDENSED),
  font('bebas-neue', 'Bebas Neue', 'display', CONDENSED),
].map((f) => Object.freeze(f)))

/** Look up a curated font by id; undefined for anything else. */
export function fontById(id: unknown): CuratedFont | undefined {
  if (typeof id !== 'string') return undefined
  return CURATED_FONTS.find((f) => f.id === id)
}

/** True when `value` is exactly one of the curated `font-family` stacks. */
export function isCuratedStack(value: unknown): value is string {
  return typeof value === 'string' && CURATED_FONTS.some((f) => f.stack === value)
}

const FONT_BASE = /^(?:\/?(?:(?:\.\.?|[A-Za-z0-9_-][A-Za-z0-9_.-]*)\/)*)$/

/** True for a relative or root-relative folder address ending in `/` (or empty): `./`, `../fonts/`, `/assets/fonts/`. No scheme, no host, no quotes. */
export function isSafeFontBase(base: unknown): base is string {
  return typeof base === 'string' && base.length <= 200 && FONT_BASE.test(base)
}

/**
 * The `@font-face` rules for one curated font, pointing at the woff2 files that ship in this package.
 * `base` is the folder the package's `fonts/` folder is served from, and must be a relative address
 * ending in `/` (default `./`, which is what `fonts/fonts.css` uses). Every file gets its own rule with
 * its unicode range, so a browser only fetches the files the page's text needs.
 */
export function fontFaceCss(font: CuratedFont, base = './'): string {
  if (!isSafeFontBase(base)) {
    throw new Error('fontFaceCss: base must be a relative folder address ending in "/", such as "./" or "/assets/fonts/"')
  }
  return font.files
    .map(
      (f) =>
        `@font-face{font-family:'${font.family}';font-style:normal;font-weight:${f.weight};font-display:swap;` +
        `src:url(${base}${f.path}) format('woff2');unicode-range:${f.unicodeRange};}`,
    )
    .join('\n')
}

/** The `@font-face` rules for every curated font. This is what `fonts/fonts.css` contains. */
export function allFontFacesCss(base = './'): string {
  return CURATED_FONTS.map((f) => fontFaceCss(f, base)).join('\n') + '\n'
}
