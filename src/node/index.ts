/** `@skydrivehq/brand-kit/node`: brand kits from a folder, for static sites. Needs `sharp` to prepare logos. */
export { loadKitFromDir } from './load.js'
export type { LoadKitOptions } from './load.js'
export { prepareLogoFile } from './prepare.js'
export { fileStoreRules, isFileStorePath } from '../core/paths.js'
