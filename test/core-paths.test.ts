import { describe, expect, it } from 'vitest'
import {
  VERSION_ID_RE,
  guidePath,
  isOwnPrivatePath,
  isOwnPublicAssetUrl,
  originalPath,
  publicAssetPath,
  publicAssetUrl,
  rulesAreValid,
} from '../src/core/paths.js'
import { rules, sha } from './core-fixtures.js'

const H = sha('a')
const good = `https://abcd.supabase.co/storage/v1/object/public/brand-assets/tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/${H}.png`

describe('path builders', () => {
  it('build the documented shapes', () => {
    expect(publicAssetPath(rules, '0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f', H)).toBe(`tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/${H}.png`)
    expect(publicAssetUrl(rules, `tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/${H}.png`)).toBe(good)
    expect(originalPath(rules, '0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f', H, 'svg')).toBe(`tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/original-${H}.svg`)
    expect(guidePath(rules, '0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f', H)).toBe(`tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/guide-${H}.pdf`)
  })
  it('round-trip through the URL check', () => {
    for (const v of ['0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f', 'a1b2c3d4-0000-4000-8000-00000000000f']) {
      for (const seed of ['x', 'y', 'z']) {
        expect(isOwnPublicAssetUrl(publicAssetUrl(rules, publicAssetPath(rules, v, sha(seed))), rules)).toBe(true)
      }
    }
  })
  it('version ids must be lower-case uuids, the shape the SQL storage policies accept', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync(new URL('../sql/brand_kit.sql', import.meta.url), 'utf8')
    // The SQL's folder check and VERSION_ID_RE must be the same pattern, or uploads pass here and fail there.
    expect(sql).toContain("~ '" + VERSION_ID_RE.source + "'")
    for (const bad of ['v-0001', 'draft_2', '0B5C1F8E-7D1A-4C55-9F1E-3A1B2C3D4E5F', '0b5c1f8e7d1a4c559f1e3a1b2c3d4e5f']) {
      expect(() => publicAssetPath(rules, bad, H)).toThrow()
      expect(isOwnPublicAssetUrl(good.replace('0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f', bad), rules)).toBe(false)
      expect(isOwnPrivatePath(`tenant-1/${bad}/original-${H}.png`, rules)).toBe(false)
    }
    expect(isOwnPrivatePath(`tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/original-${H}.png`, rules)).toBe(true)
  })
  it('refuse unsafe parts instead of building a bad path', () => {
    expect(() => publicAssetPath(rules, '../x', H)).toThrow()
    expect(() => publicAssetPath(rules, '0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f', H.toUpperCase())).toThrow()
    expect(() => publicAssetPath(rules, '0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f', 'abc')).toThrow()
    expect(() => originalPath(rules, '0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f', H, 'html')).toThrow()
    expect(() => guidePath({ ...rules, tenantId: 'a/b' }, 'v1', H)).toThrow()
    expect(() => publicAssetUrl(rules, `tenant-2/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/${H}.png`)).toThrow()
    expect(() => publicAssetPath({ ...rules, storageOrigin: 'https://abcd.supabase.co/' }, 'v1', H)).toThrow()
  })
})

