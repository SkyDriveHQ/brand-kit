/**
 * `useBrandKit(store)`: the state behind the drop-in.
 *
 * It loads the live kit, the draft (if any) and the published history, keeps a local WORKING copy of the
 * draft kit that the screen edits, and saves it to the store:
 *
 * - text and colour edits are debounced (about 600 ms) into one `saveDraft`, and `flush()` saves at once
 *   (the screen calls it on blur, and publish calls it first);
 * - uploads, removals and slot moves save at once;
 * - the draft row is created lazily, on the first change, and creation is shared by concurrent callers;
 * - a `saveDraft` reply never overwrites the working copy, so typing is never undone by a slow save.
 *
 * When `rules` are given, the kit is cleaned by `parseKit(…, 'strict')` before saving, so one field the
 * store would refuse (a bad website, say) cannot block every other edit from saving. The screen shows the
 * refused field to the customer from the same `parseKit` call.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { draftFrom, emptyKit, parseKit } from '../core/index.js'
import type {
  BrandGuideRef,
  BrandKit,
  BrandKitVersion,
  BrandStorageRules,
  KitProblem,
  LogoAsset,
  LogoSlot,
} from '../core/index.js'
import { prepareGuide, prepareLogo } from '../browser/index.js'
import type { PreparedLogo } from '../browser/index.js'
import type { BrandKitStore } from '../supabase/index.js'
import { droppedFileKind, guessLogoSlot, pickFreeSlot } from './slots.js'

/** A change to the working kit. A field set to `undefined` or `''` is cleared. */
export interface KitPatch {
  name?: string | undefined
  tagline?: string | undefined
  website?: string | undefined
  colors?: { primary?: string | undefined; secondary?: string | undefined }
  fonts?: { heading?: string | undefined }
}

export type UploadStatus = 'preparing' | 'uploading' | 'done' | 'failed'

/** One dropped or chosen file, for the progress list. */
export interface UploadItem {
  id: string
  fileName: string
  kind: 'logo' | 'guide' | 'unknown'
  status: UploadStatus
  /** The slot a logo went into (or is going into). */
  slot: LogoSlot | null
  /** Plain-English problems for this file: refusals, repairs and warnings. */
  problems: KitProblem[]
}

export interface PaletteSuggestion {
  hex: string
  share: number
}

export interface UseBrandKitOptions {
  /** Delay before a text or colour edit is saved. Default 600 ms. */
  debounceMs?: number
  /** When given, the kit is cleaned by `parseKit` strict mode before each save. */
  rules?: BrandStorageRules
}

export interface UseBrandKit {
  /** True until the first load finishes. */
  loading: boolean
  live: BrandKitVersion | null
  /** The stored draft row, or null when there is none yet. */
  draft: BrandKitVersion | null
  /** Published versions, newest first. */
  published: BrandKitVersion[]
  /** The working copy the screen edits: the draft plus any edits not yet saved. */
  kit: BrandKit
  /** True when there are edits waiting to be saved. */
  dirty: boolean
  /** True while anything is talking to the store. */
  busy: boolean
  /** The last failure, in plain English, or null. */
  error: string | null
  /** Problems the store returned with its last refusal. */
  problems: KitProblem[]
  /** Progress of files dropped or chosen in this session. */
  uploads: UploadItem[]
  /** Colour suggestions from the palettes of logos uploaded in this session. */
  suggestions: PaletteSuggestion[]
  edit(patch: KitPatch): void
  /** Save pending edits now. */
  flush(): Promise<void>
  /** Drop in several files at once: logos are sorted into slots by a guess, a PDF becomes the brand guide. */
  addFiles(files: Iterable<File>): Promise<void>
  /** Upload one logo into a known slot (the slot's "Replace"). Resolves true when it was stored. */
  uploadLogo(slot: LogoSlot, file: File): Promise<boolean>
  /** Move a logo to another slot, swapping with whatever is there. */
  moveLogo(from: LogoSlot, to: LogoSlot): Promise<void>
  removeLogo(slot: LogoSlot): Promise<void>
  uploadGuide(file: File): Promise<boolean>
  removeGuide(): Promise<void>
  /** Save, then publish the draft. Resolves to the published version, or null when it failed or there was nothing to publish. */
  publish(): Promise<BrandKitVersion | null>
  /** Make an older published version live again. */
  rollback(versionId: string): Promise<void>
  /** Throw the draft away and go back to the live kit. */
  discard(): Promise<void>
  /** Clear the error message. */
  dismissError(): void
}

