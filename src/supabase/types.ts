/**
 * The smallest structural slice of a supabase-js v2 client that the store uses, so this package has no
 * `@supabase/supabase-js` dependency. A real `SupabaseClient` is meant to be assignable to `SupabaseLike`;
 * that has NOT been checked against the real type definitions (they are not installed here). If a product's
 * typed client does not fit, `client as unknown as SupabaseLike` is safe: only the calls below are made.
 */
import type { BrandGuideRef, BrandKit, BrandKitVersion, LogoAsset } from '../core/kit.js'
import type { PreparedGuide, PreparedLogo } from '../browser/types.js'

/** The error shape both PostgREST and Storage return. Storage errors may carry `statusCode`. */
export interface SupabaseErrorLike {
  message: string
  code?: string
  statusCode?: string | number
  details?: string | null
  hint?: string | null
}

export interface ResultLike<T = unknown> {
  data: T | null
  error: SupabaseErrorLike | null
}

/** A PostgREST filter builder: chainable, and awaitable for its result. */
export interface QueryLike extends PromiseLike<ResultLike> {
  select(columns?: string): QueryLike
  eq(column: string, value: unknown): QueryLike
  is(column: string, value: null): QueryLike
  order(column: string, options?: { ascending?: boolean }): QueryLike
  maybeSingle(): PromiseLike<ResultLike>
  single(): PromiseLike<ResultLike>
}

export interface TableLike {
  select(columns?: string): QueryLike
  insert(values: Record<string, unknown>): QueryLike
  update(values: Record<string, unknown>): QueryLike
  delete(): QueryLike
}

export interface UploadOptionsLike {
  contentType: string
  cacheControl: string
  upsert: false
}

export interface StorageBucketLike {
  upload(path: string, body: Blob, options: UploadOptionsLike): PromiseLike<ResultLike<{ path: string }>>
  /** Used only by `discardDraft`, to remove a draft's own files. */
  list(prefix: string, options?: { limit?: number; offset?: number }): PromiseLike<ResultLike<{ name: string }[]>>
  /** Used only by `discardDraft`. */
  remove(paths: string[]): PromiseLike<ResultLike>
}

export interface SupabaseLike {
  from(table: string): TableLike
  storage: { from(bucket: string): StorageBucketLike }
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<ResultLike>
}

/**
 * Everything a product's brand-kit screen needs from storage. Implemented by `supabaseBrandStore`; a
 * product with a different backend can implement it itself.
 */
export interface BrandKitStore {
  /** The tenant's live (published) kit, or null when it has never published one. */
  loadLive(): Promise<BrandKitVersion | null>
  /** The tenant's one draft, or null. */
  loadDraft(): Promise<BrandKitVersion | null>
  /** Starts a draft from the live kit (or an empty kit). If a draft already exists, returns it. */
  createDraft(): Promise<BrandKitVersion>
  /** Validates strictly and saves. Throws `KitError` when anything is refused; nothing is saved then. */
  saveDraft(id: string, kit: BrandKit): Promise<BrandKitVersion>
  /** Uploads a prepared logo's original (private) and PNGs (public). Does not change the draft's kit. */
  uploadLogo(draftId: string, prepared: PreparedLogo): Promise<LogoAsset>
  /** Uploads a prepared brand guide (private). Does not change the draft's kit. */
  uploadGuide(draftId: string, prepared: PreparedGuide): Promise<BrandGuideRef>
  /** Publishes the draft and makes it live, atomically (the `brand_kit_publish` rpc). */
  publish(draftId: string): Promise<BrandKitVersion>
  /** Makes an older published version live again (the `brand_kit_rollback` rpc). */
  rollback(versionId: string): Promise<void>
  /** Published versions, newest first. */
  listPublished(): Promise<BrandKitVersion[]>
  /** Deletes the draft and the files uploaded under it. Published files are never touched. */
  discardDraft(id: string): Promise<void>
  /** The public URL of a path in the public bucket. */
  publicUrl(path: string): string
}

export interface BrandStoreOptions {
  /** Default `brand_kit_versions`. */
  versionsTable?: string
  /** Default `brand_kit_live`. */
  liveTable?: string
}
