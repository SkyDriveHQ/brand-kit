import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  deriveColors,
  ensureContrast,
  hexToOklch,
  inkFor,
  oklchToHex,
  parseHex,
  relativeLuminance,
  statusColourWarning,
} from '../src/core/color.js'

/** Deterministic pseudo-random hex colours. */
function randomHexes(n: number, seed = 42): string[] {
  let s = seed
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    out.push(`#${(s & 0xffffff).toString(16).padStart(6, '0')}`)
  }
  return out
}

const JARGON = /wcag|oklch|chroma|\bhue\b|luminance|contrast ratio/i

describe('parseHex', () => {
  it('normalises 3-digit, upper-case, bare and padded input', () => {
    expect(parseHex('#abc')).toBe('#aabbcc')
    expect(parseHex('#AABBCC')).toBe('#aabbcc')
    expect(parseHex('1A73E8')).toBe('#1a73e8')
    expect(parseHex('  #1a73e8 ')).toBe('#1a73e8')
  })
  it('refuses everything that is not hex', () => {
    for (const bad of ['red', 'rgb(0,0,0)', '#abcd', '#12345g', '', '#1a73e8;}</style>', 'url(x)', '#1a73e8 !important']) {
      expect(parseHex(bad)).toBeNull()
    }
    expect(parseHex(42 as unknown as string)).toBeNull()
  })
})

