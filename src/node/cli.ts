#!/usr/bin/env node
/** `brand-kit-css <kitDir> [--surface web-light] [--selector :root] [--self-hosted-fonts] ...` prints the theme CSS. */
import { deriveTheme } from '../core/theme.js'
import { themeCssText } from '../core/apply.js'
import { isStrictHex } from '../core/color.js'
import { KitError } from '../core/validate.js'
import type { Surface } from '../core/kit.js'
import { loadKitFromDir } from './load.js'

const SURFACES: readonly Surface[] = ['web-light', 'web-dark', 'email', 'pdf', 'print', 'tv']
const USAGE = `Usage: brand-kit-css <kitDir> [--surface ${SURFACES.join('|')}] [--selector :root] [--self-hosted-fonts] [--fallback-accent #rrggbb] [--fallback-name <name>]`

async function fail(message: string): Promise<number> {
  process.stderr.write(`${message}\n`)
  return 1
}

async function run(dir: string, surface: Surface, selector: string, selfHosted: boolean, accent: string, name: string): Promise<number> {
  try {
    const { kit } = await loadKitFromDir(dir, { prepare: false })
    const identity = { product: 'site', productName: name, poweredByLabel: '', fallbackAccent: accent }
    const theme = deriveTheme(kit, identity, { surface, fallbackName: name, selfHostedFonts: selfHosted })
    for (const p of theme.problems) process.stderr.write(`${p.severity}: ${p.message}\n`)
    process.stdout.write(`${themeCssText(theme, selector)}\n`)
    return 0
  } catch (e) {
    if (e instanceof KitError) {
      for (const p of e.problems) process.stderr.write(`${p.severity}: ${p.message}\n`)
      return 1
    }
    return fail(e instanceof Error ? e.message : String(e))
  }
}

async function main(argv: string[]): Promise<number> {
  const flags = new Map<string, string>()
  const positional: string[] = []
  let selfHosted = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === '--self-hosted-fonts') selfHosted = true
    else if (a.startsWith('--')) {
      const v = argv[++i]
      if (v === undefined) return fail(`${a} needs a value.`)
      flags.set(a, v)
    } else positional.push(a)
  }
  const dir = positional[0]
  if (dir === undefined || positional.length > 1) return fail(USAGE)
  const surface = (flags.get('--surface') ?? 'web-light') as Surface
  if (!SURFACES.includes(surface)) return fail(`Unknown surface "${surface}". ${USAGE}`)
  const accent = flags.get('--fallback-accent') ?? '#1a73e8'
  if (!isStrictHex(accent)) return fail('--fallback-accent must be a lower-case #rrggbb colour.')
  return run(dir, surface, flags.get('--selector') ?? ':root', selfHosted, accent, flags.get('--fallback-name') ?? 'Brand')
}

process.exitCode = await main(process.argv.slice(2))
