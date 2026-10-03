// @vitest-environment jsdom
/**
 * prepareLogo / prepareGuide, driven through `prepareLogoWith` and a FAKE canvas backend, because jsdom has
 * no canvas. What this covers: every check and refusal, the order of work, which sizes are made, where the
 * logo is drawn in each, hashing and the problems reported. What it cannot cover: real decoding, real
 * pixels and real PNG encoding (see the report / README).
 */
import { describe, expect, it, vi } from 'vitest'
import { prepareGuide, prepareLogoWith } from '../src/browser/prepare.js'
import type { DecodedImage, RasterBackend, RasterSurface } from '../src/browser/rasterise.js'
import { readBytes, sha256Hex } from '../src/browser/hash.js'
import { KitError } from '../src/core/validate.js'
import type { PixelBox } from '../src/core/analyse.js'

function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(64)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, width)
  new DataView(b.buffer).setUint32(20, height)
  return b
}

/** An RGBA image: transparent, with an opaque rectangle of `rgba` over `box`. */
function boxImage(width: number, height: number, box: PixelBox, rgba: [number, number, number, number]) {
  const px = new Uint8ClampedArray(width * height * 4)
  for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x; x < box.x + box.width; x++) px.set(rgba, (y * width + x) * 4)
  return px
}

interface DrawCall {
  surface: { width: number; height: number }
  x: number
  y: number
  width: number
  height: number
  clip: PixelBox | undefined
}

/**
 * A fake canvas. The decoded image is `decodedSize`; reading the analysis surface returns
 * `pixels(width, height)`; each PNG is a small blob naming its size (or `pngSize` bytes, when given).
 */
function fakeBackend(opts: {
  decodedSize: { width: number; height: number }
  pixels: (w: number, h: number) => Uint8ClampedArray
  pngSize?: (w: number, h: number) => number
  decodeFails?: boolean
}) {
  const draws: DrawCall[] = []
  const svgTexts: string[] = []
  const close = vi.fn()
  const decoded = (): DecodedImage => ({ ...opts.decodedSize, source: {} as CanvasImageSource, close })
  const backend: RasterBackend = {
    async decodeRaster() {
      if (opts.decodeFails) throw new Error('decode failed')
      return decoded()
    },
    async decodeSvg(text) {
      svgTexts.push(text)
      return decoded()
    },
    surface(width, height): RasterSurface {
      return {
        width,
        height,
        draw(_img, x, y, w, h, clip) {
          draws.push({ surface: { width, height }, x, y, width: w, height: h, clip })
        },
        readPixels: () => opts.pixels(width, height),
        toPng: async () => {
          const n = opts.pngSize?.(width, height)
          return new Blob([n === undefined ? `PNG ${width}x${height}` : new Uint8Array(n)], { type: 'image/png' })
        },
      }
    },
  }
  return { backend, draws, svgTexts, close }
}

/** A 400 × 100 raster with a black box at (40, 10) 320 × 80: aspect 4 once trimmed. */
const WIDE = {
  decodedSize: { width: 400, height: 100 },
  pixels: (w: number, h: number) => boxImage(w, h, { x: 40, y: 10, width: 320, height: 80 }, [0, 0, 0, 255]),
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(KitError)
    const problem = (e as KitError).problems[0]
    expect(problem?.severity).toBe('refused')
    return problem?.message ?? ''
  }
  throw new Error('expected a refusal')
}

