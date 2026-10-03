/**
 * `@skydrivehq/brand-kit/react`: the drop-in screen where a customer adds its own brand kit.
 *
 * Import the stylesheet once from `@skydrivehq/brand-kit/react/styles.css`. Every class is scoped under
 * `.bk-`, so it drops into any product whatever its CSS stack.
 */
export { BrandKitDropIn, DEFAULT_PREVIEW_SURFACES } from './BrandKitDropIn.js'
export type { BrandKitDropInProps } from './BrandKitDropIn.js'
export { BrandPreview, SURFACE_LABELS, emailPreviewDocument, isDrawableLogoUrl } from './BrandPreview.js'
export type { BrandPreviewProps } from './BrandPreview.js'
export { useBrandKit, applyKitPatch } from './useBrandKit.js'
export type {
  KitPatch,
  PaletteSuggestion,
  UploadItem,
  UploadStatus,
  UseBrandKit,
  UseBrandKitOptions,
} from './useBrandKit.js'
export {
  LIGHT_LOGO_LUMINANCE,
  SLOT_COPY,
  SQUARE_ASPECT,
  droppedFileKind,
  guessLogoSlot,
  pickFreeSlot,
} from './slots.js'
export type { DroppedFileKind, SlotCopy } from './slots.js'
