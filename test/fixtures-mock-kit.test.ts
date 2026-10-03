/**
 * The SkyDrive mock brand kit (fixtures/skydrive-mock-kit), checked on every `npm test` for everything that
 * does not need a canvas. The canvas half (trimming, sizes, palette) is run in real Chrome by
 * fixtures/check.html; its results are recorded in the kit's README.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deriveTheme, emptyKit, readImageSize, sniffType, svgDenyScan } from '../src/core/index.js'

const dir = new URL('../fixtures/skydrive-mock-kit/', import.meta.url)
const bytes = (name: string) => new Uint8Array(readFileSync(new URL(name, dir)))
const text = (name: string) => readFileSync(new URL(name, dir), 'utf8')

describe('SkyDrive mock brand kit: the good files', () => {
  it('each file is what its name says', () => {
    for (const n of ['logo.svg', 'logo-on-dark.svg', 'mark.svg']) expect(sniffType(bytes(n))).toBe('image/svg+xml')
    for (const n of ['logo.png', 'logo-on-dark.png', 'mark.png']) expect(sniffType(bytes(n))).toBe('image/png')
    expect(sniffType(bytes('brand-guide.pdf'))).toBe('application/pdf')
  })

  it('the PNGs are the documented sizes', () => {
    expect(readImageSize(bytes('logo.png'))).toEqual({ width: 1040, height: 320 })
    expect(readImageSize(bytes('logo-on-dark.png'))).toEqual({ width: 1040, height: 320 })
    expect(readImageSize(bytes('mark.png'))).toEqual({ width: 1024, height: 1024 })
  })

  it('the clean SVGs pass the deny scan untouched', () => {
    for (const n of ['logo.svg', 'logo-on-dark.svg', 'mark.svg']) expect(svgDenyScan(text(n))).toEqual([])
  })

  it('the kit colours give the expected warnings: pale blue on white, orange near caution amber', () => {
    const kit = { ...emptyKit(), name: 'SkyDrive', colors: { primary: '#5eb0ff', secondary: '#ffb454' }, fonts: { heading: 'inter' } }
    const identity = { product: 'test', productName: 'Test', poweredByLabel: 'Powered by SkyDrive', fallbackAccent: '#2563eb' }
    const light = deriveTheme(kit, identity, { surface: 'web-light', fallbackName: 'Skydive Testharness' })
    expect(light.colors.accent).toBe('#5eb0ff')
    expect(light.colors.accentInk).toBe('#000000')
    expect(light.problems.map((p) => p.message).join(' ')).toMatch(/very pale/)
    expect(light.problems.map((p) => p.message).join(' ')).toMatch(/amber/)
    const tv = deriveTheme(kit, identity, { surface: 'tv', fallbackName: 'Skydive Testharness' })
    expect(tv.problems.map((p) => p.message)).toHaveLength(1)
    expect(tv.problems[0]!.message).toMatch(/amber/)
  })
})

describe('SkyDrive mock brand kit: the deliberately bad files', () => {
  it('the scripted logo is caught by the deny scan before cleaning', () => {
    expect(svgDenyScan(text('bad-files/logo-with-script.svg')).length).toBeGreaterThanOrEqual(2)
    expect(svgDenyScan(text('bad-files/external-only.svg')).length).toBeGreaterThanOrEqual(2)
  })

  it('a JPEG named .png and a text file named .pdf are told apart by their bytes', () => {
    expect(sniffType(bytes('bad-files/jpeg-named-as.png'))).toBe('image/jpeg')
    expect(sniffType(bytes('bad-files/not-a-pdf.pdf'))).toBeNull()
  })

  it('the tiny and the tall logo are the documented sizes', () => {
    expect(readImageSize(bytes('bad-files/tiny-logo.png'))).toEqual({ width: 48, height: 15 })
    expect(readImageSize(bytes('bad-files/tall-logo.png'))).toEqual({ width: 300, height: 900 })
  })
})