describe('prepareLogoWith: a wide raster logo', () => {
  it('measures, trims and makes every wide size from the trimmed box', async () => {
    const fake = fakeBackend(WIDE)
    const file = new File([pngBytes(400, 100)], 'Acme Logo.png', { type: 'image/png' })
    const out = await prepareLogoWith(file, 'logo', fake)

    expect(out.slot).toBe('logo')
    expect(out.aspect).toBe(4)
    expect(out.tone).toEqual({ luminance: 0, transparent: false })
    expect(out.palette).toEqual([{ hex: '#000000', share: 1 }])
    expect(out.original).toMatchObject({ type: 'image/png', name: 'Acme Logo.png', ext: 'png' })
    expect(out.original.blob).toBe(file)
    expect(out.original.sha256).toBe(await sha256Hex(pngBytes(400, 100)))

    expect(out.renditions.map((r) => [r.name, r.width, r.height])).toEqual([
      ['web', 352 + 8, 96],
      ['web2x', 704 + 16, 192],
      ['email', 440 + 10, 120],
      ['pdf', 880 + 20, 240],
      ['print', 2208 + 48, 600],
    ])
    for (const r of out.renditions) {
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(r.sha256).toBe(await sha256Hex(r.blob))
    }

    // First draw: the whole image onto the analysis surface. Then one clipped draw per size.
    expect(fake.draws[0]).toEqual({ surface: { width: 400, height: 100 }, x: 0, y: 0, width: 400, height: 100, clip: undefined })
    const web = fake.draws[1]
    expect(web?.clip).toEqual({ x: 4, y: 4, width: 352, height: 88 })
    // The trimmed box (40, 10, 320 × 80) is scaled by 1.1 and lands on the clip box.
    expect(web?.x).toBeCloseTo(4 - 40 * 1.1, 10)
    expect(web?.y).toBeCloseTo(4 - 10 * 1.1, 10)
    expect(web?.width).toBeCloseTo(440, 10)
    expect(fake.close).toHaveBeenCalledTimes(1)
  })

  it('warns that a small raster will look soft in print', async () => {
    const out = await prepareLogoWith(new File([pngBytes(400, 100)], 'a.png', { type: 'image/png' }), 'logo', fakeBackend(WIDE))
    expect(out.problems).toEqual([expect.objectContaining({ field: 'logos.logo', severity: 'warning', message: expect.stringMatching(/80 pixels high/) })])
  })

  it('accepts a file whose browser type is empty, trusting the bytes', async () => {
    const out = await prepareLogoWith(new File([pngBytes(400, 100)], 'logo'), 'logo', fakeBackend(WIDE))
    expect(out.original.type).toBe('image/png')
  })

  it('reports a transparent, light logo for the dark slot', async () => {
    const fake = fakeBackend({
      decodedSize: { width: 300, height: 100 },
      // A white ring: the box is transparent in the middle.
      pixels: (w, h) => {
        const px = boxImage(w, h, { x: 0, y: 0, width: 300, height: 100 }, [255, 255, 255, 255])
        for (let y = 20; y < 80; y++) for (let x = 20; x < 280; x++) px.set([0, 0, 0, 0], (y * w + x) * 4)
        return px
      },
    })
    const out = await prepareLogoWith(new File([pngBytes(300, 100)], 'w.png', { type: 'image/png' }), 'logoOnDark', fake)
    expect(out.tone.transparent).toBe(true)
    expect(out.tone.luminance).toBeCloseTo(1, 5)
  })

  it('skips a size whose PNG comes out over 2 MB, with a warning', async () => {
    const fake = fakeBackend({ ...WIDE, pngSize: (_w, h) => (h === 600 ? 2 * 1024 * 1024 + 1 : 100) })
    const out = await prepareLogoWith(new File([pngBytes(400, 100)], 'a.png', { type: 'image/png' }), 'logo', fake)
    expect(out.renditions.map((r) => r.name)).toEqual(['web', 'web2x', 'email', 'pdf'])
    expect(out.problems.some((p) => p.severity === 'warning' && /print size came out over 2 MB/.test(p.message))).toBe(true)
  })
})

