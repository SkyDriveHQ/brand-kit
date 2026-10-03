import { beforeEach, describe, expect, it } from 'vitest'
import { BrandStoreError, supabaseBrandStore } from '../src/supabase/store.js'
import type { QueryLike, ResultLike, StorageBucketLike, SupabaseLike, TableLike, UploadOptionsLike } from '../src/supabase/types.js'
import type { PreparedGuide, PreparedLogo } from '../src/browser/types.js'
import type { BrandKit, BrandStorageRules } from '../src/core/kit.js'
import { emptyKit } from '../src/core/kit.js'
import { KitError } from '../src/core/validate.js'

// ---------------------------------------------------------------------------------------------------------
// A hand-written fake of the supabase-js calls the store makes. Tables are in memory, storage is a map per
// bucket, and every call is recorded. The rpcs mimic sql/brand_kit.sql.
// ---------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>
interface Call {
  kind: 'select' | 'insert' | 'update' | 'delete' | 'upload' | 'list' | 'remove' | 'rpc'
  target: string
  values?: unknown
  filters?: [string, unknown][]
  order?: [string, boolean]
  options?: unknown
}

class FakeSupabase implements SupabaseLike {
  tables: Record<string, Row[]> = { brand_kit_versions: [], brand_kit_live: [] }
  files: Record<string, Map<string, { blob: Blob; options: UploadOptionsLike }>> = {}
  calls: Call[] = []
  nextId = 1
  clock = 0
  /** Runs just before an insert is applied (to simulate another tab winning a race). */
  beforeInsert: (() => void) | null = null
  uploadError: ResultLike['error'] = null
  removeRefused = false
  rpcError: ResultLike['error'] = null

  now(): string {
    return new Date(Date.UTC(2026, 9, 2, 12, 0, this.clock++)).toISOString()
  }

  from(table: string): TableLike {
    return {
      select: (columns) => new FakeQuery(this, table, 'select', columns),
      insert: (values) => new FakeQuery(this, table, 'insert', undefined, values),
      update: (values) => new FakeQuery(this, table, 'update', undefined, values),
      delete: () => new FakeQuery(this, table, 'delete'),
    }
  }

  storage = {
    from: (bucket: string): StorageBucketLike => {
      const files = (this.files[bucket] ??= new Map())
      return {
        upload: async (path, blob, options) => {
          this.calls.push({ kind: 'upload', target: `${bucket}/${path}`, options })
          if (this.uploadError) return { data: null, error: this.uploadError }
          if (files.has(path)) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } }
          files.set(path, { blob, options })
          return { data: { path }, error: null }
        },
        list: async (prefix, options) => {
          this.calls.push({ kind: 'list', target: `${bucket}/${prefix}`, options })
          const names = [...files.keys()].filter((p) => p.startsWith(`${prefix}/`) && !p.slice(prefix.length + 1).includes('/'))
          return { data: names.slice(0, options?.limit ?? 100).map((p) => ({ name: p.slice(prefix.length + 1) })), error: null }
        },
        remove: async (paths) => {
          this.calls.push({ kind: 'remove', target: bucket, values: paths })
          if (this.removeRefused) return { data: [], error: null }
          const gone = paths.filter((p) => files.delete(p))
          return { data: gone.map((name) => ({ name })), error: null }
        },
      }
    },
  }

  async rpc(fn: string, args: Record<string, unknown>): Promise<ResultLike> {
    this.calls.push({ kind: 'rpc', target: fn, values: args })
    if (this.rpcError) return { data: null, error: this.rpcError }
    const versions = this.tables.brand_kit_versions ?? []
    const live = this.tables.brand_kit_live ?? []
    if (fn === 'brand_kit_publish') {
      const row = versions.find((r) => r.id === args.draft_id)
      if (!row || row.state !== 'draft') return { data: null, error: { message: 'only a draft can be published', code: '22023' } }
      Object.assign(row, { state: 'published', published_at: this.now(), published_by: 'user-1' })
      const pointer = live.find((l) => l.tenant_id === row.tenant_id)
      if (pointer) pointer.version_id = row.id
      else live.push({ tenant_id: row.tenant_id, version_id: row.id })
      return { data: { ...row }, error: null }
    }
    if (fn === 'brand_kit_rollback') {
      const row = versions.find((r) => r.id === args.version_id)
      if (!row || row.state !== 'published') return { data: null, error: { message: 'only a published version can be made live', code: '22023' } }
      const pointer = live.find((l) => l.tenant_id === row.tenant_id)
      if (pointer) pointer.version_id = row.id
      else live.push({ tenant_id: row.tenant_id, version_id: row.id })
      return { data: null, error: null }
    }
    return { data: null, error: { message: `no function ${fn}` } }
  }

  /** Seeds a version row directly. */
  seed(row: Partial<Row> & { id: string; state: 'draft' | 'published' }): Row {
    const full: Row = {
      tenant_id: 'site-1',
      kit: emptyKit(),
      based_on: null,
      created_at: this.now(),
      created_by: 'user-1',
      published_at: row.state === 'published' ? this.now() : null,
      published_by: row.state === 'published' ? 'user-1' : null,
      ...row,
    }
    this.tables.brand_kit_versions?.push(full)
    return full
  }
}

