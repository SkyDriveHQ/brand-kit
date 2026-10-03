import { describe, expect, it } from 'vitest'
import { checkPng, readImageSize, sniffType, svgDenyScan } from '../src/core/files.js'

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)
const cat = (...parts: (number[] | Uint8Array)[]) => Uint8Array.from(parts.flatMap((p) => [...p]))
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const le16 = (n: number) => [n & 255, (n >>> 8) & 255]
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255]

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A structurally complete PNG: signature, IHDR, an empty IDAT and IEND (CRCs are not checked). */
function png(width: number, height: number, extra = 0): Uint8Array {
  const chunk = (type: string, data: number[]) => [...be32(data.length), ...enc(type), ...data, 0, 0, 0, 0]
  return cat(
    PNG_SIG,
    chunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
    chunk('IDAT', new Array(extra).fill(0)),
    chunk('IEND', []),
  )
}

function jpeg(width: number, height: number, sof = 0xc0): Uint8Array {
  return cat(
    [0xff, 0xd8],
    [0xff, 0xe0, 0x00, 0x10, ...enc('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0], // APP0, 16 bytes
    [0xff, 0xff], // fill byte before the next marker
    [0xff, sof, 0x00, 0x11, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
    [0xff, 0xd9],
  )
}

function riff(chunk: string, payload: number[]): Uint8Array {
  const body = [...enc('WEBP'), ...enc(chunk), ...le16(payload.length), 0, 0, ...payload]
  return cat(enc('RIFF'), [...le16(body.length), 0, 0], body)
}

const webpLossy = (w: number, h: number) => riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h), 0, 0])
function webpLossless(w: number, h: number): Uint8Array {
  const a = w - 1
  const b = h - 1
  const bits = a | (b << 14)
  return riff('VP8L', [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255, 0, 0, 0])
}
const webpExtended = (w: number, h: number) => riff('VP8X', [0x10, 0, 0, 0, ...le24(w - 1), ...le24(h - 1), 0, 0])