/** Apply a patch to a kit, returning a new kit. Pure. */
export function applyKitPatch(kit: BrandKit, patch: KitPatch): BrandKit {
  const next: BrandKit = { ...kit, logos: { ...kit.logos }, colors: { ...kit.colors }, fonts: { ...kit.fonts } }
  for (const key of ['name', 'tagline', 'website'] as const) {
    if (key in patch) {
      const value = patch[key]
      if (value === undefined || value === '') delete next[key]
      else next[key] = value
    }
  }
  if (patch.colors) {
    for (const key of ['primary', 'secondary'] as const) {
      if (key in patch.colors) {
        const value = patch.colors[key]
        if (value === undefined || value === '') delete next.colors[key]
        else next.colors[key] = value
      }
    }
  }
  if (patch.fonts && 'heading' in patch.fonts) {
    const value = patch.fonts.heading
    if (value === undefined || value === '') delete next.fonts.heading
    else next.fonts.heading = value
  }
  return next
}

function withLogo(kit: BrandKit, slot: LogoSlot, asset: LogoAsset | undefined): BrandKit {
  const logos = { ...kit.logos }
  if (asset) logos[slot] = asset
  else delete logos[slot]
  return { ...kit, logos }
}

function withGuide(kit: BrandKit, guide: BrandGuideRef | undefined): BrandKit {
  const next: BrandKit = { ...kit }
  if (guide) next.guide = guide
  else delete next.guide
  return next
}

function problemsOf(err: unknown): KitProblem[] {
  if (err && typeof err === 'object' && 'problems' in err) {
    const p = (err as { problems: unknown }).problems
    if (Array.isArray(p)) {
      return p.filter(
        (x): x is KitProblem =>
          !!x && typeof x === 'object' && typeof (x as KitProblem).message === 'string' && typeof (x as KitProblem).severity === 'string',
      )
    }
  }
  return []
}

function messageOf(err: unknown): string {
  const problems = problemsOf(err)
  if (problems.length > 0) return problems.map((p) => p.message).join(' ')
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return 'Something went wrong. Please try again.'
}

function newestFirst(versions: BrandKitVersion[]): BrandKitVersion[] {
  return [...versions]
    .filter((v) => v.state === 'published')
    .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt))
}

