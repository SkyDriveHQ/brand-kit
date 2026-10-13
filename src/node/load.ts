/**
 * Loading a brand kit from a folder: `kit.json` plus the logo files it names. For a static site that has no
 * Supabase and no browser. Everything still passes `parseKit`, with `fileStoreRules` as the rules.
 */
import { readFile, realpath, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { BrandKit, KitProblem, LogoAsset, LogoSlot, ParseResult, RenditionName } from '../core/kit.js'
import { LOGO_SLOTS } from '../core/kit.js'
import { fileStoreRules, isFileStorePath } from '../core/paths.js'
import { isSafeImageUrl } from '../core/apply.js'
import { KitError, parseKit } from '../core/validate.js'
import type { ParseMode } from '../core/validate.js'
import { prepareLogoFile } from './prepare.js'

export interface LoadKitOptions {
  /** `strict` (default) throws `KitError` when anything is refused; `lenient` drops bad fields silently. */
  mode?: ParseMode
  /**
   * Prepare logos named as plain paths in `kit.json` (`"logos": { "logo": "logo.svg" }`) into PNG renditions.
   * Default true. Needs `sharp`. When false, such entries are skipped.
   */
  prepare?: boolean
  /** Where prepared renditions are written, relative to the kit folder. Default `brand-kit-out`. */
  outDir?: string
  /** An https address ending in `/` that serves the kit folder. When set, rendition urls become absolute. */
  publicBase?: string
}

/** A relative path resolved on disk, which must be a regular file inside `root` after symlinks. Null if not. */
async function containedFile(root: string, rel: string): Promise<string | null> {
  if (!isFileStorePath(rel)) return null
  try {
    const real = await realpath(resolve(root, rel))
    if (!real.startsWith(root + sep)) return null
    return (await stat(real)).isFile() ? real : null
  } catch {
    return null
  }
}

/**
 * Reads `<dir>/kit.json`, prepares any logo given as a plain file path, validates the whole kit with
 * `fileStoreRules({ root: dir })`, and checks that every file the kit refers to exists inside `dir` once
 * symlinks are resolved. A logo may also be given as a full logo record (as `parseKit` reads it) whose
 * paths are relative to `dir`.
 */
export async function loadKitFromDir(dir: string, opts: LoadKitOptions = {}): Promise<ParseResult> {
  const mode = opts.mode ?? 'strict'
  const problems: KitProblem[] = []
  let root: string
  let text: string
  try {
    root = await realpath(resolve(dir))
    text = await readFile(join(root, 'kit.json'), 'utf8')
  } catch {
    throw new KitError([{ field: 'kit', severity: 'refused', message: `There is no kit.json in ${dir}.` }])
  }
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    throw new KitError([{ field: 'kit', severity: 'refused', message: 'kit.json is not valid JSON.' }])
  }
  if (opts.publicBase !== undefined && !isSafeImageUrl(`${opts.publicBase}${'0'.repeat(64)}.png`)) {
    throw new Error('loadKitFromDir: publicBase must be an https address ending in "/"')
  }

  const rules = fileStoreRules({ root })
  const outRel = opts.outDir ?? 'brand-kit-out'
  if (!isFileStorePath(outRel)) throw new Error('loadKitFromDir: outDir must be a plain relative path inside the kit folder')
  const logosIn = typeof input === 'object' && input !== null ? (input as { logos?: unknown }).logos : undefined
  if (typeof logosIn === 'object' && logosIn !== null && !Array.isArray(logosIn)) {
    const logos: Record<string, unknown> = { ...(logosIn as Record<string, unknown>) }
    for (const slot of LOGO_SLOTS) {
      const v = logos[slot]
      if (typeof v !== 'string') continue
      delete logos[slot]
      if (opts.prepare === false) continue
      const field = `logos.${slot}`
      const abs = await containedFile(root, v)
      if (abs === null) {
        problems.push({ field, severity: 'refused', message: 'This logo file is not inside the kit folder, or does not exist, so it was not used.' })
        continue
      }
      try {
        const prepared = await prepareLogoFile(abs, slot as LogoSlot, join(root, ...outRel.split('/')))
        const renditions: LogoAsset['renditions'] = {}
        for (const r of prepared.renditions) {
          renditions[r.name as RenditionName] = {
            url: `${outRel}/${r.sha256}.png`,
            width: r.width,
            height: r.height,
            bytes: r.blob.size,
            sha256: r.sha256,
          }
        }
        logos[slot] = {
          originalPath: v,
          originalType: prepared.original.type,
          originalName: prepared.original.name,
          aspect: prepared.aspect,
          tone: prepared.tone,
          palette: prepared.palette,
          renditions,
        }
        problems.push(...prepared.problems)
      } catch (e) {
        if (e instanceof KitError) problems.push(...e.problems)
        else throw e
      }
    }
    input = { ...(input as Record<string, unknown>), logos }
  }

  const parsed = parseKit(input, rules, mode)
  const kit: BrandKit = parsed.kit
  problems.push(...parsed.problems)

  // The paths passed the lexical check; now make sure each one is a real file inside the folder.
  for (const slot of LOGO_SLOTS) {
    const asset = kit.logos[slot]
    if (asset === undefined) continue
    const paths = [asset.originalPath, ...Object.values(asset.renditions).map((r) => r.url)]
    const checks = await Promise.all(paths.map((p) => containedFile(root, p)))
    if (checks.some((c) => c === null)) {
      delete kit.logos[slot]
      problems.push({ field: `logos.${slot}`, severity: 'refused', message: 'A file this logo refers to is missing or outside the kit folder, so it was not used.' })
    } else if (opts.publicBase !== undefined) {
      for (const r of Object.values(asset.renditions)) r.url = `${opts.publicBase}${r.url}`
    }
  }
  if (kit.guide !== undefined && (await containedFile(root, kit.guide.path)) === null) {
    delete kit.guide
    problems.push({ field: 'guide', severity: 'refused', message: 'The brand guide file is missing or outside the kit folder, so it was not kept.' })
  }

  if (mode === 'strict' && problems.some((p) => p.severity === 'refused')) throw new KitError(problems)
  return { kit, problems: mode === 'strict' ? problems : [] }
}