describe('isOwnPublicAssetUrl', () => {
  it('accepts our own address', () => {
    expect(isOwnPublicAssetUrl(good, rules)).toBe(true)
  })

  const hostile: [string, string][] = [
    ['a look-alike origin', `https://abcd.supabase.co.evil.example/storage/v1/object/public/brand-assets/tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/${H}.png`],
    ['an origin followed by more host', `https://origin.evil.example/storage/v1/object/public/brand-assets/tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/${H}.png`],
    ['credentials before another host', `https://abcd.supabase.co@evil.example/storage/v1/object/public/brand-assets/tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/${H}.png`],
    ['credentials in the path', `https://abcd.supabase.co/storage/v1/object/public/brand-assets/tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/@${H}.png`],
    ['a .. segment', `https://abcd.supabase.co/storage/v1/object/public/brand-assets/tenant-1/../tenant-2/${H}.png`],
    ['a .. version', `https://abcd.supabase.co/storage/v1/object/public/brand-assets/tenant-1/../${H}.png`],
    ['an encoded .. segment', `https://abcd.supabase.co/storage/v1/object/public/brand-assets/tenant-1/%2e%2e/${H}.png`],
    ['a query string', `${good}?download=1`],
    ['a fragment', `${good}#x`],
    ['an upper-case hex SHA', good.replace(H, H.toUpperCase())],
    ['a short SHA', good.replace(H, H.slice(0, 63))],
    ['the wrong bucket', good.replace('/brand-assets/', '/brand-originals/')],
    ['the wrong tenant', good.replace('/tenant-1/', '/tenant-2/')],
    ['a tenant that starts with ours', good.replace('/tenant-1/', '/tenant-10/')],
    ['plain http', good.replace('https://', 'http://')],
    ['javascript:', `javascript:alert(1)//${good}`],
    ['a data: URI', 'data:image/png;base64,iVBORw0KGgo='],
    ['an extra path segment', good.replace('/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/', '/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/extra/')],
    ['a missing version', good.replace('/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/', '/')],
    ['an SVG', good.replace('.png', '.svg')],
    ['a backslash', good.replace('/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/', '\\0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/')],
    ['whitespace', ` ${good}`],
    ['a sign-only path', `https://abcd.supabase.co/storage/v1/object/sign/brand-assets/tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/${H}.png`],
    ['an upper-case origin', good.replace('abcd', 'ABCD')],
    ['a port', good.replace('supabase.co/', 'supabase.co:8443/')],
  ]
  for (const [label, url] of hostile) {
    it(`refuses ${label}`, () => {
      expect(isOwnPublicAssetUrl(url, rules)).toBe(false)
    })
  }

  it('refuses non-strings and fails closed on malformed rules', () => {
    expect(isOwnPublicAssetUrl(42, rules)).toBe(false)
    expect(isOwnPublicAssetUrl(null, rules)).toBe(false)
    expect(isOwnPublicAssetUrl(good, { ...rules, storageOrigin: 'https://abcd.supabase.co/' })).toBe(false)
    expect(isOwnPublicAssetUrl(good, { ...rules, storageOrigin: 'http://abcd.supabase.co' })).toBe(false)
    expect(isOwnPublicAssetUrl(good, { ...rules, tenantId: '' })).toBe(false)
    expect(isOwnPublicAssetUrl(good, { ...rules, tenantId: 'tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f' })).toBe(false)
    expect(rulesAreValid(rules)).toBe(true)
  })
})

describe('isOwnPrivatePath', () => {
  it('accepts this tenant and refuses others and tricks', () => {
    expect(isOwnPrivatePath(`tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/original-${H}.png`, rules)).toBe(true)
    expect(isOwnPrivatePath(`tenant-2/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/original-${H}.png`, rules)).toBe(false)
    expect(isOwnPrivatePath(`tenant-10/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/original-${H}.png`, rules)).toBe(false)
    expect(isOwnPrivatePath(`tenant-1/../tenant-2/x.png`, rules)).toBe(false)
    expect(isOwnPrivatePath(`tenant-1/0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f/..`, rules)).toBe(false)
    expect(isOwnPrivatePath(`/tenant-1/x.png`, rules)).toBe(false)
    expect(isOwnPrivatePath(`tenant-1//x.png`, rules)).toBe(false)
    expect(isOwnPrivatePath(`tenant-1/x.png?x=1`, rules)).toBe(false)
    expect(isOwnPrivatePath(`tenant-1/x\\y.png`, rules)).toBe(false)
    expect(isOwnPrivatePath(`https://abcd.supabase.co/tenant-1/x.png`, rules)).toBe(false)
  })
})
