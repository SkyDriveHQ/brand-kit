/**
 * The brand-kit store on a product's own Supabase project (research §9). Shapes match `sql/brand_kit.sql`.
 *
 * What the database enforces and this code relies on: one draft per tenant, published rows never change,
 * files are never overwritten, and publish/rollback are atomic rpcs that check the caller's rights. What
 * this code adds: strict validation before every write, so the customer hears about a bad field in plain
 * English instead of a database error.
 */
import type { BrandGuideRef, BrandKit, BrandKitVersion, BrandStorageRules, LogoAsset, Rendition, RenditionName, VersionState } from '../core/kit.js'
import { PALETTE_KEEP } from '../core/kit.js'
import { guidePath, isSafeSegment, isVersionId, originalPath, publicAssetPath, publicAssetUrl, rulesAreValid } from '../core/paths.js'
import { KitError, parseKit } from '../core/validate.js'
import { draftFrom, publishProblems } from '../core/versions.js'
import type { PreparedGuide, PreparedLogo } from '../browser/types.js'
import type { BrandKitStore, BrandStoreOptions, ResultLike, SupabaseErrorLike, SupabaseLike } from './types.js'

/** One year, in seconds: every path is content-addressed, so a file at a path never changes. */
export const CACHE_CONTROL = '31536000'
export const PUBLISH_RPC = 'brand_kit_publish'
export const ROLLBACK_RPC = 'brand_kit_rollback'

/** A database or storage call failed. `code` is the Postgres / PostgREST code when there was one. */
export class BrandStoreError extends Error {
  readonly code: string | undefined
  constructor(action: string, error: SupabaseErrorLike) {
    super(`${action}: ${error.message}`)
    this.name = 'BrandStoreError'
    this.code = error.code
  }
}

