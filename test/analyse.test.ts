import { describe, expect, it } from 'vitest'
import { analysePixels, pixelLuminance } from '../src/core/analyse.js'

type RGBA = [number, number, number, number]

/** A width × height image filled with `bg`, with `fg` painted over [x0, x1) × [y0, y1). */
function image(width: number, height: number, bg: RGBA, fg?: { rgba: RGBA; x0: number; y0: number; x1: number; y1: number }) {
  const px = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = fg && x >= fg.x0 && x < fg.x1 && y >= fg.y0 && y < fg.y1
      px.set(inside ? fg.rgba : bg, (y * width + x) * 4)
    }
  }
  return px
}

const CLEAR: RGBA = [0, 0, 0, 0]
const WHITE: RGBA = [255, 255, 255, 255]
const BLACK: RGBA = [0, 0, 0, 255]
const RED: RGBA = [200, 20, 30, 255]

describe('analysePixels', () => {
  it('trims transparent margins and reports a transparent logo', () => {
    const px = image(100, 50, CLEAR, { rgba: BLACK, x0: 10, y0: 5, x1: 90, y1: 45 })
    const a = analysePixels(px, 100, 50)
    expect(a?.trim).toEqual({ x: 10, y: 5, width: 80, height: 40 })
    expect(a?.aspect).toBe(2)
    expect(a?.tone.luminance).toBe(0)
    // The trimmed box is solid black: no transparency left inside it.
    expect(a?.tone.transparent).toBe(false)
  })

  it('counts transparency inside the trimmed box', () => {
    // A ring: transparent hole in the middle of an opaque square.
    const px = image(20, 20, CLEAR, { rgba: RED, x0: 0, y0: 0, x1: 20, y1: 20 })
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) px.set(CLEAR, (y * 20 + x) * 4)
    const a = analysePixels(px, 20, 20)
    expect(a?.trim).toEqual({ x: 0, y: 0, width: 20, height: 20 })
    expect(a?.tone.transparent).toBe(true)
  })

  it('treats alpha 16 as visible and alpha 15 as margin', () => {
    const px = image(10, 10, [0, 0, 0, 15], { rgba: [255, 255, 255, 16], x0: 3, y0: 3, x1: 4, y1: 4 })
    const a = analysePixels(px, 10, 10)
    expect(a?.trim).toEqual({ x: 3, y: 3, width: 1, height: 1 })
    expect(a?.tone.luminance).toBeCloseTo(1, 5)
  })

  it('trims a uniform near-white opaque background', () => {
    const px = image(60, 30, [250, 252, 248, 255], { rgba: RED, x0: 15, y0: 10, x1: 45, y1: 20 })
    const a = analysePixels(px, 60, 30)
    expect(a?.trim).toEqual({ x: 15, y: 10, width: 30, height: 10 })
    expect(a?.aspect).toBe(3)
    expect(a?.tone.transparent).toBe(false)
  })

  it('trims a uniform near-black opaque background', () => {
    const px = image(40, 40, [5, 5, 5, 255], { rgba: WHITE, x0: 8, y0: 12, x1: 32, y1: 28 })
    const a = analysePixels(px, 40, 40)
    expect(a?.trim).toEqual({ x: 8, y: 12, width: 24, height: 16 })
    expect(a?.tone.luminance).toBeCloseTo(1, 5)
  })

  it('does not trim an opaque background that is not near-white or near-black', () => {
    const px = image(40, 20, [120, 120, 200, 255], { rgba: WHITE, x0: 10, y0: 5, x1: 30, y1: 15 })
    expect(analysePixels(px, 40, 20)?.trim).toEqual({ x: 0, y: 0, width: 40, height: 20 })
  })

  it('does not trim when the corners disagree', () => {
    const px = image(10, 10, WHITE, { rgba: RED, x0: 4, y0: 4, x1: 6, y1: 6 })
    px.set(BLACK, (9 * 10 + 9) * 4)
    expect(analysePixels(px, 10, 10)?.trim).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })

  it('keeps a solid white image whole rather than trimming it to nothing', () => {
    const a = analysePixels(image(8, 4, WHITE), 8, 4)
    expect(a?.trim).toEqual({ x: 0, y: 0, width: 8, height: 4 })
    expect(a?.tone.luminance).toBeCloseTo(1, 5)
  })

  it('weights luminance by alpha', () => {
    // Half the visible area white at full alpha, half black at alpha 85: (255·1 + 85·0) / 340 = 0.75.
    const px = image(2, 1, WHITE)
    px.set([0, 0, 0, 85], 4)
    expect(analysePixels(px, 2, 1)?.tone.luminance).toBeCloseTo(0.75, 5)
  })

  it('applies the 5% transparency threshold', () => {
    // 100 px, opaque corners; 4 semi-transparent pixels is 4%, 5 is 5%.
    const four = image(10, 10, RED)
    for (const p of [11, 12, 13, 14]) four.set([200, 20, 30, 200], p * 4)
    expect(analysePixels(four, 10, 10)?.tone.transparent).toBe(false)
    four.set([200, 20, 30, 249], 15 * 4)
    expect(analysePixels(four, 10, 10)?.tone.transparent).toBe(true)
  })

  it('returns null when nothing is visible or the buffer is the wrong size', () => {
    expect(analysePixels(image(5, 5, CLEAR), 5, 5)).toBeNull()
    expect(analysePixels(new Uint8Array(10), 5, 5)).toBeNull()
    expect(analysePixels(new Uint8Array(0), 0, 0)).toBeNull()
  })

  it('accepts a plain Uint8Array', () => {
    const px = new Uint8Array(image(4, 4, CLEAR, { rgba: BLACK, x0: 1, y0: 1, x1: 3, y1: 2 }))
    expect(analysePixels(px, 4, 4)?.trim).toEqual({ x: 1, y: 1, width: 2, height: 1 })
  })
})

describe('pixelLuminance', () => {
  it('follows WCAG 2', () => {
    expect(pixelLuminance(0, 0, 0)).toBe(0)
    expect(pixelLuminance(255, 255, 255)).toBeCloseTo(1, 10)
    // WCAG's value for #808080 is about 0.2159.
    expect(pixelLuminance(128, 128, 128)).toBeCloseTo(0.2159, 3)
  })
})
