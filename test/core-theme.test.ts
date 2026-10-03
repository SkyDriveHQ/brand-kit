import { describe, expect, it } from 'vitest'
import { emptyKit, type BrandKit, type Surface } from '../src/core/kit.js'
import { chooseLogo, deriveTheme, groundFor } from '../src/core/theme.js'
import { fullKit, identity, squareMark, wideLogo } from './core-fixtures.js'

const ALL: Surface[] = ['web-light', 'web-dark', 'email', 'pdf', 'print', 'tv']

describe('chooseLogo', () => {
  it('uses the agreed rendition and display size per surface', () => {
    const kit = fullKit()
    expect(chooseLogo(kit, 'web-light')).toMatchObject({ slot: 'logo', rendition: 'web2x', height: 48, width: 200, chip: false })
    expect(chooseLogo(kit, 'email')).toMatchObject({ slot: 'logo', rendition: 'email', height: 60, width: 250, chip: false })
    expect(chooseLogo(kit, 'pdf')).toMatchObject({ slot: 'logo', rendition: 'pdf', width: 1000, height: 240 })
    expect(chooseLogo(kit, 'print')).toMatchObject({ slot: 'logo', rendition: 'print', width: 2500, height: 600 })
    expect(chooseLogo(kit, 'tv')).toMatchObject({ rendition: 'web2x', height: 48 })
    expect(chooseLogo(kit, 'email')?.url).toBe(kit.logos.logo?.renditions.email?.url)
  })

  it('prefers the dark-background logo on dark surfaces, with no chip', () => {
    const kit: BrandKit = { ...fullKit(), logos: { logo: wideLogo(), logoOnDark: wideLogo({ luminance: 0.9 }) } }
    for (const s of ['web-dark', 'tv'] as const) expect(chooseLogo(kit, s)).toMatchObject({ slot: 'logoOnDark', chip: false })
    expect(chooseLogo(kit, 'web-light')?.slot).toBe('logo')
  })

  it('puts a dark transparent logo on a chip on dark surfaces only', () => {
    const kit: BrandKit = { ...emptyKit(), logos: { logo: wideLogo({ luminance: 0.1, transparent: true }) } }
    expect(chooseLogo(kit, 'web-dark')?.chip).toBe(true)
    expect(chooseLogo(kit, 'tv')?.chip).toBe(true)
    expect(chooseLogo(kit, 'web-light')?.chip).toBe(false)
    expect(chooseLogo(kit, 'email')?.chip).toBe(false)
    // Light, or opaque (it carries its own background): no chip.
    expect(chooseLogo({ ...emptyKit(), logos: { logo: wideLogo({ luminance: 0.6 }) } }, 'web-dark')?.chip).toBe(false)
    expect(chooseLogo({ ...emptyKit(), logos: { logo: wideLogo({ luminance: 0.1, transparent: false }) } }, 'tv')?.chip).toBe(false)
  })

  it('falls back to the square mark, and to text when nothing fits', () => {
    const markOnly: BrandKit = { ...emptyKit(), logos: { mark: squareMark() } }
    expect(chooseLogo(markOnly, 'web-light')).toMatchObject({ slot: 'mark', width: 48, height: 48 })
    // A mark has no print rendition; the 512 px icon is used instead.
    expect(chooseLogo(markOnly, 'print')).toMatchObject({ slot: 'mark', rendition: 'icon512', width: 512 })
    expect(chooseLogo(emptyKit(), 'web-light')).toBeNull()
    // A logo made for dark backgrounds is never drawn on a light one.
    expect(chooseLogo({ ...emptyKit(), logos: { logoOnDark: wideLogo({ luminance: 0.9 }) } }, 'web-light')).toBeNull()
  })

  it('caps very wide logos', () => {
    const logo = wideLogo()
    logo.renditions.web2x = { ...logo.renditions.web2x!, width: 1920, height: 192 }
    logo.renditions.email = { ...logo.renditions.email!, width: 1200, height: 120 }
    const kit = { ...emptyKit(), logos: { logo } }
    expect(chooseLogo(kit, 'web-light')).toMatchObject({ width: 320, height: 32 })
    expect(chooseLogo(kit, 'email')).toMatchObject({ width: 300, height: 30 })
  })
})

describe('deriveTheme', () => {
  it('builds a complete theme', () => {
    const t = deriveTheme(fullKit(), identity, { surface: 'web-light', fallbackName: 'Record name' })
    expect(t).toMatchObject({
      surface: 'web-light',
      ground: 'light',
      name: 'Skydive Testharness',
      tagline: 'Jump with us',
      website: 'https://testharness.example',
      headingFont: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      headingFontCss: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap',
      poweredBy: { label: 'Powered by SkyDrive', href: 'https://skydrive.example/' },
    })
    expect(t.colors.accent).toBe('#1a73e8')
    expect(t.problems).toEqual([])
  })

  it('gives an empty kit a complete unbranded look: the name as text, neutral colours', () => {
    for (const surface of ALL) {
      const t = deriveTheme(emptyKit(), identity, { surface, fallbackName: 'Record name' })
      expect(t.name).toBe('Record name')
      expect(t.logo).toBeNull()
      expect(t.tagline).toBeNull()
      expect(t.headingFont).toBeNull()
      expect(t.colors.accent).toMatch(/^#[0-9a-f]{6}$/)
      expect(t.problems).toEqual([])
      expect(t.ground).toBe(groundFor(surface))
    }
  })

  it('uses web fonts only on web pages', () => {
    for (const surface of ['email', 'pdf', 'print'] as const) {
      const t = deriveTheme(fullKit(), identity, { surface, fallbackName: 'x' })
      expect(t.headingFont).toBeNull()
      expect(t.headingFontCss).toBeNull()
    }
    expect(deriveTheme(fullKit(), identity, { surface: 'tv', fallbackName: 'x' }).headingFont).not.toBeNull()
  })

  it('hides the powered-by line only when told to', () => {
    expect(deriveTheme(emptyKit(), identity, { surface: 'email', fallbackName: 'x', showPoweredBy: false }).poweredBy).toBeNull()
    const noHref = { ...identity }
    delete (noHref as { poweredByHref?: string }).poweredByHref
    expect(deriveTheme(emptyKit(), noHref, { surface: 'email', fallbackName: 'x' }).poweredBy).toEqual({
      label: 'Powered by SkyDrive',
      href: null,
    })
  })

  it('reports colour repairs, status-colour warnings and a chipped logo', () => {
    const kit: BrandKit = {
      ...emptyKit(),
      logos: { logo: wideLogo({ luminance: 0.1 }) },
      colors: { primary: '#7f1d1d', secondary: '#f59e0b' },
    }
    const t = deriveTheme(kit, identity, { surface: 'tv', fallbackName: 'x' })
    expect(t.problems.map((p) => [p.field, p.severity])).toEqual([
      ['colors.primary', 'repaired'],
      ['colors.primary', 'warning'],
      ['colors.secondary', 'warning'],
      ['logos.logoOnDark', 'warning'],
    ])
    const light = deriveTheme(kit, identity, { surface: 'web-light', fallbackName: 'x' })
    // On white, the amber is also too pale to read as text; no chip on a light ground.
    expect(light.problems.map((p) => [p.field, p.severity])).toEqual([
      ['colors.secondary', 'warning'],
      ['colors.primary', 'warning'],
      ['colors.secondary', 'warning'],
    ])
  })
})
