import { describe, expect, it } from 'vitest'
import { CURATED_FONTS, fontById, isCuratedCssUrl, isCuratedStack } from '../src/core/fonts.js'

describe('CURATED_FONTS', () => {
  it('holds about a dozen fonts across sans, serif and display, with unique ids', () => {
    expect(CURATED_FONTS.length).toBeGreaterThanOrEqual(10)
    expect(CURATED_FONTS.length).toBeLessThanOrEqual(16)
    expect(new Set(CURATED_FONTS.map((f) => f.id)).size).toBe(CURATED_FONTS.length)
    const cats = new Set(CURATED_FONTS.map((f) => f.category))
    for (const c of ['sans', 'serif', 'display']) expect(cats.has(c as never)).toBe(true)
  })

  it('uses well-formed Google Fonts css2 addresses', () => {
    for (const f of CURATED_FONTS) {
      expect(f.id).toMatch(/^[a-z0-9-]+$/)
      expect(f.cssUrl).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=[A-Za-z0-9+]+(?::wght@[0-9;]+)?&display=swap$/)
      expect(f.cssUrl).toContain(`family=${f.family.replace(/ /g, '+')}`)
    }
    expect(fontById('open-sans')?.cssUrl).toBe('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap')
    expect(fontById('bebas-neue')?.cssUrl).toBe('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap')
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
    expect(isCuratedCssUrl(fontById('lato')?.cssUrl)).toBe(true)
    expect(isCuratedCssUrl('https://evil.example/x.css')).toBe(false)
  })

  it('cannot be modified at run time', () => {
    expect(Object.isFrozen(CURATED_FONTS)).toBe(true)
    expect(Object.isFrozen(CURATED_FONTS[0])).toBe(true)
  })
})
