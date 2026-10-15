/** Copying the package's font files into a site, for products that serve their own static files. */
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CuratedFont } from '../core/fonts.js'

/** The package's `fonts/` folder. `dist/node/fonts.js` and `src/node/fonts.ts` are both two folders below the package root. */
export const PACKAGE_FONTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fonts')

/**
 * Copy one curated font's woff2 files and its licence text into `<destDir>/<id>/`, the layout the
 * `@font-face` rules from `fontFaceCss(font, base)` expect when `base` is where `destDir` is served.
 * Returns the paths written.
 */
export async function copyFontFiles(font: CuratedFont, destDir: string): Promise<string[]> {
  const written: string[] = []
  const out = join(destDir, font.id)
  await mkdir(out, { recursive: true })
  for (const f of font.files) {
    const to = join(destDir, f.path)
    await copyFile(join(PACKAGE_FONTS_DIR, f.path), to)
    written.push(to)
  }
  const licence = join(out, 'OFL.txt')
  await copyFile(join(PACKAGE_FONTS_DIR, font.id, 'OFL.txt'), licence)
  written.push(licence)
  return written
}