interface VersionRow {
  id: string
  tenant_id: string | number
  state: VersionState
  kit: unknown
  based_on: string | null
  created_at: string
  created_by: string | null
  published_at: string | null
  published_by: string | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function isDuplicate(error: SupabaseErrorLike): boolean {
  return String(error.statusCode ?? '') === '409' || /already exists|duplicate/i.test(error.message)
}

function check<T>(action: string, result: ResultLike<T>): T | null {
  if (result.error) throw new BrandStoreError(action, result.error)
  return result.data
}

function assertId(name: string, id: string): void {
  // Version ids are uuids (brand_kit_versions generates them), the shape the storage policies accept.
  if (!isVersionId(id)) throw new Error(`Invalid ${name}: ${JSON.stringify(id)}`)
}

/**
 * A `BrandKitStore` on a Supabase client. `rules.tenantId` scopes every query; RLS on the database is what
 * actually enforces it.
 */
export function supabaseBrandStore(client: SupabaseLike, rules: BrandStorageRules, options: BrandStoreOptions = {}): BrandKitStore {
  if (!rulesAreValid(rules)) throw new Error('supabaseBrandStore: invalid BrandStorageRules (see paths.ts rulesAreValid)')
  const versionsTable = options.versionsTable ?? 'brand_kit_versions'
  const liveTable = options.liveTable ?? 'brand_kit_live'
  const tenant = rules.tenantId

  function toVersion(row: unknown): BrandKitVersion {
    if (!isRecord(row)) throw new Error('A brand kit version row could not be read')
    const r = row as Partial<VersionRow>
    const id = str(r.id)
    const state = r.state
    if (id === null || (state !== 'draft' && state !== 'published')) throw new Error('A brand kit version row could not be read')
    if (String(r.tenant_id) !== tenant) throw new Error('A brand kit version for another business was returned')
    return {
      id,
      tenantId: tenant,
      state,
      // Stored rows are read leniently: one bad value is dropped rather than blanking the screen.
      kit: parseKit(r.kit, rules, 'lenient').kit,
      basedOn: str(r.based_on),
      createdAt: str(r.created_at) ?? '',
      createdBy: str(r.created_by),
      publishedAt: str(r.published_at),
      publishedBy: str(r.published_by),
    }
  }

  async function getRow(id: string): Promise<unknown> {
    return check('Loading a brand kit version', await client.from(versionsTable).select('*').eq('id', id).eq('tenant_id', tenant).maybeSingle())
  }

  async function getVersion(id: string): Promise<BrandKitVersion | null> {
    const row = await getRow(id)
    return row === null ? null : toVersion(row)
  }

  async function loadDraft(): Promise<BrandKitVersion | null> {
    const row = check(
      'Loading the brand kit draft',
      await client.from(versionsTable).select('*').eq('tenant_id', tenant).eq('state', 'draft').maybeSingle(),
    )
    return row === null ? null : toVersion(row)
  }

  async function loadLive(): Promise<BrandKitVersion | null> {
    const pointer = check('Loading the live brand kit', await client.from(liveTable).select('version_id').eq('tenant_id', tenant).maybeSingle())
    if (!isRecord(pointer)) return null
    const versionId = str(pointer.version_id)
    if (versionId === null) return null
    return getVersion(versionId)
  }

  async function upload(bucket: string, path: string, blob: Blob, contentType: string): Promise<void> {
    const result = await client.storage.from(bucket).upload(path, blob, { contentType, cacheControl: CACHE_CONTROL, upsert: false })
    // Paths are content hashes, so "already exists" means these exact bytes are already there.
    if (result.error && !isDuplicate(result.error)) throw new BrandStoreError(`Uploading ${path}`, result.error)
  }

  async function removeFolder(bucket: string, folder: string): Promise<void> {
    const pageSize = 100
    // A draft holds a few dozen files at most; the cap only stops a runaway loop.
    for (let pass = 0; pass < 50; pass++) {
      // Always list from the start: each pass removes what it found.
      const listed = check(`Listing ${bucket}/${folder}`, await client.storage.from(bucket).list(folder, { limit: pageSize }))
      const names = (listed ?? []).map((e) => e.name).filter((n): n is string => typeof n === 'string' && n !== '')
      if (names.length === 0) return
      const removed = check(`Removing files from ${bucket}/${folder}`, await client.storage.from(bucket).remove(names.map((n) => `${folder}/${n}`)))
      // Storage reports a delete that RLS refused as success with nothing removed; say so instead of looping.
      if (Array.isArray(removed) && removed.length === 0) {
        throw new Error(`The draft's files in ${bucket} could not be deleted (permission refused).`)
      }
      if (names.length < pageSize) return
    }
    throw new Error(`The draft's files in ${bucket} could not all be deleted.`)
  }

  return {
    loadLive,
    loadDraft,

    async createDraft() {
      const existing = await loadDraft()
      if (existing) return existing
      const live = await loadLive()
      // Only these three columns are granted for insert; `state` defaults to 'draft' and `created_by` to the caller.
      const result = await client
        .from(versionsTable)
        .insert({ tenant_id: tenant, kit: draftFrom(live), based_on: live?.id ?? null })
        .select('*')
        .single()
      if (result.error) {
        // Another tab made the draft first (one draft per tenant, by unique index): use that one.
        if (result.error.code === '23505') {
          const raced = await loadDraft()
          if (raced) return raced
        }
        throw new BrandStoreError('Starting a brand kit draft', result.error)
      }
      return toVersion(result.data)
    },

    async saveDraft(id, kit: BrandKit) {
      assertId('draft id', id)
      const { kit: clean, problems } = parseKit(kit, rules, 'strict')
      if (problems.some((p) => p.severity === 'refused')) throw new KitError(problems)
      const row = check(
        'Saving the brand kit draft',
        await client.from(versionsTable).update({ kit: clean }).eq('id', id).eq('tenant_id', tenant).eq('state', 'draft').select('*').maybeSingle(),
      )
      if (row === null) throw new Error('This draft no longer exists or has already been published. Reload to see the current brand kit.')
      return toVersion(row)
    },

    async uploadLogo(draftId, prepared: PreparedLogo): Promise<LogoAsset> {
      assertId('draft id', draftId)
      const original = originalPath(rules, draftId, prepared.original.sha256, prepared.original.ext)
      await upload(rules.privateBucket, original, prepared.original.blob, prepared.original.type)
      const renditions: Partial<Record<RenditionName, Rendition>> = {}
      for (const r of prepared.renditions) {
        const path = publicAssetPath(rules, draftId, r.sha256)
        await upload(rules.publicBucket, path, r.blob, 'image/png')
        renditions[r.name] = { url: publicAssetUrl(rules, path), width: r.width, height: r.height, bytes: r.blob.size, sha256: r.sha256 }
      }
      return {
        originalPath: original,
        originalType: prepared.original.type,
        originalName: prepared.original.name,
        aspect: prepared.aspect,
        tone: { luminance: prepared.tone.luminance, transparent: prepared.tone.transparent },
        renditions,
        ...(prepared.palette.length > 0 ? { palette: prepared.palette.slice(0, PALETTE_KEEP).map((p) => ({ hex: p.hex, share: p.share })) } : {}),
      }
    },

    async uploadGuide(draftId, prepared: PreparedGuide): Promise<BrandGuideRef> {
      assertId('draft id', draftId)
      const path = guidePath(rules, draftId, prepared.sha256)
      await upload(rules.privateBucket, path, prepared.blob, 'application/pdf')
      return { path, name: prepared.name, bytes: prepared.bytes, uploadedAt: new Date().toISOString() }
    },

    async publish(draftId) {
      assertId('draft id', draftId)
      const row = await getRow(draftId)
      if (row === null) throw new Error('This draft no longer exists. Reload to see the current brand kit.')
      // Check the kit AS STORED, not the lenient reading of it: a row written around saveDraft (a tampered
      // browser calling PostgREST directly) must not be published just because reading it drops the bad part.
      const stored = isRecord(row) ? row.kit : undefined
      const problems = publishProblems({ ...toVersion(row), kit: stored as BrandKit }, rules)
      if (problems.some((p) => p.severity === 'refused')) throw new KitError(problems)
      const data = check('Publishing the brand kit', await client.rpc(PUBLISH_RPC, { draft_id: draftId }))
      return toVersion(Array.isArray(data) ? data[0] : data)
    },

    async rollback(versionId) {
      assertId('version id', versionId)
      check('Rolling back the brand kit', await client.rpc(ROLLBACK_RPC, { version_id: versionId }))
    },

    async listPublished() {
      const rows = check(
        'Loading published brand kits',
        await client.from(versionsTable).select('*').eq('tenant_id', tenant).eq('state', 'published').order('published_at', { ascending: false }),
      )
      return Array.isArray(rows) ? rows.map(toVersion) : []
    },

    async discardDraft(id) {
      assertId('draft id', id)
      const version = await getVersion(id)
      if (version === null) return
      if (version.state !== 'draft') throw new Error('A published brand kit cannot be discarded.')
      // Files first: the storage delete policy allows deleting only under a folder whose draft row still exists.
      const folder = `${tenant}/${id}`
      await removeFolder(rules.publicBucket, folder)
      await removeFolder(rules.privateBucket, folder)
      check('Discarding the brand kit draft', await client.from(versionsTable).delete().eq('id', id).eq('tenant_id', tenant).eq('state', 'draft'))
    },

    publicUrl(path) {
      return publicAssetUrl(rules, path)
    },
  }
}
