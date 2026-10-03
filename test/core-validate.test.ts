import { describe, expect, it } from 'vitest'
import { emptyKit } from '../src/core/kit.js'
import { KitError, assertKit, cleanText, isValidWebsite, parseKit } from '../src/core/validate.js'
import { fullKit, rules, sha, wideLogo } from './core-fixtures.js'

const JARGON = /wcag|oklch|chroma|sha-?256|regex|null|undefined|schema/i

function strict(input: unknown) {
  return parseKit(input, rules, 'strict')
}

describe('parseKit: whole kits', () => {
  it('passes a complete, valid kit through unchanged with no problems', () => {
    const { kit, problems } = strict(fullKit())
    expect(problems).toEqual([])
    expect(kit).toEqual(fullKit())
  })

  it('treats an empty kit as valid', () => {
    expect(strict(emptyKit())).toEqual({ kit: emptyKit(), problems: [] })
    expect(strict({})).toEqual({ kit: emptyKit(), problems: [] })
  })

  it('drops unknown keys, including prototype tricks, at every level', () => {
    const input = JSON.parse(
      JSON.stringify({ ...fullKit(), extra: 1, colors: { primary: '#1a73e8', css: 'x' } }).replace(
        '"extra":1',
        '"extra":1,"__proto__":{"polluted":true},"constructor":{"x":1}',
      ),
    ) as Record<string, unknown>
    const { kit, problems } = strict(input)
    expect(problems).toEqual([])
    expect(Object.keys(kit).sort()).toEqual(['colors', 'fonts', 'guide', 'logos', 'name', 'schemaVersion', 'tagline', 'website'])
    expect(kit.colors).toEqual({ primary: '#1a73e8' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('refuses something that is not a kit at all', () => {
    for (const bad of [null, 'kit', 42, [1, 2]]) {
      const { kit, problems } = strict(bad)
      expect(kit).toEqual(emptyKit())
      expect(problems.map((p) => p.severity)).toEqual(['refused'])
    }
  })

  it('refuses a newer schema version in strict mode only', () => {
    expect(strict({ ...fullKit(), schemaVersion: 2 }).problems.map((p) => p.field)).toEqual(['schemaVersion'])
    expect(parseKit({ ...fullKit(), schemaVersion: 2 }, rules, 'lenient').kit.name).toBe('Skydive Testharness')
  })

  it('throws on malformed storage rules (a product bug, not customer data)', () => {
    expect(() => parseKit(fullKit(), { ...rules, storageOrigin: 'abcd.supabase.co' }, 'lenient')).toThrow()
  })
})

describe('parseKit: colours', () => {
  it('normalises 3-digit and upper-case hex, reporting it as repaired', () => {
    const { kit, problems } = strict({ ...emptyKit(), colors: { primary: '#ABC', secondary: '#0F9D58' } })
    expect(kit.colors).toEqual({ primary: '#aabbcc', secondary: '#0f9d58' })
    expect(problems.map((p) => [p.field, p.severity])).toEqual([
      ['colors.primary', 'repaired'],
      ['colors.secondary', 'repaired'],
    ])
    expect(problems[0]?.message).toBe('Your brand colour was written as "#ABC". It is saved as #aabbcc, which is the same colour.')
  })

  it('refuses anything that is not hex, including CSS injection', () => {
    for (const bad of ['red', 'rgb(1,2,3)', '#1a73e8;}</style><script>alert(1)</script>', 'url(javascript:alert(1))', 7]) {
      const { kit, problems } = strict({ ...emptyKit(), colors: { primary: bad } })
      expect(kit.colors).toEqual({})
      expect(problems).toHaveLength(1)
      expect(problems[0]?.severity).toBe('refused')
      expect(problems[0]?.message).toMatch(/six-digit code such as #1a73e8/)
    }
  })
})

describe('parseKit: text', () => {
  it('trims, collapses whitespace and removes invisible characters', () => {
    const { kit, problems } = strict({ ...emptyKit(), name: '  Skydive \n\t Testharness‮​ ', tagline: '   ' })
    expect(kit.name).toBe('Skydive Testharness')
    expect(kit.tagline).toBeUndefined()
    expect(problems).toEqual([])
    expect(cleanText('a\u0000b')).toBe('a b')
  })

  it('refuses over-long text in strict mode and shortens it in lenient mode', () => {
    const long = 'x'.repeat(81)
    const s = strict({ ...emptyKit(), name: long })
    expect(s.kit.name).toBeUndefined()
    expect(s.problems[0]).toMatchObject({ field: 'name', severity: 'refused' })
    expect(s.problems[0]?.message).toBe('Your business name is 81 characters long. The most that fits is 80, so please shorten it.')
    const l = parseKit({ ...emptyKit(), name: long }, rules, 'lenient')
    expect(l.kit.name).toBe('x'.repeat(80))
    expect(l.problems).toEqual([])
    expect(strict({ ...emptyKit(), tagline: 'y'.repeat(121) }).problems[0]?.field).toBe('tagline')
  })

  it('keeps hostile text as plain text (escaping happens where it is drawn)', () => {
    expect(strict({ ...emptyKit(), name: '"><script>alert(1)</script>' }).kit.name).toBe('"><script>alert(1)</script>')
  })

  it('refuses text that is not a string', () => {
    expect(strict({ ...emptyKit(), name: { toString: 1 } }).problems[0]?.severity).toBe('refused')
  })
})

describe('parseKit: website', () => {
  it('accepts a bare host or an http(s) address', () => {
    for (const ok of [
      'testharness.example',
      'www.testharness.example/tandem',
      'https://testharness.example',
      'http://testharness.example/a?b=c#d',
      'HTTPS://Testharness.Example',
      'testharness.example:8080',
      'xn--bcher-kva.example',
    ]) {
      expect(isValidWebsite(ok), ok).toBe(true)
      expect(strict({ ...emptyKit(), website: ok }).kit.website).toBe(ok)
    }
  })

  it('refuses javascript:, data: and other tricks', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)//testharness.example',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'ftp://testharness.example',
      'https://testharness.example@evil.example',
      'https://testharness.example"><script>',
      'testharness.example"onmouseover="alert(1)',
      '//evil.example',
      'https://',
      'localhost',
      'testharness .example',
      'https://testharness.example/<script>',
    ]) {
      const { kit, problems } = strict({ ...emptyKit(), website: bad })
      expect(kit.website, bad).toBeUndefined()
      expect(problems[0]?.severity, bad).toBe('refused')
    }
  })
})

describe('parseKit: logos and files', () => {
  it('refuses a rendition at a hostile address and keeps the rest of the logo', () => {
    const logo = wideLogo()
    const input = fullKit()
    input.logos = { logo: { ...logo, renditions: { ...logo.renditions, email: { ...logo.renditions.email!, url: 'https://evil.example/x.png' } } } }
    const { kit, problems } = strict(input)
    expect(kit.logos.logo?.renditions.email).toBeUndefined()
    expect(kit.logos.logo?.renditions.web2x).toBeDefined()
    expect(problems).toEqual([
      {
        field: 'logos.logo.renditions.email.url',
        severity: 'refused',
        message: "Your logo points at an image that is not stored with your business's brand files, so it was not used.",
      },
    ])
  })

  it('refuses a rendition whose fingerprint does not match its file name', () => {
    const logo = wideLogo()
    const input = { ...emptyKit(), logos: { logo: { ...logo, renditions: { web: { ...logo.renditions.web!, sha256: sha('other') } } } } }
    const { kit, problems } = strict(input)
    expect(kit.logos.logo).toBeUndefined()
    expect(problems.map((p) => p.field)).toEqual(['logos.logo.renditions.web.sha256', 'logos.logo.renditions'])
  })

  it('refuses a logo whose original belongs to another tenant, or that has no usable images', () => {
    const logo = wideLogo()
    const other = strict({ ...emptyKit(), logos: { logo: { ...logo, originalPath: logo.originalPath.replace('tenant-1', 'tenant-2') } } })
    expect(other.kit.logos).toEqual({})
    expect(other.problems[0]?.field).toBe('logos.logo.originalPath')
    const traversal = strict({ ...emptyKit(), logos: { logo: { ...logo, originalPath: 'tenant-1/../tenant-2/x.png' } } })
    expect(traversal.kit.logos).toEqual({})
    const empty = strict({ ...emptyKit(), logos: { logo: { ...logo, renditions: {} } } })
    expect(empty.problems[0]?.field).toBe('logos.logo.renditions')
  })

  it('refuses bad measurements, types and slots', () => {
    const logo = wideLogo()
    expect(strict({ ...emptyKit(), logos: { logo: { ...logo, aspect: Number.NaN } } }).kit.logos).toEqual({})
    expect(strict({ ...emptyKit(), logos: { logo: { ...logo, tone: { luminance: 2, transparent: true } } } }).kit.logos).toEqual({})
    expect(strict({ ...emptyKit(), logos: { logo: { ...logo, originalType: 'text/html' } } }).kit.logos).toEqual({})
    // An unknown slot is an unknown key: dropped without a problem.
    expect(strict({ ...emptyKit(), logos: { banner: logo } })).toEqual({ kit: emptyKit(), problems: [] })
  })

  it('refuses a font that is not curated', () => {
    const { kit, problems } = strict({ ...emptyKit(), fonts: { heading: "Comic Sans'; } body { x" } })
    expect(kit.fonts).toEqual({})
    expect(problems[0]).toMatchObject({ field: 'fonts.heading', severity: 'refused' })
  })

  it('checks the brand guide', () => {
    const guide = fullKit().guide!
    expect(strict({ ...emptyKit(), guide }).kit.guide).toEqual(guide)
    expect(strict({ ...emptyKit(), guide: { ...guide, path: guide.path.replace('tenant-1', 'tenant-2') } }).kit.guide).toBeUndefined()
    expect(strict({ ...emptyKit(), guide: { ...guide, path: guide.path.replace('.pdf', '.html') } }).kit.guide).toBeUndefined()
    expect(strict({ ...emptyKit(), guide: { ...guide, bytes: 26 * 1024 * 1024 } }).kit.guide).toBeUndefined()
    expect(strict({ ...emptyKit(), guide: { ...guide, uploadedAt: 'yesterday' } }).kit.guide).toBeUndefined()
  })
})

describe('parseKit: lenient', () => {
  it('drops bad fields silently and keeps the good ones', () => {
    const input = { ...fullKit(), colors: { primary: 'red', secondary: '#ABC' }, website: 'javascript:alert(1)', fonts: { heading: 'nope' } }
    const { kit, problems } = parseKit(input, rules, 'lenient')
    expect(problems).toEqual([])
    expect(kit.colors).toEqual({ secondary: '#aabbcc' })
    expect(kit.website).toBeUndefined()
    expect(kit.fonts).toEqual({})
    expect(kit.name).toBe('Skydive Testharness')
    expect(kit.logos.logo).toBeDefined()
  })
})

describe('assertKit', () => {
  it('returns the kit when nothing was refused, even with repairs', () => {
    expect(assertKit({ ...emptyKit(), colors: { primary: '#ABC' } }, rules).colors.primary).toBe('#aabbcc')
  })
  it('throws KitError carrying every problem when something was refused', () => {
    try {
      assertKit({ ...emptyKit(), colors: { primary: 'red', secondary: '#ABC' } }, rules)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(KitError)
      const err = e as KitError
      expect(err.problems.map((p) => p.severity)).toEqual(['refused', 'repaired'])
      expect(err.message).toBe(err.problems[0]?.message)
    }
  })
})

describe('messages', () => {
  it('are plain English with no jargon', () => {
    const logo = wideLogo()
    const inputs: unknown[] = [
      null,
      { ...emptyKit(), schemaVersion: 9 },
      { ...emptyKit(), name: 'x'.repeat(200), tagline: 5, website: 'javascript:x', colors: { primary: 'red', secondary: '#ABC' } },
      { ...emptyKit(), website: 'x"><script>alert(1)</script>', colors: { primary: '#1a73e8;}</style><script>' } },
      { ...emptyKit(), fonts: { heading: 'x' }, guide: { path: 'x' } },
      { ...emptyKit(), logos: { logo: { ...logo, renditions: { web: { ...logo.renditions.web!, url: 'https://x.example/a.png' } } } } },
      { ...emptyKit(), logos: { mark: 'x', logoOnDark: { ...logo, aspect: 0 } } },
    ]
    for (const input of inputs) {
      for (const p of strict(input).problems) {
        expect(p.message).not.toMatch(JARGON)
        expect(p.message).toMatch(/^[A-Z"]/)
        expect(p.message).toMatch(/\.$/)
        // Customer input is echoed only when it is plain, so a message is safe to show anywhere.
        expect(p.message).not.toMatch(/[<>{};]/)
      }
    }
  })
})

describe('logo palette (kept so colour suggestions survive a reload)', () => {
  it('keeps good entries, normalises hex, drops bad ones quietly and caps the list', async () => {
    const { parseKit } = await import('../src/core/validate.js')
    const { emptyKit, PALETTE_KEEP } = await import('../src/core/kit.js')
    const { rules, wideLogo } = await import('./core-fixtures.js')
    const palette = [
      { hex: '#0B3D91', share: 0.9 },
      { hex: 'red', share: 0.1 },
      { hex: '#e8a33d', share: 2 },
      { hex: '#e8a33d', share: 0.05 },
      { hex: '#0b3d91', share: 0.01 },
      ...Array.from({ length: 20 }, (_, i) => ({ hex: `#0000${(i + 16).toString(16)}`, share: 0.001 })),
    ]
    const strict = parseKit({ ...emptyKit(), logos: { logo: { ...wideLogo(), palette } } }, rules, 'strict')
    const kept = strict.kit.logos.logo!.palette!
    expect(kept[0]).toEqual({ hex: '#0b3d91', share: 0.9 })
    expect(kept[1]).toEqual({ hex: '#e8a33d', share: 0.05 })
    expect(kept).toHaveLength(PALETTE_KEEP)
    expect(strict.problems.filter((p) => p.severity === 'refused')).toEqual([])
    const none = parseKit({ ...emptyKit(), logos: { logo: { ...wideLogo(), palette: 'nope' } } }, rules, 'strict')
    expect(none.kit.logos.logo!.palette).toBeUndefined()
  })
})
