// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  placement,
  rasterAnalysisSize,
  renditionLayout,
  svgAnalysisSize,
  svgIntrinsicSize,
  svgWithSize,
} from '../src/browser/rasterise.js'

describe('renditionLayout', () => {
  it('sizes a wide logo by height, with 4% padding per side, keeping the aspect', () => {
    const l = renditionLayout('print', 3, 'wide')
    // 600 high, pad 24, content 552 high and 1656 wide.
    expect(l).toEqual({ name: 'print', width: 1656 + 48, height: 600, content: { x: 24, y: 24, width: 1656, height: 552 } })
    const web = renditionLayout('web', 2, 'wide')
    expect(web.height).toBe(96)
    expect(web.content).toEqual({ x: 4, y: 4, width: 176, height: 88 })
    expect(web.width).toBe(184)
  })

  it('keeps at least 1 px of padding on the smallest size', () => {
    expect(renditionLayout('icon32', 1, 'mark').content).toEqual({ x: 1, y: 1, width: 30, height: 30 })
  })

  it('centres a mark in a square, fitted without stretching', () => {
    const wide = renditionLayout('icon192', 2, 'mark')
    expect([wide.width, wide.height]).toEqual([192, 192])
    // pad 8, inner 176; 176 × 88, centred vertically.
    expect(wide.content).toEqual({ x: 8, y: 52, width: 176, height: 88 })
    const tall = renditionLayout('icon512', 0.5, 'mark')
    expect(tall.content).toEqual({ x: 138, y: 20, width: 236, height: 472 })
  })

  it('treats a nonsense aspect as square', () => {
    expect(renditionLayout('web', Number.NaN, 'wide').content.width).toBe(88)
  })
})

describe('placement', () => {
  it('draws the whole image so its trimmed box lands exactly on the content box', () => {
    const trim = { x: 100, y: 50, width: 400, height: 200 }
    const content = { x: 4, y: 4, width: 176, height: 88 }
    const p = placement(trim, 800, 300, content)
    const k = 176 / 400
    expect(p.x).toBeCloseTo(4 - 100 * k, 10)
    expect(p.y).toBeCloseTo(4 - 50 * k, 10)
    expect(p.width).toBeCloseTo(800 * k, 10)
    expect(p.height).toBeCloseTo(300 * k, 10)
    expect(p.clip).toEqual(content)
    // The trim box's far corner maps to the content box's far corner.
    expect(p.x + (trim.x + trim.width) * k).toBeCloseTo(content.x + content.width, 10)
  })
})

describe('analysis sizes', () => {
  it('scales a large raster down to 4096 on its longer side, and never up', () => {
    expect(rasterAnalysisSize(8192, 2048)).toEqual({ width: 4096, height: 1024, scale: 0.5 })
    expect(rasterAnalysisSize(300, 100)).toEqual({ width: 300, height: 100, scale: 1 })
  })

  it('draws an SVG with its shorter side at 1024 and its longer side at most 4096', () => {
    expect(svgAnalysisSize(100, 40)).toEqual({ width: 2560, height: 1024 })
    expect(svgAnalysisSize(24, 24)).toEqual({ width: 1024, height: 1024 })
    expect(svgAnalysisSize(1000, 100)).toEqual({ width: 4096, height: 410 })
  })
})

describe('svgIntrinsicSize', () => {
  const ns = 'xmlns="http://www.w3.org/2000/svg"'
  it('reads width and height, converting absolute units to px', () => {
    expect(svgIntrinsicSize(`<svg ${ns} width="200" height="80"/>`)).toEqual({ width: 200, height: 80 })
    expect(svgIntrinsicSize(`<svg ${ns} width="1in" height="48pt"/>`)).toEqual({ width: 96, height: 64 })
  })

  it('falls back to the viewBox, and completes one missing length from it', () => {
    expect(svgIntrinsicSize(`<svg ${ns} viewBox="0 0 300 100"/>`)).toEqual({ width: 300, height: 100 })
    expect(svgIntrinsicSize(`<svg ${ns} width="100%" height="100%" viewBox="0,0,30,10"/>`)).toEqual({ width: 30, height: 10 })
    expect(svgIntrinsicSize(`<svg ${ns} width="60" viewBox="0 0 30 10"/>`)).toEqual({ width: 60, height: 20 })
  })

  it('returns null with no usable size, or for broken XML', () => {
    expect(svgIntrinsicSize(`<svg ${ns}/>`)).toBeNull()
    expect(svgIntrinsicSize(`<svg ${ns} width="50%" height="20em"/>`)).toBeNull()
    expect(svgIntrinsicSize(`<svg ${ns} viewBox="0 0 0 10"/>`)).toBeNull()
    expect(svgIntrinsicSize('<svg><unclosed></svg>')).toBeNull()
  })
})

describe('svgWithSize', () => {
  const ns = 'xmlns="http://www.w3.org/2000/svg"'
  it('sets width and height and keeps the viewBox', () => {
    const out = svgWithSize(`<svg ${ns} viewBox="0 0 30 10"><rect width="30" height="10"/></svg>`, 3072, 1024)
    const root = new DOMParser().parseFromString(out, 'image/svg+xml').documentElement
    expect(root.getAttribute('width')).toBe('3072')
    expect(root.getAttribute('height')).toBe('1024')
    expect(root.getAttribute('viewBox')).toBe('0 0 30 10')
    expect(out).toContain('<rect')
  })

  it('adds a viewBox from the original size, so the drawing scales instead of being cropped', () => {
    const out = svgWithSize(`<svg ${ns} width="30" height="10"/>`, 3072, 1024)
    const root = new DOMParser().parseFromString(out, 'image/svg+xml').documentElement
    expect(root.getAttribute('viewBox')).toBe('0 0 30 10')
  })
})
