// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareGuide, prepareLogo } from '../src/browser/index.js'
import { BrandKitDropIn } from '../src/react/index.js'
import type { BrandKitDropInProps } from '../src/react/index.js'
import { CURATED_FONTS, emptyKit } from '../src/core/index.js'
import type { BrandKit } from '../src/core/index.js'
import { IDENTITY, MEASURES, RULES, fakeAsset, fakePrepareGuide, fakePrepareLogo, fakeStore, file } from './react-helpers.js'

vi.mock('../src/browser/index.js', () => ({ prepareLogo: vi.fn(), prepareGuide: vi.fn() }))

beforeEach(() => {
  vi.mocked(prepareLogo).mockImplementation(fakePrepareLogo)
  vi.mocked(prepareGuide).mockImplementation(fakePrepareGuide)
  MEASURES.clear()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function mount(store = fakeStore(), extra: Partial<BrandKitDropInProps> = {}) {
  const utils = render(
    <BrandKitDropIn
      store={store}
      identity={IDENTITY}
      rules={RULES}
      fallbackName="Skydive Testharness"
      loadFonts={false}
      debounceMs={20}
      {...extra}
    />,
  )
  await screen.findByRole('button', { name: 'Add brand files' })
  return { ...utils, store }
}

function dropFiles(files: File[]): void {
  fireEvent.drop(screen.getByRole('button', { name: 'Add brand files' }), { dataTransfer: { files, types: ['Files'] } })
}

describe('BrandKitDropIn', () => {
  it('shows the unbranded look for an empty kit, and says so', async () => {
    const { container } = await mount()
    expect(screen.getByTestId('bk-unbranded').textContent).toMatch(/Skydive Testharness/)
    expect(screen.getByTestId('bk-unbranded').textContent).toMatch(/SkyWeather's neutral look/)
    // The web, TV and PDF mock-ups draw the name as text, and no logo image appears anywhere in them.
    for (const surface of ['web-light', 'tv', 'pdf']) {
      const fig = container.querySelector(`figure[data-surface="${surface}"]`) as HTMLElement
      expect(fig).not.toBeNull()
      expect(within(fig).getAllByText(/Skydive Testharness/).length).toBeGreaterThan(0)
      expect(fig.querySelector('img')).toBeNull()
    }
    expect(screen.getByText('Nothing published yet, so customers see the unbranded look.', { exact: false })).toBeTruthy()
  })

  it('renders the email preview inside a sandboxed iframe, from emailHeaderHtml', async () => {
    const { container } = await mount()
    const frame = container.querySelector('figure[data-surface="email"] iframe') as HTMLIFrameElement
    expect(frame).not.toBeNull()
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toContain('Skydive Testharness')
  })

  it('gives every input, select and the drop zone an accessible name', async () => {
    const { container } = await mount(
      fakeStore({ draft: { ...emptyKit(), logos: { logo: fakeAsset('v0', 'logo.png', 'logo') } } }),
    )
    const controls = container.querySelectorAll('input, select, textarea')
    expect(controls.length).toBeGreaterThan(8)
    for (const el of Array.from(controls)) {
      const named =
        (el as HTMLInputElement).labels?.length ||
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby')
      expect(named, el.outerHTML).toBeTruthy()
    }
    expect(screen.getByLabelText('Business name')).toBeTruthy()
    expect(screen.getByLabelText('Tagline')).toBeTruthy()
    expect(screen.getByLabelText('Website')).toBeTruthy()
    expect(screen.getByLabelText('Heading font')).toBeTruthy()
    expect(screen.getByLabelText('Brand colour: colour code')).toBeTruthy()
    expect(screen.getByLabelText('Second colour: colour picker')).toBeTruthy()
    expect(screen.getByLabelText('Wrong slot? Move it to')).toBeTruthy()
  })

  it('opens the file chooser from the keyboard', async () => {
    await mount()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    const zone = screen.getByRole('button', { name: 'Add brand files' })
    expect(zone.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(zone, { key: 'Enter' })
    fireEvent.keyDown(zone, { key: ' ' })
    expect(click).toHaveBeenCalledTimes(2)
    click.mockRestore()
  })

  it('takes several dropped files at once, sorts them into slots and shows each file name', async () => {
    MEASURES.set('wordmark.png', { aspect: 4, luminance: 0.1, transparent: true, palette: [{ hex: '#1a73e8', share: 0.7 }] })
    MEASURES.set('wordmark-white.png', { aspect: 4, luminance: 0.95, transparent: true })
    MEASURES.set('icon.png', { aspect: 1, luminance: 0.4, transparent: false })
    const { container, store } = await mount()
    dropFiles([file('wordmark.png'), file('wordmark-white.png'), file('icon.png'), file('guide.pdf', 'application/pdf')])
    await waitFor(() => expect(store.uploadGuide).toHaveBeenCalled())
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Files added' })).getAllByText(/^Added/)).toHaveLength(4),
    )

    const slot = (s: string) => container.querySelector(`[data-slot="${s}"]`) as HTMLElement
    expect(within(slot('logo')).getByText('wordmark.png')).toBeTruthy()
    expect(within(slot('logoOnDark')).getByText('wordmark-white.png')).toBeTruthy()
    expect(within(slot('mark')).getByText('icon.png')).toBeTruthy()
    expect(within(slot('logo')).getByRole('button', { name: 'Replace main logo' })).toBeTruthy()
    expect(within(slot('logo')).getByRole('button', { name: 'Remove main logo' })).toBeTruthy()
    // The slot previews and the mock-ups show PNG renditions, never the original file.
    const imgs = Array.from(container.querySelectorAll('img'))
    expect(imgs.length).toBeGreaterThan(0)
    for (const img of imgs) expect(img.getAttribute('src')).toMatch(/^https:\/\/abcd\.supabase\.co\/.*\.png$/)
    const guide = screen.getByRole('region', { name: 'Brand guide (optional)' })
    expect(within(guide).getByText('guide.pdf')).toBeTruthy()
    expect(within(guide).getByRole('button', { name: 'Remove brand guide' })).toBeTruthy()
    // Palette suggestions from the logo.
    expect(screen.getAllByRole('button', { name: 'Use #1a73e8' })).toHaveLength(2)
    expect(screen.queryByTestId('bk-unbranded')).toBeNull()
    expect(screen.getByText('Draft — not live yet')).toBeTruthy()
  })

  it('explains the optional dark-background slot', async () => {
    const { container } = await mount()
    const dark = container.querySelector('[data-slot="logoOnDark"]') as HTMLElement
    expect(dark.textContent).toMatch(/optional/i)
    expect(dark.textContent).toMatch(/light panel behind your main logo on dark screens/)
  })

  it('lists problems from preparing a logo in plain English', async () => {
    MEASURES.set('small.png', {
      aspect: 3,
      luminance: 0.1,
      transparent: false,
      problems: [{ field: 'logos.logo', severity: 'refused', message: 'This logo is too small to print clearly.' }],
    })
    const { store } = await mount()
    dropFiles([file('small.png')])
    expect(await screen.findByText('This logo is too small to print clearly.')).toBeTruthy()
    expect(screen.getByText('Not added')).toBeTruthy()
    expect(store.uploadLogo).not.toHaveBeenCalled()
  })

  it('moves a logo to another slot when the guess was wrong', async () => {
    const { container } = await mount(
      fakeStore({ draft: { ...emptyKit(), logos: { logo: fakeAsset('v0', 'white.png', 'logo') } } }),
    )
    fireEvent.change(screen.getByLabelText('Wrong slot? Move it to'), { target: { value: 'logoOnDark' } })
    await waitFor(() =>
      expect(within(container.querySelector('[data-slot="logoOnDark"]') as HTMLElement).getByText('white.png')).toBeTruthy(),
    )
    expect(within(container.querySelector('[data-slot="logo"]') as HTMLElement).getByText('Empty')).toBeTruthy()
  })

  it('edits colours through the hex field, refuses bad codes, and suggests nothing it cannot parse', async () => {
    const { store } = await mount()
    const hex = screen.getByLabelText('Brand colour: colour code') as HTMLInputElement
    fireEvent.change(hex, { target: { value: '#1A73E8' } })
    expect((screen.getByLabelText('Brand colour: colour picker') as HTMLInputElement).value).toBe('#1a73e8')
    fireEvent.blur(hex)
    await waitFor(() => expect(store.saveDraft).toHaveBeenCalled())
    expect(vi.mocked(store.saveDraft).mock.calls.at(-1)?.[1].colors.primary).toBe('#1a73e8')

    fireEvent.change(hex, { target: { value: '#12' } })
    expect(screen.getByText('Use a six-digit colour code, like #1a73e8.')).toBeTruthy()
    expect(hex.getAttribute('aria-invalid')).toBe('true')
  })

  it('debounces typing into one save and flushes on blur', async () => {
    const { store } = await mount(undefined, { debounceMs: 10_000 })
    const name = screen.getByLabelText('Business name')
    fireEvent.change(name, { target: { value: 'S' } })
    fireEvent.change(name, { target: { value: 'Sky' } })
    expect(store.saveDraft).not.toHaveBeenCalled()
    fireEvent.blur(name)
    await waitFor(() => expect(store.saveDraft).toHaveBeenCalledTimes(1))
    expect(vi.mocked(store.saveDraft).mock.calls[0]?.[1].name).toBe('Sky')
  })

  it('shows a refused website beside the field', async () => {
    await mount()
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'javascript:alert(1)' } })
    const website = screen.getByLabelText('Website')
    expect(website.getAttribute('aria-invalid')).toBe('true')
  })

  it('lists repairs and warnings from every surface beside the previews', async () => {
    // A very dark brand colour must be lightened for the dark TV screen; the theme says so.
    await mount(fakeStore({ draft: { ...emptyKit(), colors: { primary: '#0a0a0a' } } }))
    const list = screen.getByRole('list', { name: 'Checks on your draft' })
    expect(list.textContent).toMatch(/Hangar TV/)
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0)
  })

  it('offers the curated heading fonts', async () => {
    await mount()
    const select = screen.getByLabelText('Heading font') as HTMLSelectElement
    expect(select.options.length).toBe(CURATED_FONTS.length + 1)
    const first = CURATED_FONTS[0]
    if (!first) throw new Error('no curated fonts')
    fireEvent.change(select, { target: { value: first.id } })
    expect(select.value).toBe(first.id)
  })

  it('loads only the chosen curated font stylesheet, and only when asked to', async () => {
    const first = CURATED_FONTS[0]
    if (!first) throw new Error('no curated fonts')
    await mount(fakeStore({ draft: { ...emptyKit(), fonts: { heading: first.id } } }), { loadFonts: true })
    await waitFor(() => expect(document.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1))
    expect(document.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe(first.cssUrl)
    cleanup()
    document.head.querySelectorAll('link').forEach((l) => l.remove())
    await mount(fakeStore({ draft: { ...emptyKit(), fonts: { heading: first.id } } }))
    expect(document.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0)
  })

  it('publishes, shows when it went live, and calls onPublished', async () => {
    const onPublished = vi.fn()
    const { store } = await mount(fakeStore(), { onPublished })
    const publish = screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement
    expect(publish.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Skydive Testharness East' } })
    expect(screen.getByText('Draft — not live yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1))
    expect(store.publish).toHaveBeenCalledTimes(1)
    await screen.findByText(/Live since/)
    expect(screen.queryByText('Draft — not live yet')).toBeNull()
    expect(screen.getByText('Live now')).toBeTruthy()
  })

  it('rolls back to an older version from the history', async () => {
    const store = fakeStore({ live: { ...emptyKit(), name: 'Old look' } })
    const oldId = store.liveId
    // Publish a second version directly in the store.
    const d = await store.createDraft()
    await store.saveDraft(d.id, { ...emptyKit(), name: 'New look' } as BrandKit)
    await store.publish(d.id)
    await mount(store)
    const again = screen.getAllByRole('button', { name: 'Make this live again' })
    expect(again).toHaveLength(1)
    fireEvent.click(again[0] as HTMLElement)
    await waitFor(() => expect(store.rollback).toHaveBeenCalledWith(oldId))
  })

  it('discards the draft only after confirming', async () => {
    const { store } = await mount(fakeStore({ live: emptyKit(), draft: { ...emptyKit(), name: 'Draft name' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(store.discardDraft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, discard' }))
    await waitFor(() => expect(store.discardDraft).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByLabelText('Business name') as HTMLInputElement).value).toBe(''))
  })

  it('never turns customer text into markup', async () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    const { container } = await mount(fakeStore({ draft: { ...emptyKit(), name: 'Safe', tagline: 'Fine' } }))
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: hostile } })
    fireEvent.change(screen.getByLabelText('Tagline'), { target: { value: hostile } })
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    // Inside the email frame the name arrives escaped, never as a live tag.
    const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc') ?? ''
    expect(srcdoc).not.toContain('<script>alert(2)</script>')
  })
})