describe('luminance and contrast (WCAG 2)', () => {
  it('matches the known end points', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
    // A well-known value: #767676 on white is 4.54:1.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
  })
  it('inkFor picks the more readable of black and white', () => {
    expect(inkFor('#000000')).toBe('#ffffff')
    expect(inkFor('#ffff00')).toBe('#000000')
    expect(inkFor('#1a73e8')).toBe('#ffffff')
  })
  it('black or white always reaches 4.5:1 on any grey (so the accent-adjust branch is defence only)', () => {
    for (let v = 0; v < 256; v++) {
      const g = `#${v.toString(16).padStart(2, '0').repeat(3)}`
      expect(Math.max(contrastRatio(g, '#000000'), contrastRatio(g, '#ffffff'))).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('OKLCH', () => {
  it('round-trips hex within one step per channel', () => {
    for (const h of [...randomHexes(200), '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff']) {
      const back = oklchToHex(hexToOklch(h))
      for (let i = 1; i < 7; i += 2) {
        expect(Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(h.slice(i, i + 2), 16))).toBeLessThanOrEqual(1)
      }
    }
  })
  it('knows where pure red and blue sit', () => {
    expect(hexToOklch('#ff0000').h).toBeCloseTo(29.2, 0)
    expect(hexToOklch('#ff0000').l).toBeCloseTo(0.628, 2)
    expect(hexToOklch('#0000ff').h).toBeCloseTo(264, 0)
  })
  it('brings out-of-gamut colours inside by lowering chroma, keeping hue', () => {
    const out = oklchToHex({ l: 0.7, c: 0.5, h: 150 })
    expect(out).toMatch(/^#[0-9a-f]{6}$/)
    expect(Math.abs(hexToOklch(out).h - 150)).toBeLessThan(3)
    expect(hexToOklch(out).l).toBeCloseTo(0.7, 1)
  })
  it('clamps silly input to a valid colour', () => {
    expect(oklchToHex({ l: 2, c: -1, h: 720 })).toBe('#ffffff')
    expect(oklchToHex({ l: Number.NaN, c: 0, h: 0 })).toBe('#000000')
  })
})

describe('ensureContrast', () => {
  it('returns the colour unchanged when it already passes', () => {
    expect(ensureContrast('#000000', '#ffffff', 4.5)).toBe('#000000')
  })
  it('moves lightness until the pair passes, keeping roughly the same hue', () => {
    for (const fg of ['#1e3a8a', '#7f1d1d', '#14532d', '#4c1d95']) {
      const out = ensureContrast(fg, '#111111', 4.5)
      expect(contrastRatio(out, '#111111')).toBeGreaterThanOrEqual(4.5)
      const dh = Math.abs(hexToOklch(out).h - hexToOklch(fg).h)
      expect(Math.min(dh, 360 - dh)).toBeLessThan(15)
    }
  })
  it('passes for random pairs whenever black or white could', () => {
    const hexes = randomHexes(120, 7)
    for (let i = 0; i + 1 < hexes.length; i += 2) {
      const fg = hexes[i] as string
      const bg = hexes[i + 1] as string
      const out = ensureContrast(fg, bg, 3)
      const best = Math.max(contrastRatio('#000000', bg), contrastRatio('#ffffff', bg))
      if (best >= 3) expect(contrastRatio(out, bg)).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('deriveColors', () => {
  it('guarantees accentInk at 4.5:1 on accent, and a visible accent on dark, for any colour', () => {
    for (const h of randomHexes(400, 99)) {
      for (const ground of ['light', 'dark'] as const) {
        const { colors } = deriveColors({ primary: h, secondary: h }, '#2563eb', ground)
        expect(contrastRatio(colors.accentInk, colors.accent)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(colors.accentInk, colors.accentHover)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(colors.secondaryInk as string, colors.secondary as string)).toBeGreaterThanOrEqual(4.5)
        if (ground === 'dark') expect(contrastRatio(colors.accent, '#111111')).toBeGreaterThanOrEqual(3)
        for (const v of Object.values(colors)) expect(v).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('lightens a navy for a dark screen and says so in plain English', () => {
    const { colors, problems } = deriveColors({ primary: '#1e3a8a' }, '#2563eb', 'dark')
    expect(colors.accent).not.toBe('#1e3a8a')
    expect(contrastRatio(colors.accent, '#111111')).toBeGreaterThanOrEqual(3)
    expect(problems).toEqual([
      {
        field: 'colors.primary',
        severity: 'repaired',
        message: 'Your brand colour is too dark to see on a dark screen, so a lighter shade of it is used there.',
      },
    ])
  })

  it('leaves a colour that is already visible alone', () => {
    const { colors, problems } = deriveColors({ primary: '#3b82f6' }, '#2563eb', 'dark')
    expect(colors.accent).toBe('#3b82f6')
    expect(problems).toEqual([])
    expect(deriveColors({ primary: '#1e3a8a' }, '#2563eb', 'light').colors.accent).toBe('#1e3a8a')
  })

  it('uses the product fallback without blaming the customer for it', () => {
    const { colors, problems } = deriveColors({}, '#0b1020', 'dark')
    expect(contrastRatio(colors.accent, '#111111')).toBeGreaterThanOrEqual(3)
    expect(problems).toEqual([])
    expect(deriveColors({}, '#2563eb', 'light').colors.accent).toBe('#2563eb')
    expect(deriveColors({}, 'not a colour', 'light').colors.accent).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('warns, without changing it, when a brand colour is too pale for a white page', () => {
    const { colors, problems } = deriveColors({ primary: '#fef08a' }, '#2563eb', 'light')
    expect(colors.accent).toBe('#fef08a')
    expect(colors.accentInk).toBe('#000000')
    expect(problems.map((p) => p.severity)).toEqual(['warning'])
  })

  it('repairs the second colour separately, with its own field', () => {
    const { colors, problems } = deriveColors({ primary: '#3b82f6', secondary: '#1a1a40' }, '#2563eb', 'dark')
    expect(colors.secondary).not.toBe('#1a1a40')
    expect(problems.map((p) => p.field)).toEqual(['colors.secondary'])
    expect(problems[0]?.message).toMatch(/^Your second brand colour is too dark/)
  })

  it('derives a pale tint on light and a deep one on dark, and no secondary when none is given', () => {
    const light = deriveColors({ primary: '#1a73e8' }, '#2563eb', 'light').colors
    const dark = deriveColors({ primary: '#1a73e8' }, '#2563eb', 'dark').colors
    expect(relativeLuminance(light.accentSoft)).toBeGreaterThan(0.8)
    expect(relativeLuminance(dark.accentSoft)).toBeLessThan(0.1)
    expect(light.secondary).toBeNull()
    expect(light.secondaryInk).toBeNull()
  })

  it('never uses jargon in its messages', () => {
    for (const h of randomHexes(100, 3)) {
      for (const ground of ['light', 'dark'] as const) {
        for (const p of deriveColors({ primary: h, secondary: h }, '#2563eb', ground).problems) {
          expect(p.message).not.toMatch(JARGON)
        }
      }
    }
  })
})

describe('statusColourWarning', () => {
  it('warns on a red', () => {
    const w = statusColourWarning('#dc2626')
    expect(w?.severity).toBe('warning')
    expect(w?.field).toBe('colors.primary')
    expect(w?.message).toMatch(/red used for errors/)
    expect(statusColourWarning('#ff0000')).not.toBeNull()
  })
  it('warns on an amber', () => {
    const w = statusColourWarning('#f59e0b')
    expect(w?.severity).toBe('warning')
    expect(w?.message).toMatch(/amber used for cautions/)
  })
  it('does not warn on a blue, a green, a grey or a dull brown-red', () => {
    expect(statusColourWarning('#2563eb')).toBeNull()
    expect(statusColourWarning('#16a34a')).toBeNull()
    expect(statusColourWarning('#808080')).toBeNull()
    expect(statusColourWarning('#6b5a58')).toBeNull()
  })
  it('names the second colour when asked, ignores non-hex, and avoids jargon', () => {
    expect(statusColourWarning('#dc2626', 'colors.secondary')?.message).toMatch(/^Your second brand colour/)
    expect(statusColourWarning('red')).toBeNull()
    expect(statusColourWarning('#dc2626')?.message).not.toMatch(JARGON)
    expect(statusColourWarning('#f59e0b')?.message).not.toMatch(JARGON)
  })
})

describe('integration fixes (2026-10-02)', () => {
  it('on a dark ground the hover shade stays visible and the ink stays readable, for any colour', async () => {
    const { deriveColors, contrastRatio, DARK_GROUND } = await import('../src/core/color.js')
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let i = 0; i < 400; i++) {
      const hex = '#' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')
      const { colors } = deriveColors({ primary: hex }, '#2563eb', 'dark')
      expect(contrastRatio(colors.accentHover, DARK_GROUND)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(colors.accentHover, colors.accentInk)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('magenta-reds are warned about like reds', async () => {
    const { statusColourWarning } = await import('../src/core/color.js')
    expect(statusColourWarning('#dc143c')?.message).toMatch(/red/) // crimson
    expect(statusColourWarning('#e3256b')?.message).toMatch(/red/) // raspberry
    expect(statusColourWarning('#7c3aed')).toBeNull() // violet
  })
})