function mergePalette(prev: PaletteSuggestion[], add: readonly PaletteSuggestion[]): PaletteSuggestion[] {
  const seen = new Set<string>()
  const out: PaletteSuggestion[] = []
  for (const s of [...add, ...prev]) {
    const hex = s.hex.toLowerCase()
    if (!/^#[0-9a-f]{6}$/.test(hex) || seen.has(hex)) continue
    seen.add(hex)
    out.push({ hex, share: s.share })
  }
  return out.slice(0, 8)
}

const isMark = (slot: LogoSlot): boolean => slot === 'mark'

/**
 * @param store The product's store. It is read on mount and then through a ref, so it need not be a stable
 *   reference; to show a different tenant, remount the component (give it a `key`).
 */
export function useBrandKit(store: BrandKitStore, options: UseBrandKitOptions = {}): UseBrandKit {
  const debounceMs = options.debounceMs ?? 600
  const rules = options.rules

  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState<BrandKitVersion | null>(null)
  const [draft, setDraftState] = useState<BrandKitVersion | null>(null)
  const [published, setPublished] = useState<BrandKitVersion[]>([])
  const [kit, setKitState] = useState<BrandKit>(emptyKit)
  const [dirty, setDirtyState] = useState(false)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<KitProblem[]>([])
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [suggestions, setSuggestions] = useState<PaletteSuggestion[]>([])

  // Refs hold the values async work must read at the moment it runs, not when it was scheduled.
  const kitRef = useRef<BrandKit>(kit)
  const draftRef = useRef<BrandKitVersion | null>(null)
  const liveRef = useRef<BrandKitVersion | null>(null)
  const dirtyRef = useRef(false)
  const creatingRef = useRef<Promise<BrandKitVersion> | null>(null)
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filesRef = useRef(new Map<LogoSlot, File>())
  const idRef = useRef(0)
  const storeRef = useRef(store)
  storeRef.current = store
  const rulesRef = useRef(rules)
  rulesRef.current = rules

  const setKit = useCallback((next: BrandKit) => {
    kitRef.current = next
    setKitState(next)
  }, [])
  const setDraft = useCallback((v: BrandKitVersion | null) => {
    draftRef.current = v
    setDraftState(v)
  }, [])
  const setLiveBoth = useCallback((v: BrandKitVersion | null) => {
    liveRef.current = v
    setLive(v)
  }, [])
  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d
    setDirtyState(d)
  }, [])

  const track = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setPending((n) => n + 1)
    try {
      return await fn()
    } finally {
      setPending((n) => n - 1)
    }
  }, [])

  const fail = useCallback((prefix: string, err: unknown) => {
    setError(`${prefix} ${messageOf(err)}`)
    setProblems(problemsOf(err))
  }, [])

  // ------------------------------------------------------------------------------------------- loading

  // Runs once per mount, through `storeRef`, so a product that builds its store inline in render (a new
  // object every time) does not reload the screen on every commit. To switch tenants, remount with a `key`.
  useEffect(() => {
    let cancelled = false
    const s = storeRef.current
    setLoading(true)
    void (async () => {
      try {
        const [l, d, p] = await Promise.all([s.loadLive(), s.loadDraft(), s.listPublished()])
        if (cancelled) return
        setLiveBoth(l)
        setDraft(d)
        setPublished(newestFirst(p))
        setKit(d ? d.kit : draftFrom(l))
        setDirty(false)
        setError(null)
      } catch (err) {
        if (!cancelled) fail('We could not load your brand kit.', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately once per mount; see above
  }, [])

  // ------------------------------------------------------------------------------------------- saving

  const ensureDraft = useCallback(async (): Promise<BrandKitVersion> => {
    if (draftRef.current) return draftRef.current
    if (!creatingRef.current) {
      creatingRef.current = storeRef.current
        .createDraft()
        .then((v) => {
          setDraft(v)
          return v
        })
        .finally(() => {
          creatingRef.current = null
        })
    }
    return creatingRef.current
  }, [setDraft])

  /** Queue a save of the working kit behind any save already running. Resolves true on success. */
  const save = useCallback((): Promise<boolean> => {
    const run = chainRef.current.then(() =>
      track(async () => {
        try {
          const d = await ensureDraft()
          const current = kitRef.current
          const r = rulesRef.current
          const toSave = r ? parseKit(current, r, 'strict').kit : current
          const saved = await storeRef.current.saveDraft(d.id, toSave)
          setDraft(saved)
          setError(null)
          setProblems([])
          return true
        } catch (err) {
          setDirty(true)
          fail('We could not save your draft.', err)
          return false
        }
      }),
    )
    chainRef.current = run.then(() => undefined)
    return run
  }, [ensureDraft, fail, setDirty, setDraft, track])

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const saveNow = useCallback((): Promise<boolean> => {
    cancelTimer()
    setDirty(false)
    return save()
  }, [cancelTimer, save, setDirty])

  const flush = useCallback(async (): Promise<void> => {
    cancelTimer()
    if (dirtyRef.current) {
      setDirty(false)
      await save()
    } else {
      await chainRef.current
    }
  }, [cancelTimer, save, setDirty])

  const edit = useCallback(
    (patch: KitPatch) => {
      setKit(applyKitPatch(kitRef.current, patch))
      setDirty(true)
      cancelTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (dirtyRef.current) {
          setDirty(false)
          void save()
        }
      }, debounceMs)
    },
    [cancelTimer, debounceMs, save, setDirty, setKit],
  )

  // Save anything still pending when the screen goes away.
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      if (dirtyRef.current) {
        dirtyRef.current = false
        void save()
      }
    },
    [save],
  )

  // ------------------------------------------------------------------------------------------- uploads

  const addItem = useCallback((file: File, kind: UploadItem['kind'], slot: LogoSlot | null): string => {
    idRef.current += 1
    const id = `bk-upload-${idRef.current}`
    setUploads((prev) => [...prev, { id, fileName: file.name, kind, status: 'preparing', slot, problems: [] }])
    return id
  }, [])

  const updateItem = useCallback((id: string, patch: Partial<Omit<UploadItem, 'id'>>) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)))
  }, [])

  /**
   * Prepare (or re-prepare) a logo for `slot` and store it there. `chooseSlot` lets the drop zone decide the
   * slot from what was measured. Logos for `mark` get icon renditions, so a logo is prepared again when its
   * final slot is `mark` and the first preparation was for a wide slot.
   */
  const placeLogo = useCallback(
    async (
      file: File,
      itemId: string,
      firstSlot: LogoSlot,
      chooseSlot: (prepared: PreparedLogo) => LogoSlot,
    ): Promise<LogoSlot | null> => {
      let prepared: PreparedLogo
      try {
        prepared = await prepareLogo(file, firstSlot)
        const slot = chooseSlot(prepared)
        if (isMark(slot) !== isMark(firstSlot)) prepared = await prepareLogo(file, slot)
        prepared = { ...prepared, slot }
      } catch (err) {
        updateItem(itemId, { status: 'failed', problems: problemsOrMessage(err) })
        return null
      }
      const slot = prepared.slot
      updateItem(itemId, { slot, problems: prepared.problems })
      if (prepared.problems.some((p) => p.severity === 'refused')) {
        updateItem(itemId, { status: 'failed' })
        return null
      }
      setSuggestions((prev) => mergePalette(prev, prepared.palette))
      updateItem(itemId, { status: 'uploading' })
      try {
        const d = await ensureDraft()
        const asset = await storeRef.current.uploadLogo(d.id, prepared)
        filesRef.current.set(slot, file)
        setKit(withLogo(kitRef.current, slot, asset))
        const saved = await saveNow()
        updateItem(itemId, { status: saved ? 'done' : 'failed' })
        return saved ? slot : null
      } catch (err) {
        updateItem(itemId, { status: 'failed', problems: [...prepared.problems, ...problemsOrMessage(err)] })
        return null
      }
    },
    [ensureDraft, saveNow, setKit, updateItem],
  )

  const placeGuide = useCallback(
    async (file: File, itemId: string): Promise<boolean> => {
      try {
        const prepared = await prepareGuide(file)
        updateItem(itemId, { status: 'uploading' })
        const d = await ensureDraft()
        const ref = await storeRef.current.uploadGuide(d.id, prepared)
        setKit(withGuide(kitRef.current, ref))
        const saved = await saveNow()
        updateItem(itemId, { status: saved ? 'done' : 'failed' })
        return saved
      } catch (err) {
        updateItem(itemId, { status: 'failed', problems: problemsOrMessage(err) })
        return false
      }
    },
    [ensureDraft, saveNow, setKit, updateItem],
  )

  const addFiles = useCallback(
    async (files: Iterable<File>): Promise<void> => {
      const list = Array.from(files)
      if (list.length === 0) return
      setError(null)
      await track(async () => {
        const claimed = new Set<LogoSlot>()
        // Queue every file first so the customer sees the whole batch at once, then work through it in order.
        const queued = list.map((file) => {
          const kind = droppedFileKind(file)
          return { file, kind, id: addItem(file, kind, null) }
        })
        for (const { file, kind, id } of queued) {
          if (kind === 'guide') {
            await placeGuide(file, id)
          } else if (kind === 'logo') {
            const slot = await placeLogo(file, id, 'logo', (prepared) => {
              const chosen = pickFreeSlot(guessLogoSlot(prepared), claimed)
              claimed.add(chosen)
              return chosen
            })
            if (slot) claimed.add(slot)
          } else {
            updateItem(id, {
              status: 'failed',
              problems: [
                {
                  field: 'file',
                  severity: 'refused',
                  message: `"${file.name}" is not a file we can use. Logos can be PNG, JPEG, WebP or SVG, and a brand guide must be a PDF.`,
                },
              ],
            })
          }
        }
      })
    },
    [addItem, placeGuide, placeLogo, track, updateItem],
  )

  const uploadLogo = useCallback(
    async (slot: LogoSlot, file: File): Promise<boolean> => {
      setError(null)
      const id = addItem(file, 'logo', slot)
      const placed = await track(() => placeLogo(file, id, slot, () => slot))
      return placed !== null
    },
    [addItem, placeLogo, track],
  )

  const uploadGuide = useCallback(
    async (file: File): Promise<boolean> => {
      setError(null)
      const id = addItem(file, 'guide', null)
      return track(() => placeGuide(file, id))
    },
    [addItem, placeGuide, track],
  )

  const removeLogo = useCallback(
    async (slot: LogoSlot): Promise<void> => {
      filesRef.current.delete(slot)
      setKit(withLogo(kitRef.current, slot, undefined))
      await saveNow()
    },
    [saveNow, setKit],
  )

  const removeGuide = useCallback(async (): Promise<void> => {
    setKit(withGuide(kitRef.current, undefined))
    await saveNow()
  }, [saveNow, setKit])

  const moveLogo = useCallback(
    async (from: LogoSlot, to: LogoSlot): Promise<void> => {
      if (from === to) return
      const current = kitRef.current
      const a = current.logos[from]
      const b = current.logos[to]
      let next = withLogo(current, to, a)
      next = withLogo(next, from, b)
      setKit(next)
      const files = filesRef.current
      const fileA = files.get(from)
      const fileB = files.get(to)
      files.delete(from)
      files.delete(to)
      if (fileA) files.set(to, fileA)
      if (fileB) files.set(from, fileB)
      await saveNow()
      // Moving into or out of the square slot changes which renditions are needed (icons vs print). When the
      // original file is still in hand from this session, prepare it again for its new slot.
      if (isMark(from) !== isMark(to)) {
        if (a && fileA) await uploadLogo(to, fileA)
        if (b && fileB) await uploadLogo(from, fileB)
      }
    },
    [saveNow, setKit, uploadLogo],
  )

  // ------------------------------------------------------------------------------------------- publishing

  const reloadPublished = useCallback(async (): Promise<BrandKitVersion | null> => {
    const [l, p] = await Promise.all([storeRef.current.loadLive(), storeRef.current.listPublished()])
    setLiveBoth(l)
    setPublished(newestFirst(p))
    return l
  }, [setLiveBoth])

  const publish = useCallback(async (): Promise<BrandKitVersion | null> => {
    setError(null)
    await flush()
    if (dirtyRef.current) return null // the save failed; the error is already showing
    const d = draftRef.current
    if (!d) return null
    return track(async () => {
      try {
        const version = await storeRef.current.publish(d.id)
        setDraft(null)
        setKit(version.kit)
        try {
          const l = await reloadPublished()
          if (!l) setLiveBoth(version)
        } catch {
          setLiveBoth(version)
          setPublished((prev) => newestFirst([version, ...prev.filter((v) => v.id !== version.id)]))
        }
        return version
      } catch (err) {
        fail('We could not publish your brand kit.', err)
        return null
      }
    })
  }, [fail, flush, reloadPublished, setDraft, setKit, setLiveBoth, track])

  const rollback = useCallback(
    async (versionId: string): Promise<void> => {
      setError(null)
      await track(async () => {
        try {
          await storeRef.current.rollback(versionId)
          const l = await reloadPublished()
          if (!draftRef.current && !dirtyRef.current) setKit(draftFrom(l))
        } catch (err) {
          fail('We could not make that version live again.', err)
        }
      })
    },
    [fail, reloadPublished, setKit, track],
  )

  const discard = useCallback(async (): Promise<void> => {
    setError(null)
    cancelTimer()
    setDirty(false)
    await chainRef.current
    if (creatingRef.current) await creatingRef.current.catch(() => null)
    await track(async () => {
      try {
        const d = draftRef.current
        if (d) await storeRef.current.discardDraft(d.id)
        setDraft(null)
        filesRef.current.clear()
        setKit(draftFrom(liveRef.current))
        setProblems([])
      } catch (err) {
        fail('We could not discard the draft.', err)
      }
    })
  }, [cancelTimer, fail, setDirty, setDraft, setKit, track])

  const dismissError = useCallback(() => {
    setError(null)
    setProblems([])
  }, [])

  // This session's uploads first, then the colours saved with each logo in the kit, so suggestions
  // survive a reload.
  const allSuggestions = useMemo(() => {
    const saved = Object.values(kit.logos).flatMap((l) => l?.palette ?? [])
    return mergePalette(saved, suggestions)
  }, [kit.logos, suggestions])

  return useMemo(
    () => ({
      loading,
      live,
      draft,
      published,
      kit,
      dirty,
      busy: pending > 0,
      error,
      problems,
      uploads,
      suggestions: allSuggestions,
      edit,
      flush,
      addFiles,
      uploadLogo,
      moveLogo,
      removeLogo,
      uploadGuide,
      removeGuide,
      publish,
      rollback,
      discard,
      dismissError,
    }),
    [
      loading,
      live,
      draft,
      published,
      kit,
      dirty,
      pending,
      error,
      problems,
      uploads,
      allSuggestions,
      edit,
      flush,
      addFiles,
      uploadLogo,
      moveLogo,
      removeLogo,
      uploadGuide,
      removeGuide,
      publish,
      rollback,
      discard,
      dismissError,
    ],
  )
}

function problemsOrMessage(err: unknown): KitProblem[] {
  const problems = problemsOf(err)
  if (problems.length > 0) return problems
  return [{ field: 'file', severity: 'refused', message: messageOf(err) }]
}