class FakeQuery implements QueryLike {
  private filters: [string, unknown][] = []
  private orderBy: [string, boolean] | undefined
  private returning = false

  constructor(
    private db: FakeSupabase,
    private table: string,
    private op: 'select' | 'insert' | 'update' | 'delete',
    columns?: string,
    private values?: Record<string, unknown>,
  ) {
    if (op === 'select') this.returning = true
    void columns
  }

  select(): QueryLike {
    this.returning = true
    return this
  }
  eq(column: string, value: unknown): QueryLike {
    this.filters.push([column, value])
    return this
  }
  is(column: string, value: null): QueryLike {
    this.filters.push([column, value])
    return this
  }
  order(column: string, options?: { ascending?: boolean }): QueryLike {
    this.orderBy = [column, options?.ascending ?? true]
    return this
  }
  maybeSingle(): PromiseLike<ResultLike> {
    return this.run().then((r) => {
      if (r.error) return r
      const rows = (r.data as Row[] | null) ?? []
      if (rows.length > 1) return { data: null, error: { message: 'more than one row', code: 'PGRST116' } }
      return { data: rows[0] ?? null, error: null }
    })
  }
  single(): PromiseLike<ResultLike> {
    return this.run().then((r) => {
      if (r.error) return r
      const rows = (r.data as Row[] | null) ?? []
      if (rows.length !== 1) return { data: null, error: { message: 'expected one row', code: 'PGRST116' } }
      return { data: rows[0], error: null }
    })
  }
  then<A = ResultLike, B = never>(ok?: ((v: ResultLike) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(ok, bad)
  }

  private matches(row: Row): boolean {
    return this.filters.every(([c, v]) => row[c] === v)
  }

  private async run(): Promise<ResultLike> {
    const db = this.db
    const rows = (db.tables[this.table] ??= [])
    db.calls.push({ kind: this.op, target: this.table, values: this.values, filters: [...this.filters], ...(this.orderBy ? { order: this.orderBy } : {}) })
    if (this.op === 'select') {
      const out = rows.filter((r) => this.matches(r)).map((r) => ({ ...r }))
      if (this.orderBy) {
        const [col, asc] = this.orderBy
        out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
      }
      return { data: out, error: null }
    }
    if (this.op === 'insert') {
      db.beforeInsert?.()
      const row: Row = { id: `00000000-0000-4000-8000-${String(db.nextId++).padStart(12, '0')}`, state: 'draft', created_at: db.now(), created_by: 'user-1', published_at: null, published_by: null, ...this.values }
      if (this.table === 'brand_kit_versions' && rows.some((r) => r.tenant_id === row.tenant_id && r.state === 'draft')) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint "brand_kit_versions_one_draft"', code: '23505' } }
      }
      rows.push(row)
      return { data: this.returning ? [{ ...row }] : null, error: null }
    }
    if (this.op === 'update') {
      const hit = rows.filter((r) => this.matches(r))
      for (const r of hit) Object.assign(r, this.values)
      return { data: this.returning ? hit.map((r) => ({ ...r })) : null, error: null }
    }
    const keep = rows.filter((r) => !this.matches(r))
    db.tables[this.table] = keep
    return { data: null, error: null }
  }
}

