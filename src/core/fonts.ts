/**
 * The heading fonts a customer may pick. No uploads in version 1: desktop font licences rarely allow web
 * embedding, and most email clients ignore web fonts anyway (emails and PDFs always use system fonts).
 *
 * Every family here is published by Google Fonts under the SIL Open Font Licence (checked against each
 * family's METADATA.pb in github.com/google/fonts, 2026-10-02), and every `cssUrl` was fetched and
 * returned 200 on the same day.
 *
 * `stack` is the exact CSS `font-family` value used for headings. `apply.ts` only ever writes a value
 * that is one of these stacks, so nothing a customer types can reach a stylesheet through a font.
 */

export type FontCategory = 'sans' | 'serif' | 'display' | 'mono'

export interface CuratedFont {
  /** Stable id stored in a kit (`fonts.heading`). */
  id: string
  /** The family name as Google Fonts spells it. */
  family: string
  /** System fonts to use while the web font loads, or if it fails. */
  fallback: string
  category: FontCategory
  /** `https://fonts.googleapis.com/css2?family=...&display=swap`. */
  cssUrl: string
  /** The full CSS `font-family` value: the family, then the fallback. */
  stack: string
}

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
const SERIF = "Georgia, Cambria, 'Times New Roman', Times, serif"
const CONDENSED = "Impact, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif"

function font(id: string, family: string, category: FontCategory, fallback: string, weights: string | null): CuratedFont {
  const param = family.replace(/ /g, '+') + (weights === null ? '' : `:wght@${weights}`)
  return {
    id,
    family,
    fallback,
    category,
    cssUrl: `https://fonts.googleapis.com/css2?family=${param}&display=swap`,
    stack: `'${family}', ${fallback}`,
  }
}

export const CURATED_FONTS: readonly CuratedFont[] = Object.freeze([
  font('inter', 'Inter', 'sans', SANS, '400;700'),
  font('roboto', 'Roboto', 'sans', SANS, '400;700'),
  font('open-sans', 'Open Sans', 'sans', SANS, '400;700'),
  font('montserrat', 'Montserrat', 'sans', SANS, '400;700'),
  font('lato', 'Lato', 'sans', SANS, '400;700'),
  font('poppins', 'Poppins', 'sans', SANS, '400;700'),
  font('raleway', 'Raleway', 'sans', SANS, '400;700'),
  font('merriweather', 'Merriweather', 'serif', SERIF, '400;700'),
  font('playfair-display', 'Playfair Display', 'serif', SERIF, '400;700'),
  font('source-serif-4', 'Source Serif 4', 'serif', SERIF, '400;700'),
  font('oswald', 'Oswald', 'display', CONDENSED, '400;700'),
  // Bebas Neue has a single weight; asking css2 for others is an error.
  font('bebas-neue', 'Bebas Neue', 'display', CONDENSED, null),
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

/** True when `value` is exactly one of the curated stylesheet addresses. */
export function isCuratedCssUrl(value: unknown): value is string {
  return typeof value === 'string' && CURATED_FONTS.some((f) => f.cssUrl === value)
}
