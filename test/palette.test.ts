import { describe, expect, it } from 'vitest'
import { extractPalette } from '../src/core/palette.js'

type RGBA = [number, number, number, number]

/** An image made of horizontal stripes: [colour, rows]. */
function stripes(width: number, parts: [RGBA, number][]) {
  const height = parts.reduce((n, [, rows]) => n + rows, 0)
  const px = new Uint8ClampedArray(width * height * 4)
  let y = 0
  for (const [rgba, rows] of parts) {
    for (let r = 0; r < rows; r++, y++) for (let x = 0; x < width; x++) px.set(rgba, (y * width + x) * 4)
  }
  return { px, width, height }
}

describe('extractPalette', () => {
  it('finds the distinct colours with their shares', () => {
    const { px, width, height } = stripes(10, [
      [[220, 30, 40, 255], 6],
      [[20, 90, 200, 255], 4],
    ])
    const p = extractPalette(px, width, height)
    expect(p.map((e) => e.hex)).toEqual(['#dc1e28', '#145ac8'])
    expect(p[0]?.share).toBeCloseTo(0.6, 5)
    expect(p[1]?.share).toBeCloseTo(0.4, 5)
  })

  it('sorts near-white and near-black after chromatic colours even when they are larger', () => {
    const { px, width, height } = stripes(10, [
      [[255, 255, 255, 255], 70],
      [[0, 0, 0, 255], 20],
      [[0, 140, 70, 255], 10],
    ])
    const p = extractPalette(px, width, height)
    expect(p[0]?.hex).toBe('#008c46')
    expect(p.slice(1).map((e) => e.hex)).toEqual(['#ffffff', '#000000'])
  })

  it('ignores pixels with alpha below 128', () => {
    const { px, width, height } = stripes(4, [
      [[255, 0, 0, 127], 3],
      [[0, 0, 255, 128], 1],
    ])
    expect(extractPalette(px, width, height)).toEqual([{ hex: '#0000ff', share: 1 }])
  })

  it('returns at most `max` colours', () => {
    const parts: [RGBA, number][] = [
      [[255, 0, 0, 255], 1],
      [[0, 255, 0, 255], 1],
      [[0, 0, 255, 255], 1],
      [[255, 255, 0, 255], 1],
      [[0, 255, 255, 255], 1],
      [[255, 0, 255, 255], 1],
      [[128, 64, 0, 255], 1],
    ]
    const { px, width, height } = stripes(3, parts)
    expect(extractPalette(px, width, height).length).toBe(5)
    expect(extractPalette(px, width, height, 2).length).toBe(2)
    expect(extractPalette(px, width, height, 20).length).toBe(7)
    const shares = extractPalette(px, width, height, 20).reduce((n, e) => n + e.share, 0)
    expect(shares).toBeCloseTo(1, 10)
  })

  it('returns [] for nothing visible, max below 1, or a wrong-size buffer', () => {
    const { px, width, height } = stripes(2, [[[10, 10, 10, 0], 2]])
    expect(extractPalette(px, width, height)).toEqual([])
    expect(extractPalette(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1, 0)).toEqual([])
    expect(extractPalette(new Uint8ClampedArray(3), 1, 1)).toEqual([])
  })

  it('samples a large image and is deterministic', () => {
    const { px, width, height } = stripes(1000, [
      [[200, 50, 50, 255], 300],
      [[50, 50, 200, 255], 300],
    ])
    const a = extractPalette(px, width, height)
    expect(a).toEqual(extractPalette(px, width, height))
    expect(a.map((e) => e.hex).sort()).toEqual(['#3232c8', '#c83232'])
    expect(a[0]?.share).toBeCloseTo(0.5, 1)
  })
})