/** A client whose every query answers `result`, ignoring filters. */
function answering(result: ResultLike): SupabaseLike {
  const q: QueryLike = {
    select: () => q,
    eq: () => q,
    is: () => q,
    order: () => q,
    maybeSingle: async () => result,
    single: async () => result,
    then: (ok, bad) => Promise.resolve(result).then(ok, bad),
  }
  const unused = async () => ({ data: null, error: { message: 'not used' } })
  return {
    from: () => ({ select: () => q, insert: () => q, update: () => q, delete: () => q }),
    storage: { from: () => ({ upload: unused, list: unused, remove: unused }) },
    rpc: unused,
  }
}

// ---------------------------------------------------------------------------------------------------------

const RULES: BrandStorageRules = {
  storageOrigin: 'https://abcd.supabase.co',
  publicBucket: 'brand-assets',
  privateBucket: 'brand-originals',
  tenantId: 'site-1',
}

const SHA = (c: string) => c.repeat(64)

function preparedLogo(): PreparedLogo {
  return {
    slot: 'logo',
    original: { blob: new Blob(['original-bytes'], { type: 'image/png' }), type: 'image/png', name: 'Acme.png', sha256: SHA('a'), ext: 'png' },
    renditions: [
      { name: 'web', blob: new Blob(['web-png']), width: 360, height: 96, sha256: SHA('b') },
      { name: 'email', blob: new Blob(['email-png!']), width: 450, height: 120, sha256: SHA('c') },
    ],
    tone: { luminance: 0.1, transparent: true },
    aspect: 4,
    palette: [],
    problems: [],
  }
}

const preparedGuide: PreparedGuide = { blob: new Blob(['%PDF-1.7']), name: 'Guide.pdf', bytes: 8, sha256: SHA('d') }

let db: FakeSupabase
let store: ReturnType<typeof supabaseBrandStore>
beforeEach(() => {
  db = new FakeSupabase()
  store = supabaseBrandStore(db, RULES)
})

const callsOf = (kind: Call['kind']) => db.calls.filter((c) => c.kind === kind)

describe('createDraft / loadDraft / loadLive', () => {
  it('starts an empty draft when nothing is live, inserting only the granted columns', async () => {
    const draft = await store.createDraft()
    expect(draft).toMatchObject({ id: '00000000-0000-4000-8000-000000000001', tenantId: 'site-1', state: 'draft', basedOn: null, kit: emptyKit() })
    expect(callsOf('insert')).toEqual([
      { kind: 'insert', target: 'brand_kit_versions', values: { tenant_id: 'site-1', kit: emptyKit(), based_on: null }, filters: [] },
    ])
    expect(await store.loadDraft()).toEqual(draft)
    expect(await store.loadLive()).toBeNull()
  })

  it('starts a draft from a deep copy of the live kit', async () => {
    const kit: BrandKit = { ...emptyKit(), name: 'Acme Skydiving', colors: { primary: '#cc0000' } }
    db.seed({ id: '00000000-0000-4000-8000-0000000000a1', state: 'published', kit })
    db.tables.brand_kit_live?.push({ tenant_id: 'site-1', version_id: '00000000-0000-4000-8000-0000000000a1' })
    const draft = await store.createDraft()
    expect(draft.basedOn).toBe('00000000-0000-4000-8000-0000000000a1')
    expect(draft.kit).toEqual(kit)
    expect(draft.kit).not.toBe(kit)
  })

  it('returns the existing draft instead of making a second', async () => {
    db.seed({ id: '00000000-0000-4000-8000-0000000000d1', state: 'draft' })
    expect((await store.createDraft()).id).toBe('00000000-0000-4000-8000-0000000000d1')
    expect(callsOf('insert')).toEqual([])
  })

  it('returns the other tab\'s draft when it wins the one-draft race', async () => {
    db.beforeInsert = () => {
      db.beforeInsert = null
      db.seed({ id: 'raced', state: 'draft' })
    }
    expect((await store.createDraft()).id).toBe('raced')
  })

  it('reads stored rows leniently: a bad stored value is dropped, not fatal', async () => {
    db.seed({ id: '00000000-0000-4000-8000-0000000000d1', state: 'draft', kit: { schemaVersion: 1, name: 'Acme', colors: { primary: 'javascript:alert(1)' }, logos: {}, fonts: {} } })
    const draft = await store.loadDraft()
    expect(draft?.kit.name).toBe('Acme')
    expect(draft?.kit.colors).toEqual({})
  })

  it('refuses a row that belongs to another tenant (if RLS or the filter ever let one through)', async () => {
    const stranger = { id: '00000000-0000-4000-8000-0000000000d1', tenant_id: 'site-2', state: 'draft', kit: emptyKit() }
    await expect(supabaseBrandStore(answering({ data: stranger, error: null }), RULES).loadDraft()).rejects.toThrow(/another business/)
  })

  it('turns a database error into a BrandStoreError', async () => {
    const denied = answering({ data: null, error: { message: 'permission denied for table brand_kit_versions', code: '42501' } })
    const err = await supabaseBrandStore(denied, RULES).loadDraft().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BrandStoreError)
    expect((err as BrandStoreError).code).toBe('42501')
  })
})

