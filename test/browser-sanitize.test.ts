// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { cleanSvgCss, sanitizeSvg } from '../src/browser/sanitize.js'
import { svgDenyScan } from '../src/core/files.js'
import { KitError } from '../src/core/validate.js'

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 40">'
const wrap = (inner: string) => `${SVG_OPEN}${inner}<rect width="10" height="10" fill="#c00"/></svg>`

/** Every hostile input must come out clean, keep its drawing, and pass the core deny scan. */
function expectClean(svg: string) {
  expect(svgDenyScan(svg)).toEqual([])
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  expect(svg).toContain('<rect')
}

describe('sanitizeSvg', () => {
  it('removes <script>', () => {
    const { svg, removed } = sanitizeSvg(wrap('<script>alert(1)</script>'))
    expect(svg).not.toMatch(/script|alert/i)
    expect(removed).toContain('<script> element')
    expectClean(svg)
  })

  it('removes onload= and other handlers, including <svg/onload>', () => {
    const a = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(1)"><rect width="1" height="1" onclick="x()"/></svg>')
    expect(a.svg).not.toMatch(/onload|onclick|alert/i)
    expect(a.removed).toEqual(expect.arrayContaining(['onload attribute on <svg>', 'onclick attribute on <rect>']))
    expectClean(a.svg)
    const b = sanitizeSvg('<svg/onload=alert(1) viewBox="0 0 1 1"><rect width="1" height="1"/></svg>')
    expect(b.svg).not.toMatch(/onload|alert/i)
    expectClean(b.svg)
  })

  it('removes <foreignObject> and everything inside it', () => {
    const { svg, removed } = sanitizeSvg(wrap('<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)">hi</div></foreignObject>'))
    expect(svg).not.toMatch(/foreignObject|<div|<img|onerror|hi</i)
    expect(removed.some((r) => /foreignobject/i.test(r))).toBe(true)
    expectClean(svg)
  })

  it('removes xlink:href to another site', () => {
    const { svg, removed } = sanitizeSvg(wrap('<image xlink:href="https://evil.example/x.png" width="5" height="5"/>'))
    expect(svg).not.toContain('evil.example')
    expect(removed).toContain('xlink:href attribute on <image>')
    expectClean(svg)
  })

  it('removes <use href="data:...">, but keeps <use> with an internal #link', () => {
    const hostile = sanitizeSvg(wrap('<use href="data:image/svg+xml;base64,PHN2Zy8+"/>'))
    expect(hostile.svg).not.toContain('data:')
    expect(hostile.removed).toContain('href attribute on <use>')
    expectClean(hostile.svg)

    const ok = sanitizeSvg(`${SVG_OPEN}<defs><circle id="dot" r="4"/></defs><use xlink:href="#dot" x="5" y="5"/><rect width="1" height="1"/></svg>`)
    expect(ok.svg).toMatch(/<use[^>]*xlink:href="#dot"/)
    expect(ok.removed).toEqual([])
    expectClean(ok.svg)
  })

  it('cleans <style>@import url(...)</style> but keeps the fills an Illustrator export puts in <style>', () => {
    const { svg, removed } = sanitizeSvg(wrap('<style>@import url(https://evil.example/x.css); .cls-1{fill:#e30613;} .cls-2{fill:url(#grad);background:url(https://evil.example/t.png)}</style>'))
    expect(svg).not.toMatch(/@import|evil\.example/)
    expect(svg).toContain('.cls-1{fill:#e30613;}')
    expect(svg).toContain('url(#grad)')
    expect(removed).toEqual(expect.arrayContaining(['@import in <style>', 'link to another file (url) in <style>']))
    expectClean(svg)
  })

  it('empties a <style> that uses CSS escapes', () => {
    const { svg, removed } = sanitizeSvg(wrap('<style>@\\69mport "x.css"; .a{fill:red}</style>'))
    expect(svg).not.toMatch(/mport|\\/)
    expect(removed).toContain('<style> block containing CSS escapes')
    expectClean(svg)
  })

  it('removes style attributes and presentation attributes that load other files', () => {
    const { svg, removed } = sanitizeSvg(wrap('<rect width="2" height="2" style="fill:url(https://evil.example/p.svg#a)"/><rect width="3" height="3" fill="url(\'https://evil.example/q\')"/><rect width="4" height="4" fill="url(#ok)" style="opacity:.5"/>'))
    expect(svg).not.toContain('evil.example')
    expect(svg).toContain('fill="url(#ok)"')
    expect(svg).toContain('style="opacity:.5"')
    expect(removed).toEqual(expect.arrayContaining(['style attribute on <rect>', 'fill attribute on <rect>']))
    expectClean(svg)
  })

  it('drops javascript: links and <a> targets but keeps the shapes inside', () => {
    const { svg } = sanitizeSvg(wrap('<a href="javascript:alert(1)"><circle r="3"/></a>'))
    expect(svg).not.toMatch(/javascript/i)
    expect(svg).toContain('<circle')
    expectClean(svg)
  })

  it('drops DOCTYPE and entity definitions', () => {
    const { svg } = sanitizeSvg(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY lol "lol">]>${wrap('<text>&lol;</text>')}`)
    expect(svg).not.toMatch(/DOCTYPE|ENTITY/i)
    expectClean(svg)
  })

  it('adds the SVG namespace when the file left it out, so the browser can load it as an image', () => {
    const { svg } = sanitizeSvg('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
    expect(parsed.getElementsByTagName('parsererror').length).toBe(0)
    expect(parsed.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg')
  })

  it('refuses text that is not an SVG', () => {
    expect(() => sanitizeSvg('<html><body>hello</body></html>')).toThrow(KitError)
    expect(() => sanitizeSvg('just text')).toThrow(KitError)
    try {
      sanitizeSvg('<div>no</div>')
    } catch (e) {
      expect((e as KitError).problems[0]?.severity).toBe('refused')
    }
  })

  it('refuses two top-level images', () => {
    expect(() => sanitizeSvg('<svg viewBox="0 0 1 1"></svg><svg viewBox="0 0 1 1"></svg>')).toThrow(KitError)
  })
})

describe('cleanSvgCss', () => {
  it('drops comments, @import and external url(), keeping #fragment urls', () => {
    const r = cleanSvgCss('/* url(https://x) */ @import "a.css"; .a{fill:url( "#g" )} .b{mask:url(https://x/y)}')
    expect(r.css).not.toMatch(/https|@import/)
    expect(r.css).toContain('url( "#g" )')
    expect(r.css).toContain('mask:none')
  })

  it('empties CSS that loads files without url()', () => {
    expect(cleanSvgCss('.a{background:image-set("x.png" 1x)}').css).toBe('')
    expect(cleanSvgCss('.a{-moz-binding:foo}').css).toBe('')
  })

  it('leaves plain fills alone', () => {
    expect(cleanSvgCss('.cls-1{fill:#fff}')).toEqual({ css: '.cls-1{fill:#fff}', removed: [] })
  })
})