describe('sniffType', () => {
  it('recognises each allowed type by its first bytes', () => {
    expect(sniffType(png(10, 10))).toBe('image/png')
    expect(sniffType(jpeg(10, 10))).toBe('image/jpeg')
    expect(sniffType(webpLossy(10, 10))).toBe('image/webp')
    expect(sniffType(enc('%PDF-1.7\n...'))).toBe('application/pdf')
  })

  it('recognises SVG after a BOM, an XML prolog, comments and a DOCTYPE', () => {
    expect(sniffType(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml')
    expect(sniffType(enc('\xef\xbb\xbf<?xml version="1.0"?>\n<!-- made in a tool -->\n<svg>'))).toBe('image/svg+xml')
    expect(
      sniffType(enc('<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg viewBox="0 0 1 1"/>')),
    ).toBe('image/svg+xml')
    expect(sniffType(enc('<!DOCTYPE svg [ <!ENTITY x "y"> ]><svg>'))).toBe('image/svg+xml')
    expect(sniffType(enc('  \n<SVG>'))).toBe('image/svg+xml')
  })

  it('refuses everything else, including look-alikes', () => {
    for (const s of ['<html><svg></svg></html>', '<svgx>', 'GIF89a', '<!-- unterminated <svg>', 'hello', '']) {
      expect(sniffType(enc(s)), s).toBeNull()
    }
    expect(sniffType(Uint8Array.from([0x89, 0x50, 0x4e]))).toBeNull()
  })
})

describe('readImageSize', () => {
  it('reads PNG', () => {
    expect(readImageSize(png(640, 480))).toEqual({ width: 640, height: 480 })
  })
  it('reads JPEG baseline, extended and progressive frames, skipping other segments', () => {
    expect(readImageSize(jpeg(1024, 768, 0xc0))).toEqual({ width: 1024, height: 768 })
    expect(readImageSize(jpeg(300, 200, 0xc1))).toEqual({ width: 300, height: 200 })
    expect(readImageSize(jpeg(64, 4000, 0xc2))).toEqual({ width: 64, height: 4000 })
  })
  it('reads all three WebP variants', () => {
    expect(readImageSize(webpLossy(800, 600))).toEqual({ width: 800, height: 600 })
    expect(readImageSize(webpLossless(1000, 250))).toEqual({ width: 1000, height: 250 })
    expect(readImageSize(webpLossless(16384, 1))).toEqual({ width: 16384, height: 1 })
    expect(readImageSize(webpExtended(5000, 3000))).toEqual({ width: 5000, height: 3000 })
  })
  it('returns null for unknown, truncated or zero-sized images', () => {
    expect(readImageSize(enc('hello'))).toBeNull()
    expect(readImageSize(png(10, 10).subarray(0, 20))).toBeNull()
    expect(readImageSize(png(0, 10))).toBeNull()
    expect(readImageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull()
  })
})

describe('svgDenyScan', () => {
  it('passes a clean logo', () => {
    expect(
      svgDenyScan(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs>' +
          '<rect fill="url(#g)" width="10" height="10"/><use href="#g"/><use xlink:href="#g"/><text>one = two</text></svg>',
      ),
    ).toEqual([])
  })

  const cases: [string, string][] = [
    ['a script element', '<svg><script>alert(1)</script></svg>'],
    ['an onload handler', '<svg onload="alert(1)"></svg>'],
    ['a handler after a slash', '<svg/onload=alert(1)>'],
    ['an upper-case handler', '<svg><rect ONCLICK="x"/></svg>'],
    ['foreignObject', '<svg><foreignObject><div/></foreignObject></svg>'],
    ['an iframe', '<svg><iframe src="x"/></svg>'],
    ['an embed', '<svg><embed src="x"/></svg>'],
    ['an object', '<svg><object data="x"/></svg>'],
    ['an external href', '<svg><a href="https://evil.example"><rect/></a></svg>'],
    ['an external xlink:href', '<svg><image xlink:href="https://evil.example/x.png"/></svg>'],
    ['an unquoted javascript href', '<svg><a href=javascript:alert(1)><rect/></a></svg>'],
    ['an entity-encoded href', '<svg><a href="&#106;avascript:alert(1)"/></svg>'],
    ['an animated href', '<svg><a><set attributeName="href" to="javascript:alert(1)"/></a></svg>'],
    ['@import', '<svg><style>@import "https://evil.example/x.css";</style></svg>'],
    ['an external url()', '<svg><rect style="fill:url(https://evil.example/x)"/></svg>'],
    ['a quoted external url()', "<svg><rect fill=\"url('//evil.example/x')\"/></svg>"],
    ['an ENTITY', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>'],
    ['a DOCTYPE', '<!DOCTYPE svg><svg></svg>'],
  ]
  for (const [label, svg] of cases) {
    it(`flags ${label}`, () => {
      const reasons = svgDenyScan(svg)
      expect(reasons.length).toBeGreaterThan(0)
      for (const r of reasons) expect(r).toMatch(/^It .*\.$/)
    })
  }

  it('stays fast on hostile input with no closing brackets', () => {
    const start = Date.now()
    svgDenyScan('<' + ' a'.repeat(200000))
    svgDenyScan('<'.repeat(200000))
    expect(Date.now() - start).toBeLessThan(2000)
  })
})

describe('checkPng', () => {
  it('passes a complete PNG of the expected size', () => {
    expect(checkPng(png(400, 96))).toEqual([])
    expect(checkPng(png(400, 96), { width: 400, height: 96, maxBytes: 10000 })).toEqual([])
  })
  it('refuses a file that is not a PNG', () => {
    expect(checkPng(jpeg(10, 10), undefined, 'logos.logo.renditions.web')).toEqual([
      { field: 'logos.logo.renditions.web', severity: 'refused', message: 'This file is not a PNG image.' },
    ])
  })
  it('refuses the wrong size, too many bytes, and damaged or padded files', () => {
    expect(checkPng(png(400, 96), { width: 400, height: 97, maxBytes: 10000 })[0]?.message).toBe(
      'This image is 400 × 96 pixels, but 400 × 97 was expected.',
    )
    expect(checkPng(png(400, 96, 3000), { width: 400, height: 96, maxBytes: 2048 })[0]?.message).toMatch(/larger than the 2 KB allowed/)
    const truncated = png(400, 96).subarray(0, 40)
    expect(checkPng(truncated).length).toBeGreaterThan(0)
    const trailing = cat(png(400, 96), enc('<script>alert(1)</script>'))
    expect(checkPng(trailing)[0]?.message).toBe('This PNG image is damaged or incomplete.')
  })
})
