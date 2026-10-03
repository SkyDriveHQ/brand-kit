/**
 * Small pure helpers for the drop-in: what kind of file was dropped, and which logo slot it probably belongs in.
 */
import { LOGO_SLOTS, LOGO_SOURCE_TYPES } from '../core/index.js'
import type { LogoSlot, LogoTone } from '../core/index.js'

export type DroppedFileKind = 'logo' | 'guide' | 'unknown'

/**
 * A first guess from the browser's declared type or the file name. The real decision is made from the bytes
 * by `prepareLogo` / `prepareGuide`, which refuse a file whose contents do not match.
 */
export function droppedFileKind(file: { name: string; type: string }): DroppedFileKind {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'guide'
  if ((LOGO_SOURCE_TYPES as readonly string[]).includes(type) || /\.(png|jpe?g|webp|svg)$/.test(name)) return 'logo'
  return 'unknown'
}

/** Width ÷ height inside this band counts as square. */
export const SQUARE_ASPECT = { min: 0.8, max: 1.25 } as const
/** A transparent logo at least this light (mean luminance) is assumed to be made for dark backgrounds. */
export const LIGHT_LOGO_LUMINANCE = 0.6

/**
 * Guess a logo's slot from what was measured about it:
 * square → `mark`; a transparent, light-toned logo → `logoOnDark`; otherwise `logo`. The customer can move it.
 */
export function guessLogoSlot(measured: { aspect: number; tone: LogoTone }): LogoSlot {
  if (measured.aspect >= SQUARE_ASPECT.min && measured.aspect <= SQUARE_ASPECT.max) return 'mark'
  if (measured.tone.transparent && measured.tone.luminance >= LIGHT_LOGO_LUMINANCE) return 'logoOnDark'
  return 'logo'
}

/**
 * When several logos arrive at once, two can guess the same slot. The first keeps it; a later one takes the
 * first slot still free in this batch, and only if all three are taken does it replace its guess.
 */
export function pickFreeSlot(guess: LogoSlot, claimed: ReadonlySet<LogoSlot>): LogoSlot {
  if (!claimed.has(guess)) return guess
  for (const slot of LOGO_SLOTS) if (!claimed.has(slot)) return slot
  return guess
}

export interface SlotCopy {
  title: string
  description: string
  optional: boolean
}

export const SLOT_COPY: Readonly<Record<LogoSlot, SlotCopy>> = {
  logo: {
    title: 'Main logo',
    description: 'Your wide logo for light backgrounds. Used on web pages, emails and documents.',
    optional: false,
  },
  logoOnDark: {
    title: 'Logo for dark backgrounds',
    description:
      'Optional. A version made for dark screens such as a hangar TV. Without it, we put a light panel behind your main logo on dark screens.',
    optional: true,
  },
  mark: {
    title: 'Square icon',
    description: 'Optional. Used for browser tabs, app icons and small spaces. Without it, your initials are used.',
    optional: true,
  },
}