describe('uploadLogo / uploadGuide', () => {
  it('puts the original in the private bucket and the PNGs in the public bucket, at content-hash paths, never overwriting', async () => {
    const asset = await store.uploadLogo('00000000-0000-4000-8000-0000000000d1', preparedLogo())
    const uploads = callsOf('upload')
    expect(uploads.map((u) => u.target)).toEqual([
      `brand-originals/site-1/00000000-0000-4000-8000-0000000000d1/original-${SHA('a')}.png`,
      `brand-assets/site-1/00000000-0000-4000-8000-0000000000d1/${SHA('b')}.png`,
      `brand-assets/site-1/00000000-0000-4000-8000-0000000000d1/${SHA('c')}.png`,
    ])
    expect(uploads.map((u) => u.options)).toEqual([
      { contentType: 'image/png', cacheControl: '31536000', upsert: false },
      { contentType: 'image/png', cacheControl: '31536000', upsert: false },
      { contentType: 'image/png', cacheControl: '31536000', upsert: false },
    ])
    expect(asset).toEqual({
      originalPath: `site-1/00000000-0000-4000-8000-0000000000d1/original-${SHA('a')}.png`,
      originalType: 'image/png',
      originalName: 'Acme.png',
      aspect: 4,
      tone: { luminance: 0.1, transparent: true },
      renditions: {
        web: { url: `https://abcd.supabase.co/storage/v1/object/public/brand-assets/site-1/00000000-0000-4000-8000-0000000000d1/${SHA('b')}.png`, width: 360, height: 96, bytes: 7, sha256: SHA('b') },
        email: { url: `https://abcd.supabase.co/storage/v1/object/public/brand-assets/site-1/00000000-0000-4000-8000-0000000000d1/${SHA('c')}.png`, width: 450, height: 120, bytes: 10, sha256: SHA('c') },
      },
    })
  })

  it('treats "already exists" as done (same path, same bytes), so a retry succeeds', async () => {
    await store.uploadLogo('00000000-0000-4000-8000-0000000000d1', preparedLogo())
    await expect(store.uploadLogo('00000000-0000-4000-8000-0000000000d1', preparedLogo())).resolves.toBeDefined()
    expect(callsOf('upload')).toHaveLength(6)
  })

  it('throws any other upload error', async () => {
    db.uploadError = { message: 'new row violates row-level security policy', statusCode: '403' }
    await expect(store.uploadLogo('00000000-0000-4000-8000-0000000000d1', preparedLogo())).rejects.toBeInstanceOf(BrandStoreError)
  })

  it('refuses an unsafe draft id before touching storage', async () => {
    await expect(store.uploadLogo('../other-site', preparedLogo())).rejects.toThrow(/Invalid draft id/)
    expect(db.calls).toEqual([])
  })

  it('puts a guide in the private bucket as a PDF', async () => {
    const ref = await store.uploadGuide('00000000-0000-4000-8000-0000000000d1', preparedGuide)
    expect(callsOf('upload')).toEqual([
      { kind: 'upload', target: `brand-originals/site-1/00000000-0000-4000-8000-0000000000d1/guide-${SHA('d')}.pdf`, options: { contentType: 'application/pdf', cacheControl: '31536000', upsert: false } },
    ])
    expect(ref).toMatchObject({ path: `site-1/00000000-0000-4000-8000-0000000000d1/guide-${SHA('d')}.pdf`, name: 'Guide.pdf', bytes: 8 })
    expect(Number.isNaN(Date.parse(ref.uploadedAt))).toBe(false)
  })
})

