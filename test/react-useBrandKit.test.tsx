// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareGuide, prepareLogo } from '../src/browser/index.js'
import { applyKitPatch, useBrandKit } from '../src/react/index.js'
import { emptyKit } from '../src/core/index.js'
import { MEASURES, RULES, fakePrepareGuide, fakePrepareLogo, fakeStore, file } from './react-helpers.js'

vi.mock('../src/browser/index.js', () => ({ prepareLogo: vi.fn(), prepareGuide: vi.fn() }))

beforeEach(() => {
  vi.mocked(prepareLogo).mockImplementation(fakePrepareLogo)
  vi.mocked(prepareGuide).mockImplementation(fakePrepareGuide)
  MEASURES.clear()
})
afterEach(() => {
  vi.clearAllMocks()
})

async function loaded(store: ReturnType<typeof fakeStore>, debounceMs = 30) {
  const hook = renderHook(() => useBrandKit(store, { debounceMs, rules: RULES }))
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

describe('applyKitPatch', () => {
  it('sets, clears and merges fields without touching the input', () => {
    const kit = { ...emptyKit(), name: 'Old', colors: { primary: '#112233', secondary: '#445566' } }
    const next = applyKitPatch(kit, { name: '', tagline: 'Hi', colors: { secondary: undefined }, fonts: { heading: 'inter' } })
    expect(next.name).toBeUndefined()
    expect('name' in next).toBe(false)
    expect(next.tagline).toBe('Hi')
    expect(next.colors).toEqual({ primary: '#112233' })
    expect(next.fonts.heading).toBe('inter')
    expect(kit.name).toBe('Old')
    expect(kit.colors.secondary).toBe('#445566')
  })
})

describe('useBrandKit', () => {
  it('loads live, draft and history, and starts the working kit from live when there is no draft', async () => {
    const store = fakeStore({ live: { ...emptyKit(), name: 'Skydive Testharness' } })
    const { result } = await loaded(store)
    expect(result.current.live?.kit.name).toBe('Skydive Testharness')
    expect(result.current.draft).toBeNull()
    expect(result.current.published).toHaveLength(1)
    expect(result.current.kit.name).toBe('Skydive Testharness')
    expect(store.createDraft).not.toHaveBeenCalled()
  })

  it('debounces text edits into one save, creating the draft once', async () => {
    const store = fakeStore()
    const { result } = await loaded(store)
    act(() => {
      result.current.edit({ name: 'S' })
      result.current.edit({ name: 'Sk' })
      result.current.edit({ name: 'Sky' })
    })
    expect(result.current.kit.name).toBe('Sky')
    expect(result.current.dirty).toBe(true)
    expect(store.saveDraft).not.toHaveBeenCalled()
    await waitFor(() => expect(store.saveDraft).toHaveBeenCalledTimes(1))
    expect(store.createDraft).toHaveBeenCalledTimes(1)
    expect(vi.mocked(store.saveDraft).mock.calls[0]?.[1].name).toBe('Sky')
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    expect(result.current.dirty).toBe(false)
  })

  it('flush saves at once without waiting for the debounce', async () => {
    const store = fakeStore()
    const { result } = await loaded(store, 10_000)
    act(() => result.current.edit({ tagline: 'Jump with us' }))
    await act(() => result.current.flush())
    expect(store.saveDraft).toHaveBeenCalledTimes(1)
    expect(vi.mocked(store.saveDraft).mock.calls[0]?.[1].tagline).toBe('Jump with us')
  })

  it('saves the kit cleaned by parseKit, so one refused field cannot block the rest', async () => {
    const store = fakeStore()
    const { result } = await loaded(store, 10_000)
    act(() => result.current.edit({ name: 'Good name', website: 'javascript:alert(1)' }))
    await act(() => result.current.flush())
    const saved = vi.mocked(store.saveDraft).mock.calls[0]?.[1]
    expect(saved?.name).toBe('Good name')
    expect(saved?.website).toBeUndefined()
    // The working copy keeps what the customer typed, so they can fix it.
    expect(result.current.kit.website).toBe('javascript:alert(1)')
  })

  it('sorts a batch of dropped files into slots and keeps the guide', async () => {
    MEASURES.set('wide-dark.png', { aspect: 3.2, luminance: 0.15, transparent: true, palette: [{ hex: '#1A73E8', share: 0.6 }] })
    MEASURES.set('wide-white.png', { aspect: 3.2, luminance: 0.95, transparent: true })
    MEASURES.set('icon.png', { aspect: 1, luminance: 0.3, transparent: false, palette: [{ hex: '#ff6600', share: 0.4 }] })
    const store = fakeStore()
    const { result } = await loaded(store)
    await act(() =>
      result.current.addFiles([
        file('wide-dark.png'),
        file('wide-white.png'),
        file('icon.png'),
        file('Brand guide.pdf', 'application/pdf'),
      ]),
    )
    const logos = result.current.kit.logos
    expect(logos.logo?.originalName).toBe('wide-dark.png')
    expect(logos.logoOnDark?.originalName).toBe('wide-white.png')
    expect(logos.mark?.originalName).toBe('icon.png')
    expect(result.current.kit.guide?.name).toBe('Brand guide.pdf')
    // The square logo is prepared again for the mark slot, which needs icon renditions.
    expect(vi.mocked(prepareLogo).mock.calls.map((c) => [c[0].name, c[1]])).toContainEqual(['icon.png', 'mark'])
    expect(vi.mocked(store.uploadLogo).mock.calls.map((c) => c[1].slot)).toEqual(['logo', 'logoOnDark', 'mark'])
    expect(result.current.uploads.map((u) => u.status)).toEqual(['done', 'done', 'done', 'done'])
    expect(result.current.suggestions.map((s) => s.hex)).toEqual(['#ff6600', '#1a73e8'])
    expect(store.createDraft).toHaveBeenCalledTimes(1)
    // What was stored matches what is on screen.
    expect(store.versions.find((v) => v.state === 'draft')?.kit.logos.mark?.originalName).toBe('icon.png')
  })

  it('gives a second logo that guessed the same slot the next free one', async () => {
    MEASURES.set('a.png', { aspect: 3, luminance: 0.1, transparent: false })
    MEASURES.set('b.png', { aspect: 3, luminance: 0.1, transparent: false })
    const store = fakeStore()
    const { result } = await loaded(store)
    await act(() => result.current.addFiles([file('a.png'), file('b.png')]))
    expect(result.current.kit.logos.logo?.originalName).toBe('a.png')
    expect(result.current.kit.logos.logoOnDark?.originalName).toBe('b.png')
  })

  it('does not upload a logo that preparation refused, and says why', async () => {
    MEASURES.set('tiny.png', {
      aspect: 3,
      luminance: 0.1,
      transparent: false,
      problems: [{ field: 'logos.logo', severity: 'refused', message: 'This logo is too small to print clearly.' }],
    })
    MEASURES.set('evil.svg', {
      aspect: 3,
      luminance: 0.1,
      transparent: false,
      throws: Object.assign(new Error('refused'), {
        problems: [{ field: 'file', severity: 'refused', message: 'This SVG contains a script, so we cannot use it.' }],
      }),
    })
    const store = fakeStore()
    const { result } = await loaded(store)
    await act(() => result.current.addFiles([file('tiny.png'), file('evil.svg', 'image/svg+xml'), file('notes.docx', '')]))
    expect(store.uploadLogo).not.toHaveBeenCalled()
    const [tiny, evil, notes] = result.current.uploads
    expect(tiny?.status).toBe('failed')
    expect(tiny?.problems[0]?.message).toBe('This logo is too small to print clearly.')
    expect(evil?.status).toBe('failed')
    expect(evil?.problems[0]?.message).toBe('This SVG contains a script, so we cannot use it.')
    expect(notes?.status).toBe('failed')
    expect(notes?.problems[0]?.message).toMatch(/not a file we can use/)
    expect(result.current.kit.logos).toEqual({})
  })

  it('reports a store refusal in plain English and keeps the edit pending', async () => {
    const store = fakeStore()
    const { result } = await loaded(store, 10_000)
    store.failNextSave = Object.assign(new Error('refused'), {
      problems: [{ field: 'name', severity: 'refused', message: 'The name is too long.' }],
    })
    act(() => result.current.edit({ name: 'x' }))
    await act(() => result.current.flush())
    expect(result.current.error).toBe('We could not save your draft. The name is too long.')
    expect(result.current.problems[0]?.message).toBe('The name is too long.')
    expect(result.current.dirty).toBe(true)
    await act(() => result.current.flush())
    expect(result.current.error).toBeNull()
    expect(result.current.dirty).toBe(false)
  })

  it('publishes (saving first), then rolls back and discards', async () => {
    const store = fakeStore({ live: { ...emptyKit(), name: 'First' } })
    const firstId = store.liveId
    const { result } = await loaded(store, 10_000)
    act(() => result.current.edit({ name: 'Second' }))
    let published: Awaited<ReturnType<typeof result.current.publish>> = null
    await act(async () => {
      published = await result.current.publish()
    })
    expect(published).not.toBeNull()
    expect(store.saveDraft).toHaveBeenCalledTimes(1)
    expect(result.current.draft).toBeNull()
    expect(result.current.live?.kit.name).toBe('Second')
    expect(result.current.published.map((v) => v.kit.name)).toEqual(['Second', 'First'])

    await act(() => result.current.rollback(firstId ?? ''))
    expect(store.rollback).toHaveBeenCalledWith(firstId)
    expect(result.current.live?.kit.name).toBe('First')
    expect(result.current.kit.name).toBe('First')

    act(() => result.current.edit({ name: 'Third' }))
    await act(() => result.current.flush())
    expect(result.current.draft).not.toBeNull()
    await act(() => result.current.discard())
    expect(store.discardDraft).toHaveBeenCalledTimes(1)
    expect(result.current.draft).toBeNull()
    expect(result.current.kit.name).toBe('First')
  })

  it('moves a logo between slots, swapping, and removes one', async () => {
    MEASURES.set('a.png', { aspect: 3, luminance: 0.1, transparent: false })
    MEASURES.set('b.png', { aspect: 3, luminance: 0.9, transparent: true })
    const store = fakeStore()
    const { result } = await loaded(store)
    await act(() => result.current.addFiles([file('a.png'), file('b.png')]))
    await act(() => result.current.moveLogo('logo', 'logoOnDark'))
    expect(result.current.kit.logos.logo?.originalName).toBe('b.png')
    expect(result.current.kit.logos.logoOnDark?.originalName).toBe('a.png')
    await act(() => result.current.moveLogo('logo', 'mark'))
    expect(result.current.kit.logos.logo).toBeUndefined()
    expect(result.current.kit.logos.mark?.originalName).toBe('b.png')
    // Moving into the square slot prepares the file again with icon renditions.
    expect(vi.mocked(prepareLogo).mock.calls.at(-1)?.[1]).toBe('mark')
    await act(() => result.current.removeLogo('mark'))
    expect(result.current.kit.logos.mark).toBeUndefined()
    expect(store.versions.find((v) => v.state === 'draft')?.kit.logos.mark).toBeUndefined()
  })

  it('saves pending edits when the screen unmounts', async () => {
    const store = fakeStore()
    const { result, unmount } = await loaded(store, 10_000)
    act(() => result.current.edit({ name: 'Leaving' }))
    unmount()
    await waitFor(() => expect(store.saveDraft).toHaveBeenCalledTimes(1))
    expect(vi.mocked(store.saveDraft).mock.calls[0]?.[1].name).toBe('Leaving')
  })
})