describe('prepareLogoWith: a square mark', () => {
  it('makes every mark size as a centred square', async () => {
    const fake = fakeBackend({
      decodedSize: { width: 600, height: 600 },
      pixels: (w, h) => boxImage(w, h, { x: 50, y: 100, width: 500, height: 400 }, [200, 30, 40, 255]),
    })
    const out = await prepareLogoWith(new File([pngBytes(600, 600)], 'mark.png', { type: 'image/png' }), 'mark', fake)
    expect(out.renditions.map((r) => [r.name, r.width, r.height])).toEqual([
      ['web', 96, 96],
      ['web2x', 192, 192],
      ['email', 120, 120],
      ['pdf', 240, 240],
      ['icon32', 32, 32],
      ['icon192', 192, 192],
      ['icon512', 512, 512],
    ])
    // icon192: pad 8, inner 176; aspect 1.25 → 176 × 141, centred.
    const icon192 = fake.draws.find((d) => d.surface.width === 192 && d.surface.height === 192 && d.clip?.width === 176 && d.clip.y !== 8)
    expect(icon192?.clip).toEqual({ x: 8, y: 25, width: 176, height: 141 })
    expect(out.palette[0]?.hex).toBe('#c81e28')
    expect(out.problems.some((p) => /not square/.test(p.message))).toBe(false)
  })

  it('warns when the mark is not square', async () => {
    const out = await prepareLogoWith(new File([pngBytes(400, 100)], 'a.png', { type: 'image/png' }), 'mark', fakeBackend(WIDE))
    expect(out.problems.some((p) => p.severity === 'warning' && /not square/.test(p.message))).toBe(true)
  })
})

describe('prepareLogoWith: an SVG logo', () => {
  const hostile =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" onload="alert(1)"><script>alert(2)</script><rect x="10" y="5" width="80" height="30" fill="#0a7"/></svg>'

  it('cleans it, keeps the CLEAN text as the original, and decodes the clean text at the analysis size', async () => {
    const fake = fakeBackend({
      decodedSize: { width: 2560, height: 1024 },
      pixels: (w, h) => boxImage(w, h, { x: 256, y: 128, width: 2048, height: 768 }, [0, 170, 119, 255]),
    })
    const out = await prepareLogoWith(new File([hostile], 'logo.svg', { type: 'image/svg+xml' }), 'logo', fake)

    const stored = new TextDecoder().decode(await readBytes(out.original.blob))
    expect(stored).not.toMatch(/script|onload|alert/)
    expect(stored).toContain('<rect')
    expect(out.original).toMatchObject({ type: 'image/svg+xml', ext: 'svg' })
    expect(out.original.sha256).toBe(await sha256Hex(new TextEncoder().encode(stored)))

    expect(fake.svgTexts).toHaveLength(1)
    const drawn = fake.svgTexts[0] ?? ''
    expect(drawn).not.toMatch(/script|onload/)
    expect(drawn).toMatch(/width="2560"/)
    expect(drawn).toMatch(/height="1024"/)

    expect(out.aspect).toBeCloseTo(2048 / 768, 10)
    expect(out.problems).toEqual([expect.objectContaining({ severity: 'repaired', message: expect.stringMatching(/<script> element/) })])
    // No "too small" check or print warning for a vector.
    expect(out.problems.some((p) => p.severity === 'warning')).toBe(false)
  })

  it('refuses an SVG with no size', async () => {
    const msg = await refusal(
      prepareLogoWith(new File(['<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'], 's.svg'), 'logo', fakeBackend(WIDE)),
    )
    expect(msg).toMatch(/no size/)
  })
})

