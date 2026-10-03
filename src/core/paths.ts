/**
 * Every storage path and public address for brand files, built from one `BrandStorageRules` object.
 *
 * The same rules drive `isOwnPublicAssetUrl`, which `parseKit` uses to decide whether a URL in a kit is
 * one of ours. The check is an allowlist of one exact shape, parsed by hand (no `URL` object, so core
 * stays free of DOM and Node globals): anything that is not exactly
 * `https://<origin>/storage/v1/object/public/<bucket>/<tenant>/<version>/<64 hex>.png` is refused.
 */
import type { BrandStorageRules } from './kit.js'

/** A single path segment we create ourselves: a tenant id, a version id, a bucket name. */
const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/
const SHA256 = /^[0-9a-f]{64}$/
const ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::[0-9]{1,5})?$/

/** File extensions a customer's original may be stored under. */
export const ORIGINAL_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'svg'] as const
export type OriginalExtension = (typeof ORIGINAL_EXTENSIONS)[number]

export function isSafeSegment(s: unknown): s is string {
  return typeof s === 'string' && SEGMENT.test(s)
}

export function isSha256Hex(s: unknown): s is string {
  return typeof s === 'string' && SHA256.test(s)
}

/** True when the rules are well formed. Malformed rules make every check fail closed. */
export function rulesAreValid(rules: BrandStorageRules): boolean {
  return (
    typeof rules === 'object' &&
    rules !== null &&
    typeof rules.storageOrigin === 'string' &&
    ORIGIN.test(rules.storageOrigin) &&
    isSafeSegment(rules.publicBucket) &&
    isSafeSegment(rules.privateBucket) &&
    isSafeSegment(rules.tenantId)
  )
}

function assertRules(rules: BrandStorageRules): void {
  if (!rulesAreValid(rules)) {
    throw new Error(
      'Invalid BrandStorageRules: storageOrigin must be https://host[:port] in lower case with no path, and the buckets and tenantId must be letters, digits, "-" or "_".',
    )
  }
}

function assertSegment(name: string, value: string): void {
  if (!isSafeSegment(value)) throw new Error(`Invalid ${name}: must be letters, digits, "-" or "_"`)
}

function assertSha(value: string): void {
  if (!isSha256Hex(value)) throw new Error('Invalid sha256: must be 64 lower-case hex characters')
}

/** `${tenantId}/${versionId}/${sha256}.png`, in the public bucket. */
export function publicAssetPath(rules: BrandStorageRules, versionId: string, sha256: string): string {
  assertRules(rules)
  assertSegment('versionId', versionId)
  assertSha(sha256)
  return `${rules.tenantId}/${versionId}/${sha256}.png`
}

/** The public address of a path in the public bucket. */
export function publicAssetUrl(rules: BrandStorageRules, path: string): string {
  assertRules(rules)
  if (!isOwnPublicAssetPath(path, rules)) throw new Error('Not a public asset path for this tenant')
  return `${publicPrefix(rules)}${path}`
}

/** `${tenantId}/${versionId}/original-${sha256}.${ext}`, in the private bucket. */
export function originalPath(rules: BrandStorageRules, versionId: string, sha256: string, ext: string): string {
  assertRules(rules)
  assertSegment('versionId', versionId)
  assertSha(sha256)
  if (!(ORIGINAL_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`Invalid extension: must be one of ${ORIGINAL_EXTENSIONS.join(', ')}`)
  }
  return `${rules.tenantId}/${versionId}/original-${sha256}.${ext}`
}

/** `${tenantId}/${versionId}/guide-${sha256}.pdf`, in the private bucket. */
export function guidePath(rules: BrandStorageRules, versionId: string, sha256: string): string {
  assertRules(rules)
  assertSegment('versionId', versionId)
  assertSha(sha256)
  return `${rules.tenantId}/${versionId}/guide-${sha256}.pdf`
}

function publicPrefix(rules: BrandStorageRules): string {
  return `${rules.storageOrigin}/storage/v1/object/public/${rules.publicBucket}/`
}

function isOwnPublicAssetPath(path: string, rules: BrandStorageRules): boolean {
  if (typeof path !== 'string') return false
  const prefix = `${rules.tenantId}/`
  if (!path.startsWith(prefix)) return false
  const parts = path.slice(prefix.length).split('/')
  if (parts.length !== 2) return false
  const [version, file] = parts
  if (!isSafeSegment(version) || typeof file !== 'string' || !file.endsWith('.png')) return false
  return isSha256Hex(file.slice(0, -4))
}

/**
 * True only for an https address of a PNG in this product's public bucket, under this tenant, at a
 * content-hash file name. Refuses other origins (including look-alikes such as `https://origin.evil.example`
 * and `https://origin@evil`), other buckets and tenants, `..`, percent-encoding, query strings, fragments,
 * credentials and upper-case hashes.
 */
export function isOwnPublicAssetUrl(url: unknown, rules: BrandStorageRules): boolean {
  if (typeof url !== 'string' || !rulesAreValid(rules)) return false
  if (url.length > 2048) return false
  // Nothing outside the exact shape is ever needed, so refuse the characters URL tricks are made of.
  if (/[\s\\?#%@]/.test(url) || /[^\x21-\x7e]/.test(url)) return false
  const prefix = publicPrefix(rules)
  if (!url.startsWith(prefix)) return false
  return isOwnPublicAssetPath(url.slice(prefix.length), rules)
}

/** True when a private-bucket path (an original or a guide) belongs to this tenant and is well formed. */
export function isOwnPrivatePath(path: unknown, rules: BrandStorageRules): boolean {
  if (typeof path !== 'string' || !rulesAreValid(rules)) return false
  const prefix = `${rules.tenantId}/`
  if (!path.startsWith(prefix)) return false
  const parts = path.slice(prefix.length).split('/')
  if (parts.length < 1 || parts.length > 4) return false
  return parts.every((p) => /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/.test(p) && !p.includes('..'))
}
