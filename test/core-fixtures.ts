import type { BrandKit, BrandStorageRules, LogoAsset, ProductIdentity, Rendition, RenditionName } from '../src/core/kit.js'

export const rules: BrandStorageRules = {
  storageOrigin: 'https://abcd.supabase.co',
  publicBucket: 'brand-assets',
  privateBucket: 'brand-originals',
  tenantId: 'tenant-1',
}

export const identity: ProductIdentity = {
  product: 'skyweather',
  productName: 'SkyWeather',
  poweredByLabel: 'Powered by SkyDrive',
  poweredByHref: 'https://skydrive.example/',
  fallbackAccent: '#2563eb',
}

export const VERSION = 'v-0001'

/** A deterministic 64-hex "hash" for a name. */
export function sha(seed: string): string {
  let out = ''
  let h = 2166136261
  while (out.length < 64) {
    for (const ch of seed + out.length) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
    out += h.toString(16).padStart(8, '0')
  }
  return out.slice(0, 64)
}

export function assetUrl(hash: string, tenant = rules.tenantId): string {
  return `${rules.storageOrigin}/storage/v1/object/public/${rules.publicBucket}/${tenant}/${VERSION}/${hash}.png`
}

export function rendition(name: RenditionName, width: number, height: number): Rendition {
  const hash = sha(name + width + 'x' + height)
  return { url: assetUrl(hash), width, height, bytes: 1234, sha256: hash }
}

export function wideLogo(opts: { luminance?: number; transparent?: boolean } = {}): LogoAsset {
  return {
    originalPath: `${rules.tenantId}/${VERSION}/original-${sha('orig')}.png`,
    originalType: 'image/png',
    originalName: 'logo.png',
    aspect: 4,
    tone: { luminance: opts.luminance ?? 0.2, transparent: opts.transparent ?? true },
    renditions: {
      web: rendition('web', 400, 96),
      web2x: rendition('web2x', 800, 192),
      email: rendition('email', 500, 120),
      pdf: rendition('pdf', 1000, 240),
      print: rendition('print', 2500, 600),
    },
  }
}

export function squareMark(): LogoAsset {
  return {
    originalPath: `${rules.tenantId}/${VERSION}/original-${sha('mark')}.svg`,
    originalType: 'image/svg+xml',
    originalName: 'mark.svg',
    aspect: 1,
    tone: { luminance: 0.5, transparent: true },
    renditions: {
      web: rendition('web', 96, 96),
      web2x: rendition('web2x', 192, 192),
      email: rendition('email', 120, 120),
      pdf: rendition('pdf', 240, 240),
      icon32: rendition('icon32', 32, 32),
      icon192: rendition('icon192', 192, 192),
      icon512: rendition('icon512', 512, 512),
    },
  }
}

export function fullKit(): BrandKit {
  return {
    schemaVersion: 1,
    name: 'Skydive Testharness',
    tagline: 'Jump with us',
    website: 'https://testharness.example',
    logos: { logo: wideLogo(), mark: squareMark() },
    colors: { primary: '#1a73e8', secondary: '#0f9d58' },
    fonts: { heading: 'inter' },
    guide: {
      path: `${rules.tenantId}/${VERSION}/guide-${sha('guide')}.pdf`,
      name: 'Brand guide.pdf',
      bytes: 50000,
      uploadedAt: '2026-10-02T10:00:00.000Z',
    },
  }
}
