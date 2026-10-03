/**
 * Shared fakes for the React tests: an in-memory `BrandKitStore`, storage rules whose URLs pass
 * `isOwnPublicAssetUrl`, and canned `PreparedLogo` measurements keyed by file name.
 *
 * Not a test file itself (no `.test.` in the name), so vitest only runs it through imports.
 */
import { vi } from 'vitest'
import type {
  BrandGuideRef,
  BrandKit,
  BrandKitVersion,
  BrandStorageRules,
  KitProblem,
  LogoAsset,
  LogoSlot,
  ProductIdentity,
  RenditionName,
} from '../src/core/index.js'
import type { PreparedGuide, PreparedLogo } from '../src/browser/index.js'
import type { BrandKitStore } from '../src/supabase/index.js'

export const RULES: BrandStorageRules = {
  storageOrigin: 'https://abcd.supabase.co',
  publicBucket: 'brand-assets',
  privateBucket: 'brand-originals',
  tenantId: 'tenant-1',
}

export const IDENTITY: ProductIdentity = {
  product: 'skyweather',
  productName: 'SkyWeather',
  poweredByLabel: 'Powered by SkyDrive',
  fallbackAccent: '#3f3f46',
}

let hashCounter = 0
export function fakeSha(): string {
  hashCounter += 1
  return hashCounter.toString(16).padStart(64, '0')
}

export function renditionUrl(versionId: string, sha: string): string {
  return `${RULES.storageOrigin}/storage/v1/object/public/${RULES.publicBucket}/${RULES.tenantId}/${versionId}/${sha}.png`
}

export function fakeAsset(versionId: string, name: string, slot: LogoSlot, aspect = 3): LogoAsset {
  const sha = fakeSha()
  const names: RenditionName[] = slot === 'mark' ? ['web', 'web2x', 'email', 'pdf', 'icon32'] : ['web', 'web2x', 'email', 'pdf', 'print']
  const heights: Record<RenditionName, number> = { web: 96, web2x: 192, email: 120, pdf: 240, print: 600, icon32: 32, icon192: 192, icon512: 512 }
  const renditions: LogoAsset['renditions'] = {}
  for (const n of names) {
    const s = fakeSha()
    const h = heights[n]
    renditions[n] = { url: renditionUrl(versionId, s), width: Math.round(h * aspect), height: h, bytes: 1000, sha256: s }
  }
  return {
    originalPath: `${RULES.tenantId}/${versionId}/original-${sha}.png`,
    originalType: 'image/png',
    originalName: name,
    aspect,
    tone: { luminance: 0.2, transparent: true },
    renditions,
  }
}

export interface FakeStore extends BrandKitStore {
  versions: BrandKitVersion[]
  liveId: string | null
  failNextSave: unknown
}

