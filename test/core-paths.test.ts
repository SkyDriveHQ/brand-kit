import { describe, expect, it } from 'vitest'
import {
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
const good = `https://abcd.supabase.co/storage/v1/object/public/brand-assets/tenant-1/v-0001/${H}.png`

describe('path builders', () => {
  it('build the documented shapes', () => {
    expect(publicAssetPath(rules, 'v-0001', H)).toBe(`tenant-1/v-0001/${H}.png`)
    expect(publicAssetUrl(rules, `tenant-1/v-0001/${H}.png`)).toBe(good)
    expect(originalPath(rules, 'v-0001', H, 'svg')).toBe(`tenant-1/v-0001/original-${H}.svg`)
    expect(guidePath(rules, 'v-0001', H)).toBe(`tenant-1/v-0001/guide-${H}.pdf`)
  })
  it('round-trip through the URL check', () => {
    for (const v of ['v-0001', '0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f', 'draft_2']) {
      for (const seed of ['x', 'y', 'z']) {
        expect(isOwnPublicAssetUrl(publicAssetUrl(rules, publicAssetPath(rules, v, sha(seed))), rules)).toBe(true)
      }
    }
  })
  it('refuse unsafe parts instead of building a bad path', () => {
    expect(() => publicAssetPath(rules, '../x', H)).toThrow()
    expect(() => publicAssetPath(rules, 'v1', H.toUpperCase())).toThrow()
    expect(() => publicAssetPath(rules, 'v1', 'abc')).toThrow()
    expect(() => originalPath(rules, 'v1', H, 'html')).toThrow()
    expect(() => guidePath({ ...rules, tenantId: 'a/b' }, 'v1', H)).toThrow()
    expect(() => publicAssetUrl(rules, `tenant-2/v-0001/${H}.png`)).toThrow()
    expect(() => publicAssetPath({ ...rules, storageOrigin: 'https://abcd.supabase.co/' }, 'v1', H)).toThrow()
  })
})

describe('isOwnPublicAssetUrl', () => {
  it('accepts our own address', () => {
    expect(isOwnPublicAssetUrl(good, rules)).toBe(true)
  })

  const hostile: [string, string][] = [
    ['a look-alike origin', `https://abcd.supabase.co.evil.example/storage/v1/object/public/brand-assets/tenant-1/v-0001/${H}.png`],
    ['an origin followed by more host', `https://origin.evil.example/storage/v1/object/public/brand-assets/tenant-1/v-0001/${H}.png`],
    ['credentials before another host', `https://abcd.supabase.co@evil.example/storage/v1/object/public/brand-assets/tenant-1/v-0001/${H}.png`],
    ['credentials in the path', `https://abcd.supabase.co/storage/v1/object/public/brand-assets/tenant-1/v-0001/@${H}.png`],
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
    ['an extra path segment', good.replace('/v-0001/', '/v-0001/extra/')],
    ['a missing version', good.replace('/v-0001/', '/')],
    ['an SVG', good.replace('.png', '.svg')],
    ['a backslash', good.replace('/v-0001/', '\\v-0001/')],
    ['whitespace', ` ${good}`],
    ['a sign-only path', `https://abcd.supabase.co/storage/v1/object/sign/brand-assets/tenant-1/v-0001/${H}.png`],
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
    expect(isOwnPublicAssetUrl(good, { ...rules, tenantId: 'tenant-1/v-0001' })).toBe(false)
    expect(rulesAreValid(rules)).toBe(true)
  })
})

describe('isOwnPrivatePath', () => {
  it('accepts this tenant and refuses others and tricks', () => {
    expect(isOwnPrivatePath(`tenant-1/v-0001/original-${H}.png`, rules)).toBe(true)
    expect(isOwnPrivatePath(`tenant-2/v-0001/original-${H}.png`, rules)).toBe(false)
    expect(isOwnPrivatePath(`tenant-10/v-0001/original-${H}.png`, rules)).toBe(false)
    expect(isOwnPrivatePath(`tenant-1/../tenant-2/x.png`, rules)).toBe(false)
    expect(isOwnPrivatePath(`tenant-1/v-0001/..`, rules)).toBe(false)
    expect(isOwnPrivatePath(`/tenant-1/x.png`, rules)).toBe(false)
    expect(isOwnPrivatePath(`tenant-1//x.png`, rules)).toBe(false)
    expect(isOwnPrivatePath(`tenant-1/x.png?x=1`, rules)).toBe(false)
    expect(isOwnPrivatePath(`tenant-1/x\\y.png`, rules)).toBe(false)
    expect(isOwnPrivatePath(`https://abcd.supabase.co/tenant-1/x.png`, rules)).toBe(false)
  })
})
