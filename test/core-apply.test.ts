import { describe, expect, it } from 'vitest'
import {
  THEME_CSS_VARS,
  applyThemeToElement,
  emailFooterHtml,
  emailHeaderHtml,
  escapeHtml,
  isSafeSelector,
  pdfLogo,
  themeCssText,
  themeCssVars,
} from '../src/core/apply.js'
import { emptyKit, type BrandKit, type BrandTheme } from '../src/core/kit.js'
import { deriveTheme } from '../src/core/theme.js'
import { fullKit, identity, wideLogo } from './core-fixtures.js'

function theme(kit: BrandKit = fullKit(), surface: BrandTheme['surface'] = 'web-light'): BrandTheme {
  return deriveTheme(kit, identity, { surface, fallbackName: 'Record name' })
}

/** A theme altered after deriveTheme, as an attacker (or a bug) might. */
function poisoned(): BrandTheme {
  const t = theme()
  return {
    ...t,
    name: '"><script>alert(1)</script>',
    tagline: '</td></tr></table><img src=x onerror=alert(1)>',
    website: 'javascript:alert(1)',
    colors: {
      accent: 'red;}</style><script>alert(1)</script>',
      accentInk: '#000000"><script>',
      accentHover: 'expression(alert(1))',
      accentSoft: 'var(--x)',
      secondary: '</style>',
      secondaryInk: 'url(javascript:alert(1))',
    },
    headingFont: "x;}</style><script>alert(1)</script>",
    headingFontCss: 'https://evil.example/x.css',
    logo: { slot: 'logo', rendition: 'email', url: 'javascript:alert(1)', width: 100, height: 50, chip: false },
    poweredBy: { label: '<b>Powered</b>', href: 'javascript:alert(1)' },
  }
}