/** An in-memory store with the same behaviour the Supabase one promises. Every method is a `vi.fn`. */
export function fakeStore(initial: { live?: BrandKit; draft?: BrandKit } = {}): FakeStore {
  let n = 0
  let clock = Date.parse('2026-09-01T10:00:00Z')
  const tick = (): string => {
    clock += 60_000
    return new Date(clock).toISOString()
  }
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
  const mk = (state: 'draft' | 'published', kit: BrandKit, basedOn: string | null): BrandKitVersion => {
    n += 1
    const at = tick()
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      tenantId: RULES.tenantId,
      state,
      kit: clone(kit),
      basedOn,
      createdAt: at,
      createdBy: 'user-1',
      publishedAt: state === 'published' ? at : null,
      publishedBy: state === 'published' ? 'user-1' : null,
    }
  }
  const self = {
    versions: [] as BrandKitVersion[],
    liveId: null as string | null,
    failNextSave: null as unknown,
  } as FakeStore
  if (initial.live) {
    const v = mk('published', initial.live, null)
    self.versions.push(v)
    self.liveId = v.id
  }
  if (initial.draft) self.versions.push(mk('draft', initial.draft, self.liveId))

  const live = (): BrandKitVersion | null => self.versions.find((v) => v.id === self.liveId) ?? null
  const draftRow = (): BrandKitVersion | undefined => self.versions.find((v) => v.state === 'draft')

  Object.assign(self, {
    loadLive: vi.fn(async () => (live() ? clone(live()) : null)),
    loadDraft: vi.fn(async () => (draftRow() ? clone(draftRow()) : null)),
    createDraft: vi.fn(async () => {
      const existing = draftRow()
      if (existing) return clone(existing)
      const l = live()
      const v = mk('draft', l ? l.kit : { schemaVersion: 1, logos: {}, colors: {}, fonts: {} }, l?.id ?? null)
      self.versions.push(v)
      return clone(v)
    }),
    saveDraft: vi.fn(async (id: string, kit: BrandKit) => {
      if (self.failNextSave) {
        const err = self.failNextSave
        self.failNextSave = null
        throw err
      }
      const v = self.versions.find((x) => x.id === id)
      if (!v || v.state !== 'draft') throw new Error('That draft no longer exists.')
      v.kit = clone(kit)
      return clone(v)
    }),
    uploadLogo: vi.fn(async (draftId: string, prepared: PreparedLogo) =>
      fakeAsset(draftId, prepared.original.name, prepared.slot, prepared.aspect),
    ),
    uploadGuide: vi.fn(
      async (draftId: string, prepared: PreparedGuide): Promise<BrandGuideRef> => ({
        path: `${RULES.tenantId}/${draftId}/guide-${prepared.sha256}.pdf`,
        name: prepared.name,
        bytes: prepared.bytes,
        uploadedAt: '2026-09-01T12:00:00Z',
      }),
    ),
    publish: vi.fn(async (draftId: string) => {
      const v = self.versions.find((x) => x.id === draftId)
      if (!v || v.state !== 'draft') throw new Error('Only a draft can be published.')
      v.state = 'published'
      v.publishedAt = tick()
      v.publishedBy = 'user-1'
      self.liveId = v.id
      return clone(v)
    }),
    rollback: vi.fn(async (versionId: string) => {
      const v = self.versions.find((x) => x.id === versionId && x.state === 'published')
      if (!v) throw new Error('That version was never published.')
      self.liveId = v.id
    }),
    listPublished: vi.fn(async () => clone(self.versions.filter((v) => v.state === 'published'))),
    discardDraft: vi.fn(async (id: string) => {
      self.versions = self.versions.filter((v) => !(v.id === id && v.state === 'draft'))
    }),
    publicUrl: vi.fn((path: string) => `${RULES.storageOrigin}/storage/v1/object/public/${RULES.publicBucket}/${path}`),
  })
  return self
}

/** What the mocked `prepareLogo` reports for each test file name. */
export interface FakeMeasure {
  aspect: number
  luminance: number
  transparent: boolean
  palette?: { hex: string; share: number }[]
  problems?: KitProblem[]
  throws?: unknown
}

export const MEASURES = new Map<string, FakeMeasure>()

export function fakePrepareLogo(file: File, slot: LogoSlot): Promise<PreparedLogo> {
  const m = MEASURES.get(file.name) ?? { aspect: 3, luminance: 0.2, transparent: true }
  if (m.throws) return Promise.reject(m.throws)
  return Promise.resolve({
    slot,
    original: { blob: file, type: 'image/png', name: file.name, sha256: fakeSha(), ext: 'png' },
    renditions: [],
    tone: { luminance: m.luminance, transparent: m.transparent },
    aspect: m.aspect,
    palette: m.palette ?? [],
    problems: m.problems ?? [],
  })
}

export function fakePrepareGuide(file: File): Promise<PreparedGuide> {
  return Promise.resolve({ blob: file, name: file.name, bytes: file.size, sha256: fakeSha() })
}

export function file(name: string, type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type })
}
