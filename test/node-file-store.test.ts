import { mkdtemp, mkdir, writeFile, copyFile, readFile, readdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copyFontFiles, loadKitFromDir, prepareLogoFile } from '../src/node/index.js'
import { analysePixels } from '../src/core/analyse.js'
import { fileStoreRules, isFileStorePath, isOwnPrivatePath, isOwnPublicAssetUrl } from '../src/core/paths.js'
import { deriveTheme } from '../src/core/theme.js'
import { themeCssText } from '../src/core/apply.js'
import { fontById } from '../src/core/fonts.js'
import { KitError } from '../src/core/validate.js'
import type { BrandKit, BrandStorageRules, ProductIdentity } from '../src/core/kit.js'

const FIXTURES = join(__dirname, '..', 'fixtures', 'skydrive-mock-kit')
const SHA = 'a'.repeat(64)
const identity: ProductIdentity = { product: 'site', productName: 'Site', poweredByLabel: 'P', fallbackAccent: '#2563eb' }

let tmp: string
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'brand-kit-'))
})
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function kitDir(name: string, kit: unknown, files: Record<string, string> = {}): Promise<string> {
  const dir = join(tmp, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'kit.json'), JSON.stringify(kit))
  for (const [to, from] of Object.entries(files)) await copyFile(join(FIXTURES, from), join(dir, to))
  return dir
}

describe('file-store rules', () => {
  const rules = fileStoreRules({ root: '/site/brand' })
  it('accepts relative paths and refuses escapes, absolutes and URLs', () => {
    expect(isFileStorePath('brand/logo.png')).toBe(true)
    const bad = ['../logo.png', 'a/../../b.png', '/etc/passwd', 'C:/x.png', 'C:\\x.png', '..\\x.png', 'https://evil.example/x.png', './x.png', 'a//b.png', '.hidden/x.png', 'x%2e%2e/y.png', '', 'a\u0000.png']
    for (const p of bad) expect(isFileStorePath(p), p).toBe(false)
    expect(isOwnPrivatePath('logo.svg', rules)).toBe(true)
    expect(isOwnPrivatePath('../logo.svg', rules)).toBe(false)
    expect(isOwnPrivatePath('notes.txt', rules)).toBe(false)
    expect(isOwnPublicAssetUrl(`out/${SHA}.png`, rules)).toBe(true)
    expect(isOwnPublicAssetUrl(`${SHA}.png`, rules)).toBe(true)
    expect(isOwnPublicAssetUrl(`../${SHA}.png`, rules)).toBe(false)
    expect(isOwnPublicAssetUrl(`https://evil.example/${SHA}.png`, rules)).toBe(false)
    expect(isOwnPublicAssetUrl('out/logo.png', rules)).toBe(false)
  })

  it('leaves the default Supabase rules unchanged: relative paths are still refused', () => {
    const def: BrandStorageRules = { storageOrigin: 'https://abc.supabase.co', publicBucket: 'brand-assets', privateBucket: 'brand-originals', tenantId: 't1' }
    expect(isOwnPublicAssetUrl(`out/${SHA}.png`, def)).toBe(false)
    expect(isOwnPublicAssetUrl(`${SHA}.png`, def)).toBe(false)
    expect(isOwnPrivatePath('logo.svg', def)).toBe(false)
    const good = `https://abc.supabase.co/storage/v1/object/public/brand-assets/t1/0aaaaaaa-0000-4000-8000-000000000000/${SHA}.png`
    expect(isOwnPublicAssetUrl(good, def)).toBe(true)
  })

  it('refuses a malformed file-store root', () => {
    expect(() => fileStoreRules({ root: '' })).toThrow()
  })
})