describe('escapeHtml', () => {
  it('escapes the five HTML specials and the backtick', () => {
    expect(escapeHtml(`<a href="x" title='y'>&\`</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&#96;&lt;/a&gt;')
  })
})

describe('CSS variables', () => {
  it('covers every variable for a full theme', () => {
    const vars = themeCssVars(theme())
    expect(Object.keys(vars).sort()).toEqual([...THEME_CSS_VARS].sort())
    expect(vars['--brand-accent']).toBe('#1a73e8')
  })

  it('omits secondary and font when the theme has none', () => {
    const vars = themeCssVars(theme(emptyKit()))
    expect(Object.keys(vars).sort()).toEqual(['--brand-accent', '--brand-accent-hover', '--brand-accent-ink', '--brand-accent-soft'])
  })

  it('writes a plain rule', () => {
    const css = themeCssText(theme(emptyKit()))
    expect(css).toMatch(/^:root\{--brand-accent:#[0-9a-f]{6};--brand-accent-ink:#[0-9a-f]{6};--brand-accent-hover:#[0-9a-f]{6};--brand-accent-soft:#[0-9a-f]{6};\}$/)
    expect(themeCssText(theme(emptyKit()), '.bk-preview [data-surface="tv"]')).toMatch(/^\.bk-preview \[data-surface="tv"\]\{/)
  })

  it('drops every hostile value so nothing can break out of a <style> element', () => {
    const t = poisoned()
    expect(themeCssVars(t)).toEqual({})
    const css = themeCssText(t)
    expect(css).toBe(':root{}')
    expect(css).not.toMatch(/[<>]/)
    // And a real theme's text never contains anything but the rule.
    const real = themeCssText(theme())
    expect(real).not.toMatch(/[<>@\\]/)
    expect(real.match(/\{/g)).toHaveLength(1)
    expect(real.match(/\}/g)).toHaveLength(1)
  })

  it('refuses a hostile or complex selector', () => {
    for (const bad of ['</style><script>', ':root{}body', 'a,b', ':root;', '* ', '', 'a  b', 'a > b', '[onclick="x"]', 'a'.repeat(201), '\n:root']) {
      expect(isSafeSelector(bad), bad).toBe(false)
      expect(() => themeCssText(theme(), bad)).toThrow()
    }
    for (const ok of [':root', '.bk-preview', '#brand', 'html', 'div.bk-x', '[data-brand]', '.a .b', 'body.dark #app']) {
      expect(isSafeSelector(ok), ok).toBe(true)
    }
  })

  it('rejects a long hostile selector quickly', () => {
    const start = Date.now()
    expect(isSafeSelector('a'.repeat(199) + '!')).toBe(false)
    expect(isSafeSelector('.a'.repeat(99) + '!')).toBe(false)
    expect(Date.now() - start).toBeLessThan(200)
  })

  it('applies to an element and removes variables the new theme does not set', () => {
    const set = new Map<string, string>()
    const el = { style: { setProperty: (k: string, v: string) => void set.set(k, v), removeProperty: (k: string) => void set.delete(k) } }
    applyThemeToElement(theme(), el)
    expect(set.size).toBe(7)
    expect(set.get('--brand-secondary')).toBe('#0f9d58')
    applyThemeToElement(theme(emptyKit()), el)
    expect([...set.keys()].sort()).toEqual(['--brand-accent', '--brand-accent-hover', '--brand-accent-ink', '--brand-accent-soft'])
    expect(set.has('--brand-secondary')).toBe(false)
    expect(set.has('--brand-font-heading')).toBe(false)
  })
})

describe('email header', () => {
  const emailTheme = () => theme(fullKit(), 'email')

  it('uses tables, inline styles and bgcolor, and nothing email clients cannot show', () => {
    for (const html of [emailHeaderHtml(emailTheme()), emailFooterHtml(emailTheme()), emailHeaderHtml(theme(emptyKit(), 'email'))]) {
      expect(html.startsWith('<table role="presentation"')).toBe(true)
      expect(html).toContain('bgcolor="#')
      expect(html).not.toMatch(/var\(|--brand|<style|<svg|data:|<link|class=|<script/i)
      // Every colour written is a strict hex.
      for (const m of html.matchAll(/(?:bgcolor="|background-color:|color:)([^";]+)/g)) expect(m[1]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('draws the logo as an <img> with explicit size, alt and display:block, in a cell with its own background', () => {
    const t = emailTheme()
    const html = emailHeaderHtml(t)
    const logo = t.logo!
    expect(html).toContain(
      `<img src="${logo.url}" width="${logo.width}" height="${logo.height}" alt="Skydive Testharness" style="display:block;border:0">`,
    )
    expect(html).toMatch(/<td align="center" bgcolor="#ffffff" style="background-color:#ffffff;padding:0;"><img /)
    expect(html).toContain('Jump with us')
  })

  it('draws the logo on a light rounded panel when the theme asks for a chip', () => {
    const t = theme({ ...emptyKit(), logos: { logo: wideLogo({ luminance: 0.05 }) } }, 'tv')
    expect(t.logo?.chip).toBe(true)
    const html = emailHeaderHtml(t)
    expect(html).toMatch(/<td align="center" bgcolor="#ffffff" style="background-color:#ffffff;padding:8px 12px;border-radius:8px;"><img /)
    // The surrounding ground is dark.
    expect(html).toContain('bgcolor="#111111"')
  })

  it('draws the name as text when there is no logo', () => {
    const html = emailHeaderHtml(theme(emptyKit(), 'email'))
    expect(html).not.toContain('<img')
    expect(html).toContain('>Record name</td>')
  })

  it('cannot be broken out of by hostile text, addresses or colours', () => {
    const t = poisoned()
    const header = emailHeaderHtml(t)
    const footer = emailFooterHtml(t)
    for (const html of [header, footer]) {
      // No hostile tag survives, and no hostile attribute appears inside any real tag.
      expect(html).not.toMatch(/<script|<img src=x|<b>|<\/style>/i)
      for (const tag of html.match(/<[^>]*>/g) ?? []) expect(tag).not.toMatch(/onerror|javascript:|expression\(|<script/i)
    }
    // The javascript: logo address is refused, so the (escaped) name is drawn instead.
    expect(header).not.toContain('<img')
    expect(header).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(header).toContain('&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;')
    // The javascript: website is left out, and the bad powered-by link becomes plain text.
    expect(footer).not.toContain('<a ')
    expect(footer).toContain('&lt;b&gt;Powered&lt;/b&gt;')
  })

  it('escapes a hostile name inside the alt attribute', () => {
    const t = emailTheme()
    const html = emailHeaderHtml({ ...t, name: '" onerror="alert(1)' })
    expect(html).toContain('alt="&quot; onerror=&quot;alert(1)"')
  })

  it('refuses image addresses with tricks in them', () => {
    const t = emailTheme()
    for (const url of [
      'http://abcd.supabase.co/x.png',
      'https://abcd.supabase.co/x.svg',
      'https://abcd.supabase.co/x.png?x=1',
      'https://user@abcd.supabase.co/x.png',
      'https://abcd.supabase.co/../x.png',
      'https://abcd.supabase.co/a"b.png',
      'data:image/png;base64,AAAA',
    ]) {
      expect(emailHeaderHtml({ ...t, logo: { ...t.logo!, url } }), url).not.toContain('<img')
    }
  })
})

describe('email footer', () => {
  it('carries the website as text and the powered-by line as a link', () => {
    const html = emailFooterHtml(theme(fullKit(), 'email'))
    expect(html).toContain('>https://testharness.example</td>')
    expect(html).toContain('<a href="https://skydrive.example/" style="color:#5f6368;text-decoration:underline;">Powered by SkyDrive</a>')
  })
  it('leaves out the powered-by line when the theme has none', () => {
    const t = deriveTheme(fullKit(), identity, { surface: 'email', fallbackName: 'x', showPoweredBy: false })
    expect(emailFooterHtml(t)).not.toContain('Powered by')
  })
})

describe('pdfLogo', () => {
  it('returns the PDF rendition at true size with its ratio', () => {
    const t = theme(fullKit(), 'pdf')
    expect(pdfLogo(t)).toEqual({ url: t.logo!.url, width: 1000, height: 240, ratio: 1000 / 240 })
  })
  it('returns null with no logo or an unsafe address', () => {
    expect(pdfLogo(theme(emptyKit(), 'pdf'))).toBeNull()
    expect(pdfLogo(poisoned())).toBeNull()
  })
})