describe('saveDraft', () => {
  it('validates strictly, saves the repaired kit, and only ever updates a draft of this tenant', async () => {
    const draft = await store.createDraft()
    const logo = await store.uploadLogo(draft.id, preparedLogo())
    const saved = await store.saveDraft(draft.id, { ...emptyKit(), name: '  Acme   Skydiving ', colors: { primary: '#C00' }, logos: { logo } })
    expect(saved.kit.colors.primary).toBe('#cc0000')
    expect(saved.kit.name).toBe('Acme Skydiving')
    expect(saved.kit.logos.logo?.renditions.web?.sha256).toBe(SHA('b'))
    const update = callsOf('update')[0]
    expect(update?.filters).toEqual([
      ['id', draft.id],
      ['tenant_id', 'site-1'],
      ['state', 'draft'],
    ])
  })

  it('refuses a kit with any refused field and saves nothing', async () => {
    const draft = await store.createDraft()
    const err = await store.saveDraft(draft.id, { ...emptyKit(), colors: { primary: 'red' } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(KitError)
    expect((err as KitError).problems.some((p) => p.severity === 'refused' && p.field === 'colors.primary')).toBe(true)
    expect(callsOf('update')).toEqual([])
  })

  it('refuses a logo URL that is not in our own public bucket', async () => {
    const draft = await store.createDraft()
    const logo = await store.uploadLogo(draft.id, preparedLogo())
    logo.renditions.web = { ...logo.renditions.web!, url: `https://evil.example/brand-assets/site-1/00000000-0000-4000-8000-0000000000d1/${SHA('b')}.png` }
    await expect(store.saveDraft(draft.id, { ...emptyKit(), logos: { logo } })).rejects.toBeInstanceOf(KitError)
  })

  it('says so when the draft is gone or already published', async () => {
    db.seed({ id: '00000000-0000-4000-8000-0000000000a1', state: 'published' })
    await expect(store.saveDraft('00000000-0000-4000-8000-0000000000a1', emptyKit())).rejects.toThrow(/no longer exists or has already been published/)
  })
})

describe('publish / rollback / listPublished', () => {
  it('publishes through the rpc and the result is live', async () => {
    const draft = await store.createDraft()
    await store.saveDraft(draft.id, { ...emptyKit(), name: 'Acme' })
    const published = await store.publish(draft.id)
    expect(callsOf('rpc')).toEqual([{ kind: 'rpc', target: 'brand_kit_publish', values: { draft_id: draft.id } }])
    expect(published).toMatchObject({ id: draft.id, state: 'published', publishedBy: 'user-1' })
    expect(published.publishedAt).not.toBeNull()
    expect((await store.loadLive())?.id).toBe(draft.id)
    expect(await store.loadDraft()).toBeNull()
  })

  it('accepts the rpc returning a one-row array', async () => {
    const draft = await store.createDraft()
    const rpc = db.rpc.bind(db)
    db.rpc = async (fn, args) => {
      const r = await rpc(fn, args)
      return { data: [r.data], error: r.error }
    }
    expect((await store.publish(draft.id)).state).toBe('published')
  })

  it('refuses to publish a version that is not a draft, without calling the rpc', async () => {
    db.seed({ id: '00000000-0000-4000-8000-0000000000a1', state: 'published' })
    await expect(store.publish('00000000-0000-4000-8000-0000000000a1')).rejects.toBeInstanceOf(KitError)
    expect(callsOf('rpc')).toEqual([])
  })

  it('refuses to publish a stored draft a tampered browser saved, without calling the rpc', async () => {
    db.seed({ id: '00000000-0000-4000-8000-0000000000d1', state: 'draft', kit: { ...emptyKit(), colors: { primary: 'url(javascript:1)' } } })
    await expect(store.publish('00000000-0000-4000-8000-0000000000d1')).rejects.toBeInstanceOf(KitError)
    expect(callsOf('rpc')).toEqual([])
  })

  it('throws when the draft does not exist', async () => {
    await expect(store.publish('00000000-0000-4000-8000-00000000dead')).rejects.toThrow(/no longer exists/)
  })

  it('rolls back through the rpc', async () => {
    db.seed({ id: '00000000-0000-4000-8000-0000000000a1', state: 'published' })
    db.seed({ id: '00000000-0000-4000-8000-0000000000a2', state: 'published' })
    db.tables.brand_kit_live?.push({ tenant_id: 'site-1', version_id: '00000000-0000-4000-8000-0000000000a2' })
    await store.rollback('00000000-0000-4000-8000-0000000000a1')
    expect(callsOf('rpc')).toEqual([{ kind: 'rpc', target: 'brand_kit_rollback', values: { version_id: '00000000-0000-4000-8000-0000000000a1' } }])
    expect((await store.loadLive())?.id).toBe('00000000-0000-4000-8000-0000000000a1')
  })

  it('surfaces an rpc error', async () => {
    db.rpcError = { message: 'not allowed to edit this tenant', code: '42501' }
    await expect(store.rollback('00000000-0000-4000-8000-0000000000a1')).rejects.toBeInstanceOf(BrandStoreError)
  })

  it('lists published versions newest first', async () => {
    db.seed({ id: '00000000-0000-4000-8000-0000000000a1', state: 'published', published_at: '2026-01-01T00:00:00.000Z' })
    db.seed({ id: '00000000-0000-4000-8000-0000000000d1', state: 'draft' })
    db.seed({ id: '00000000-0000-4000-8000-0000000000a2', state: 'published', published_at: '2026-06-01T00:00:00.000Z' })
    expect((await store.listPublished()).map((v) => v.id)).toEqual(['00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1'])
    expect(callsOf('select').at(-1)?.order).toEqual(['published_at', false])
  })
})

describe('discardDraft', () => {
  it('removes the draft\'s own files from both buckets, then the row, leaving other versions\' files alone', async () => {
    db.seed({ id: '00000000-0000-4000-8000-0000000000a1', state: 'published' })
    await store.uploadLogo('00000000-0000-4000-8000-0000000000a1', preparedLogo())
    const draft = await store.createDraft()
    await store.uploadLogo(draft.id, preparedLogo())
    await store.uploadGuide(draft.id, preparedGuide)

    await store.discardDraft(draft.id)

    const order = db.calls.slice(-6).map((c) => c.kind)
    expect(order).toEqual(['select', 'list', 'remove', 'list', 'remove', 'delete'])
    expect([...(db.files['brand-assets']?.keys() ?? [])].every((p) => p.startsWith('site-1/00000000-0000-4000-8000-0000000000a1/'))).toBe(true)
    expect([...(db.files['brand-originals']?.keys() ?? [])].every((p) => p.startsWith('site-1/00000000-0000-4000-8000-0000000000a1/'))).toBe(true)
    expect(db.files['brand-assets']?.size).toBe(2)
    expect(await store.loadDraft()).toBeNull()
  })

  it('refuses to discard a published version', async () => {
    db.seed({ id: '00000000-0000-4000-8000-0000000000a1', state: 'published' })
    await expect(store.discardDraft('00000000-0000-4000-8000-0000000000a1')).rejects.toThrow(/cannot be discarded/)
    expect(callsOf('delete')).toEqual([])
  })

  it('does nothing for a draft that is already gone', async () => {
    await store.discardDraft('00000000-0000-4000-8000-00000000900e')
    expect(callsOf('delete')).toEqual([])
  })

  it('keeps the row when storage silently refuses the delete, so it can be retried', async () => {
    const draft = await store.createDraft()
    await store.uploadLogo(draft.id, preparedLogo())
    db.removeRefused = true
    await expect(store.discardDraft(draft.id)).rejects.toThrow(/could not be deleted/)
    expect((await store.loadDraft())?.id).toBe(draft.id)
  })
})

describe('setup', () => {
  it('uses custom table names', async () => {
    const custom = supabaseBrandStore(db, RULES, { versionsTable: 'kit_versions', liveTable: 'kit_live' })
    await custom.loadLive()
    await custom.loadDraft()
    expect(db.calls.map((c) => c.target)).toEqual(['kit_live', 'kit_versions'])
  })

  it('refuses malformed rules', () => {
    expect(() => supabaseBrandStore(db, { ...RULES, storageOrigin: 'http://insecure' })).toThrow(/invalid BrandStorageRules/)
  })

  it('builds public URLs from the rules', () => {
    expect(store.publicUrl(`site-1/00000000-0000-4000-8000-0000000000d1/${SHA('e')}.png`)).toBe(`https://abcd.supabase.co/storage/v1/object/public/brand-assets/site-1/00000000-0000-4000-8000-0000000000d1/${SHA('e')}.png`)
  })
})