describe('loadKitFromDir', () => {
  it('loads colours and a font without needing sharp when prepare is false', async () => {
    const dir = await kitDir('plain', { name: 'Acme', colors: { primary: '#aa3300' }, fonts: { heading: 'questrial' }, logos: { logo: 'logo.png' } })
    const { kit } = await loadKitFromDir(dir, { prepare: false })
    expect(kit.name).toBe('Acme')
    expect(kit.colors.primary).toBe('#aa3300')
    expect(kit.fonts.heading).toBe('questrial')
    expect(kit.logos.logo).toBeUndefined()
  })

  it('prepares a logo named by a relative path and checks its files', async () => {
    const dir = await kitDir('logo', { name: 'Acme', logos: { logo: 'logo.png', mark: 'mark.png' } }, { 'logo.png': 'logo.png', 'mark.png': 'mark.png' })
    const { kit } = await loadKitFromDir(dir, { publicBase: 'https://example.com/brand/' })
    const web = kit.logos.logo?.renditions.web
    expect(web?.height).toBe(96)
    expect(web?.url).toMatch(/^https:\/\/example\.com\/brand\/brand-kit-out\/[0-9a-f]{64}\.png$/)
    expect(kit.logos.mark?.renditions.icon512?.width).toBe(512)
    expect(kit.logos.logo?.originalPath).toBe('logo.png')
  })

  it('refuses paths that escape the folder, absolute paths and URLs', async () => {
    for (const bad of ['../outside.png', '/etc/passwd', 'https://evil.example/x.png']) {
      const dir = await kitDir('esc', { logos: { logo: bad } })
      await expect(loadKitFromDir(dir), bad).rejects.toBeInstanceOf(KitError)
    }
    const record = {
      originalPath: '../x.png',
      originalType: 'image/png',
      originalName: 'x',
      aspect: 2,
      tone: { luminance: 0.5, transparent: true },
      renditions: { web: { url: `../${SHA}.png`, width: 10, height: 10, bytes: 10, sha256: SHA } },
    }
    const dir = await kitDir('esc2', { logos: { logo: record } })
    await expect(loadKitFromDir(dir)).rejects.toBeInstanceOf(KitError)
    const lenient = await loadKitFromDir(dir, { mode: 'lenient' })
    expect(lenient.kit.logos.logo).toBeUndefined()
  })

  it('refuses a symlink that points outside the folder', async () => {
    const dir = await kitDir('link', { logos: { logo: 'linked.png' } })
    try {
      await symlink(join(FIXTURES, 'logo.png'), join(dir, 'linked.png'))
    } catch {
      return // creating symlinks needs privileges on some Windows setups
    }
    await expect(loadKitFromDir(dir)).rejects.toBeInstanceOf(KitError)
  })

  it('throws a KitError when kit.json is missing', async () => {
    await expect(loadKitFromDir(join(tmp, 'nothing-here'))).rejects.toBeInstanceOf(KitError)
  })
})