describe('prepareLogoWith: refusals', () => {
  const backend = () => fakeBackend(WIDE)

  it('refuses an empty file and one over 5 MB', async () => {
    expect(await refusal(prepareLogoWith(new File([], 'a.png'), 'logo', backend()))).toMatch(/empty/)
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    big.set(pngBytes(10, 10))
    expect(await refusal(prepareLogoWith(new File([big], 'a.png'), 'logo', backend()))).toMatch(/up to 5 MB/)
  })

  it('refuses a PDF, a GIF and unreadable bytes', async () => {
    expect(await refusal(prepareLogoWith(new File(['%PDF-1.7 ...'], 'a.pdf'), 'logo', backend()))).toMatch(/PDF/)
    expect(await refusal(prepareLogoWith(new File(['GIF89a......'], 'a.gif', { type: 'image/gif' }), 'logo', backend()))).toMatch(/GIF/)
    expect(await refusal(prepareLogoWith(new File(['hello'], 'a.png'), 'logo', backend()))).toMatch(/could not read/)
  })

  it('refuses bytes that disagree with the declared type', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
    expect(await refusal(prepareLogoWith(new File([jpeg], 'a.png', { type: 'image/png' }), 'logo', backend()))).toMatch(/named as a PNG.*JPEG/)
  })

  it('treats image/jpg as image/jpeg', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
    const out = await prepareLogoWith(new File([jpeg], 'a.jpg', { type: 'image/jpg' }), 'logo', backend())
    expect(out.original).toMatchObject({ type: 'image/jpeg', ext: 'jpg' })
  })

  it('refuses a raster over 64 megapixels before decoding it', async () => {
    const fake = fakeBackend(WIDE)
    const spy = vi.spyOn(fake.backend, 'decodeRaster')
    expect(await refusal(prepareLogoWith(new File([pngBytes(10000, 10000)], 'a.png'), 'logo', fake))).toMatch(/too large/)
    expect(spy).not.toHaveBeenCalled()
  })

  it('refuses a file the browser cannot decode', async () => {
    expect(await refusal(prepareLogoWith(new File([pngBytes(4, 4)], 'a.png'), 'logo', fakeBackend({ ...WIDE, decodeFails: true })))).toMatch(/could not open/)
  })

  it('refuses a logo with nothing visible, and closes the decoded image', async () => {
    const fake = fakeBackend({ decodedSize: { width: 100, height: 100 }, pixels: (w, h) => new Uint8ClampedArray(w * h * 4) })
    expect(await refusal(prepareLogoWith(new File([pngBytes(100, 100)], 'a.png'), 'logo', fake))).toMatch(/nothing visible/)
    expect(fake.close).toHaveBeenCalledTimes(1)
  })

  it('refuses a raster whose trimmed shorter side is under 64 px', async () => {
    const fake = fakeBackend({ decodedSize: { width: 400, height: 100 }, pixels: (w, h) => boxImage(w, h, { x: 0, y: 30, width: 400, height: 40 }, [0, 0, 0, 255]) })
    expect(await refusal(prepareLogoWith(new File([pngBytes(400, 100)], 'a.png'), 'logo', fake))).toMatch(/only 40 pixels/)
  })

  it('measures the minimum size in the original pixels when a large raster was scaled down', async () => {
    // 8000 × 2000 decoded to 4096 × 1024 (scale 0.512): a 40 px analysis box is 78 original px, so it passes.
    const fake = fakeBackend({ decodedSize: { width: 8000, height: 2000 }, pixels: (w, h) => boxImage(w, h, { x: 0, y: 0, width: 400, height: 40 }, [0, 0, 0, 255]) })
    const out = await prepareLogoWith(new File([pngBytes(8000, 2000)], 'a.png'), 'logo', fake)
    expect(out.aspect).toBe(10)
  })

  it('refuses a logo more than 50 times longer than it is high', async () => {
    const fake = fakeBackend({ decodedSize: { width: 4096, height: 100 }, pixels: (w, h) => boxImage(w, h, { x: 0, y: 0, width: 4096, height: 70 }, [0, 0, 0, 255]) })
    expect(await refusal(prepareLogoWith(new File([pngBytes(4096, 100)], 'a.png'), 'logo', fake))).toMatch(/long and thin/)
  })

  it('refuses an unknown slot as a programming error', async () => {
    await expect(prepareLogoWith(new File([pngBytes(4, 4)], 'a.png'), 'banner' as never, backend())).rejects.toThrow(/Unknown logo slot/)
  })
})

describe('prepareGuide', () => {
  it('accepts a PDF and hashes it', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n%...')
    const out = await prepareGuide(new File([bytes], 'Brand Guide.pdf', { type: 'application/pdf' }))
    expect(out).toMatchObject({ name: 'Brand Guide.pdf', bytes: bytes.length })
    expect(out.sha256).toBe(await sha256Hex(bytes))
  })

  it('refuses anything that is not a PDF by its bytes, an empty file, and one over 25 MB', async () => {
    expect(await refusal(prepareGuide(new File([pngBytes(4, 4)], 'guide.pdf', { type: 'application/pdf' })))).toMatch(/must be a PDF/)
    expect(await refusal(prepareGuide(new File([], 'guide.pdf')))).toMatch(/empty/)
    const big = new Uint8Array(25 * 1024 * 1024 + 1)
    big.set(new TextEncoder().encode('%PDF-'))
    expect(await refusal(prepareGuide(new File([big], 'guide.pdf')))).toMatch(/up to 25 MB/)
  })
})
