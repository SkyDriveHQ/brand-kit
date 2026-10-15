import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURATED_FONTS, allFontFacesCss, fontById, fontFaceCss, isCuratedStack, isSafeFontBase } from '../src/core/fonts.js'

const FONTS_DIR = join(__dirname, '..', 'fonts')

describe('CURATED_FONTS', () => {
  it('holds about a dozen fonts across sans, serif and display, with unique ids', () => {
    expect(CURATED_FONTS.length).toBeGreaterThanOrEqual(10)
    expect(CURATED_FONTS.length).toBeLessThanOrEqual(16)
    expect(new Set(CURATED_FONTS.map((f) => f.id)).size).toBe(CURATED_FONTS.length)
    const cats = new Set(CURATED_FONTS.map((f) => f.category))
    for (const c of ['sans', 'serif', 'display']) expect(cats.has(c as never)).toBe(true)
  })

  it('has well-formed ids and no address that leaves the package', () => {
    for (const f of CURATED_FONTS) {
      expect(f.id).toMatch(/^[a-z0-9-]+$/)
      expect(f).not.toHaveProperty('cssUrl')
    }
  })

  it('ships every font as woff2 files with its licence text beside them', () => {
    for (const f of CURATED_FONTS) {
      expect(f.license).toBe('OFL-1.1')
      expect(f.files.some((x) => x.subset === 'latin')).toBe(true)
      expect(existsSync(join(FONTS_DIR, f.id, 'OFL.txt'))).toBe(true)
      expect(readFileSync(join(FONTS_DIR, f.id, 'OFL.txt'), 'utf8')).toMatch(/SIL OPEN FONT LICENSE/)
      for (const file of f.files) {
        expect(file.path.startsWith(`${f.id}/`) && file.path.endsWith('.woff2')).toBe(true)
        const bytes = readFileSync(join(FONTS_DIR, file.path))
        expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2')
        expect(bytes.length).toBeGreaterThan(1000)
        expect(file.unicodeRange.startsWith('U+')).toBe(true)
      }
    }
  })

  it('writes @font-face rules with relative addresses and never a remote one', () => {
    const css = fontFaceCss(fontById('inter')!)
    expect(css.match(/@font-face/g)).toHaveLength(4)
    expect(css).toContain("font-family:'Inter';font-style:normal;font-weight:700;font-display:swap;src:url(./inter/inter-latin-700.woff2) format('woff2')")
    expect(css).toContain('unicode-range:U+0000-00FF')
    expect(fontFaceCss(fontById('aldrich')!, '/assets/fonts/')).toContain('url(/assets/fonts/aldrich/aldrich-latin-400.woff2)')
    expect(allFontFacesCss()).not.toMatch(/https?:|googleapis|gstatic/i)
    expect(allFontFacesCss()).not.toContain('url(//')
    for (const bad of ['https://evil.example/', '//evil.example/', 'fonts', "./a'b/", './a b/', 'a:b/', '.../', 'javascript:/', '/a//b/']) {
      expect(isSafeFontBase(bad)).toBe(false)
      expect(() => fontFaceCss(fontById('inter')!, bad)).toThrow()
    }
    for (const ok of ['', './', '../', '/fonts/', './assets/fonts/', 'fonts/']) expect(isSafeFontBase(ok)).toBe(true)
  })

  it('keeps the committed fonts/fonts.css in step with the code', () => {
    expect(readFileSync(join(FONTS_DIR, 'fonts.css'), 'utf8')).toBe(allFontFacesCss('./'))
  })

  it('includes Aldrich (single weight) and Roboto Condensed', () => {
    expect(fontById('aldrich')).toMatchObject({ family: 'Aldrich', category: 'display', stack: expect.stringMatching(/^'Aldrich', /) })
    expect(fontById('aldrich')?.files.map((f) => f.weight)).toEqual([400])
    expect(fontById('roboto-condensed')?.family).toBe('Roboto Condensed')
    expect(fontById('roboto-condensed')?.files.map((f) => f.weight)).toContain(700)
    expect(isCuratedStack(fontById('aldrich')?.stack)).toBe(true)
    expect(isCuratedStack(fontById('roboto-condensed')?.stack)).toBe(true)
  })

  it('gives every family a fallback stack ending in a generic family, and no characters that could escape CSS', () => {
    for (const f of CURATED_FONTS) {
      expect(f.fallback).toMatch(/(sans-serif|serif|monospace)$/)
      expect(f.stack).toBe(`'${f.family}', ${f.fallback}`)
      expect(f.stack).not.toMatch(/[<>;{}\\"]/)
    }
    expect(fontById('merriweather')?.fallback).toMatch(/serif$/)
    expect(fontById('merriweather')?.fallback).not.toMatch(/sans-serif$/)
  })

  it('looks fonts up by id and recognises only curated stacks and addresses', () => {
    expect(fontById('inter')?.family).toBe('Inter')
    expect(fontById('Inter')).toBeUndefined()
    expect(fontById(undefined)).toBeUndefined()
    expect(isCuratedStack(fontById('inter')?.stack)).toBe(true)
    expect(isCuratedStack("'Inter', sans-serif; } body { background: red")).toBe(false)
  })

  it('cannot be modified at run time', () => {
    expect(Object.isFrozen(CURATED_FONTS)).toBe(true)
    expect(Object.isFrozen(CURATED_FONTS[0])).toBe(true)
  })
})
