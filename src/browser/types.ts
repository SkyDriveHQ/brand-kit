import type { KitProblem, LogoSlot, LogoSourceType, LogoTone, RenditionName } from '../core/kit.js'

/** One PNG made in the browser from a logo, ready to upload to the public bucket. */
export interface PreparedRendition {
  name: RenditionName
  blob: Blob
  width: number
  height: number
  /** Lower-case hex SHA-256 of the PNG bytes. */
  sha256: string
}

/**
 * A logo, checked, cleaned and turned into PNGs in the customer's browser, not yet uploaded.
 *
 * For an SVG, `original.blob` is the SANITISED text, not what the customer dropped in: that is what is
 * kept (privately) as the source for re-rasterising later.
 */
export interface PreparedLogo {
  slot: LogoSlot
  original: { blob: Blob; type: LogoSourceType; name: string; sha256: string; ext: string }
  renditions: PreparedRendition[]
  tone: LogoTone
  aspect: number
  /** Colour suggestions from the logo, chromatic colours first (see `extractPalette`). */
  palette: { hex: string; share: number }[]
  /** Repairs and warnings, in plain English. Anything refused throws a `KitError` instead. */
  problems: KitProblem[]
}

/** A brand-guide PDF, checked, not yet uploaded. */
export interface PreparedGuide {
  blob: Blob
  name: string
  bytes: number
  sha256: string
}