describe('prepareLogoFile', () => {
  it('makes the wide renditions at the browser heights, named by hash, and writes them', async () => {
    const out = join(tmp, 'out-wide')
    const p = await prepareLogoFile(join(FIXTURES, 'logo.png'), 'logo', out)
    const heights = Object.fromEntries(p.renditions.map((r) => [r.name, r.height]))
    expect(heights).toEqual({ web: 96, web2x: 192, email: 120, pdf: 240, print: 600 })
    for (const r of p.renditions) {
      const bytes = new Uint8Array(await readFile(join(out, `${r.sha256}.png`)))
      const meta = await sharp(bytes).metadata()
      expect([meta.width, meta.height, meta.format]).toEqual([r.width, r.height, 'png'])
    }
    expect(p.original.type).toBe('image/png')
  })

  it('makes the mark icons at 32, 192 and 512', async () => {
    const p = await prepareLogoFile(join(FIXTURES, 'mark.png'), 'mark', join(tmp, 'out-mark'))
    const sizes = Object.fromEntries(p.renditions.map((r) => [r.name, [r.width, r.height]]))
    expect(sizes.icon32).toEqual([32, 32])
    expect(sizes.icon192).toEqual([192, 192])
    expect(sizes.icon512).toEqual([512, 512])
  })

  it('rasterises an SVG and never writes one out', async () => {
    const out = join(tmp, 'out-svg')
    const p = await prepareLogoFile(join(FIXTURES, 'logo.svg'), 'logo', out)
    expect(p.original.type).toBe('image/svg+xml')
    expect(p.renditions.find((r) => r.name === 'print')?.height).toBe(600)
    expect((await readdir(out)).every((f) => /^[0-9a-f]{64}\.png$/.test(f))).toBe(true)
  })

  it('measures the same tone and shape as the shared pixel analysis on the same bytes', async () => {
    const file = join(FIXTURES, 'logo.png')
    const { data, info } = await sharp(file).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(Math.max(info.width, info.height)).toBeLessThanOrEqual(4096)
    const expected = analysePixels(new Uint8Array(data), info.width, info.height)
    expect(expected).not.toBeNull()
    const p = await prepareLogoFile(file, 'logo', join(tmp, 'out-tone'))
    expect(p.tone).toEqual(expected?.tone)
    expect(p.aspect).toBeCloseTo(expected?.aspect ?? 0, 10)
  })

  it('refuses small, mismatched, unsafe, non-image and missing files', async () => {
    const out = join(tmp, 'out-bad')
    const bad = join(FIXTURES, 'bad-files')
    await expect(prepareLogoFile(join(bad, 'tiny-logo.png'), 'logo', out)).rejects.toBeInstanceOf(KitError)
    await expect(prepareLogoFile(join(bad, 'jpeg-named-as.png'), 'logo', out)).rejects.toThrow(/named as a PNG/)
    await expect(prepareLogoFile(join(bad, 'logo-with-script.svg'), 'logo', out)).rejects.toBeInstanceOf(KitError)
    await expect(prepareLogoFile(join(bad, 'not-a-pdf.pdf'), 'logo', out)).rejects.toBeInstanceOf(KitError)
    await expect(prepareLogoFile(join(tmp, 'missing.png'), 'logo', out)).rejects.toBeInstanceOf(KitError)
  })
})

describe('self-hosted fonts', () => {
  const kit = { colors: {}, fonts: { heading: 'questrial' }, logos: {} } as unknown as BrandKit
  it('has Questrial in the curated list', () => {
    expect(fontById('questrial')?.stack).toMatch(/^'Questrial', /)
  })
  it('writes @font-face with a relative address and no remote address when given a font folder', () => {
    const theme = deriveTheme(kit, identity, { surface: 'web-light', fallbackName: 'S' })
    const css = themeCssText(theme, ':root', { fontBase: './fonts/' })
    expect(css).toContain('--brand-font-heading:')
    expect(css).toContain("@font-face{font-family:'Questrial'")
    expect(css).toContain('url(./fonts/questrial/questrial-latin-400.woff2)')
    expect(css).not.toMatch(/googleapis|gstatic|https?:/)
  })
  it('writes no @font-face without a font folder, and none for a theme with no curated font', () => {
    const theme = deriveTheme(kit, identity, { surface: 'web-light', fallbackName: 'S' })
    expect(themeCssText(theme)).not.toContain('@font-face')
    const none = deriveTheme({ colors: {}, fonts: {}, logos: {} } as unknown as BrandKit, identity, { surface: 'web-light', fallbackName: 'S' })
    expect(themeCssText(none, ':root', { fontBase: './fonts/' })).not.toContain('@font-face')
  })
  it('copies the files and licence of a font into a site folder', async () => {
    const dest = join(tmp, 'site-fonts')
    const written = await copyFontFiles(fontById('aldrich')!, dest)
    expect(written.map((p) => p.replaceAll('\\', '/').split('/').slice(-2).join('/'))).toEqual(['aldrich/aldrich-latin-400.woff2', 'aldrich/OFL.txt'])
    expect((await readFile(join(dest, 'aldrich', 'aldrich-latin-400.woff2'))).subarray(0, 4).toString('latin1')).toBe('wOF2')
  })
})
