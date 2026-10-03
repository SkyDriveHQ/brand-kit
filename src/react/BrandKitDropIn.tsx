/**
 * `<BrandKitDropIn>`: the whole "drop in your brand kit" screen.
 *
 * A customer (a dropzone, a rigging shop) drops in their own logos, colours, heading font and brand guide.
 * The screen stores them as a DRAFT through the product's `BrandKitStore`, previews the draft on real
 * surfaces, and publishes it. Nothing here designs anyone's brand, and nothing customer-supplied is ever
 * inserted into the page as markup (see `BrandPreview.tsx`).
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent, ReactElement } from 'react'
import {
  CURATED_FONTS,
  LOGO_SLOTS,
  TEXT_LIMITS,
  deriveTheme,
  fontById,
  parseHex,
  parseKit,
} from '../core/index.js'
import type {
  ApplyOptions,
  BrandKit,
  BrandKitVersion,
  BrandStorageRules,
  BrandTheme,
  KitProblem,
  LogoAsset,
  LogoSlot,
  ProblemSeverity,
  ProductIdentity,
  Surface,
} from '../core/index.js'
import type { BrandKitStore } from '../supabase/index.js'
import { BrandPreview, SURFACE_LABELS, isDrawableLogoUrl } from './BrandPreview.js'
import { SLOT_COPY } from './slots.js'
import { useBrandKit } from './useBrandKit.js'
import type { PaletteSuggestion, UploadItem, UseBrandKit } from './useBrandKit.js'

export interface BrandKitDropInProps {
  /** The product's store. Read on mount; to show a different tenant, remount with a `key`. */
  store: BrandKitStore
  identity: ProductIdentity
  /** The product's storage rules. Used to check the draft as the customer types, exactly as the store will. */
  rules: BrandStorageRules
  /** The business's name from the product's own records, shown when the kit has none. */
  fallbackName: string
  /** Surfaces to preview. Default: web page, hangar TV, email and PDF. */
  surfaces?: readonly Surface[]
  showPoweredBy?: boolean
  onPublished?: (version: BrandKitVersion) => void
  /** Load the chosen heading font's stylesheet from Google Fonts for the previews. Default true. */
  loadFonts?: boolean
  /** Delay before text edits are saved. Default 600 ms. */
  debounceMs?: number
  className?: string
}

export const DEFAULT_PREVIEW_SURFACES: readonly Surface[] = ['web-light', 'tv', 'email', 'pdf']

const LOGO_ACCEPT = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml'
const ALL_ACCEPT = `${LOGO_ACCEPT},.pdf,application/pdf`

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

function slotPreviewUrl(asset: LogoAsset): string | null {
  const r = asset.renditions
  const url = (r.web2x ?? r.web ?? r.email ?? r.pdf ?? r.icon192 ?? r.print ?? r.icon512)?.url
  return url && isDrawableLogoUrl(url) ? url : null
}

function isUnbranded(kit: BrandKit): boolean {
  return Object.keys(kit.logos).length === 0 && !kit.colors.primary && !kit.colors.secondary
}

const SEVERITY_LABEL: Record<ProblemSeverity, string> = {
  refused: 'Not used:',
  repaired: 'Fixed for you:',
  warning: 'Worth knowing:',
}

interface ListedProblem {
  severity: ProblemSeverity
  message: string
  where: string[]
}

function collectProblems(groups: { where: string; problems: readonly KitProblem[] }[]): ListedProblem[] {
  const byKey = new Map<string, ListedProblem>()
  for (const g of groups) {
    for (const p of g.problems) {
      const key = `${p.severity}\u0000${p.message}`
      const found = byKey.get(key)
      if (found) {
        if (!found.where.includes(g.where)) found.where.push(g.where)
      } else {
        byKey.set(key, { severity: p.severity, message: p.message, where: [g.where] })
      }
    }
  }
  const order: Record<ProblemSeverity, number> = { refused: 0, warning: 1, repaired: 2 }
  return [...byKey.values()].sort((a, b) => order[a.severity] - order[b.severity])
}

function ProblemList({ problems, label }: { problems: readonly ListedProblem[]; label: string }): ReactElement {
  return (
    <ul className="bk-problems" aria-label={label}>
      {problems.map((p) => (
        <li key={`${p.severity}-${p.message}`} className={`bk-problem bk-problem-${p.severity}`}>
          <span className="bk-problem-kind">{SEVERITY_LABEL[p.severity]}</span>
          {p.message}
          {p.where.length > 0 ? <span className="bk-muted"> ({p.where.join(', ')})</span> : null}
        </li>
      ))}
    </ul>
  )
}

// ------------------------------------------------------------------------------------------------ status bar

function StatusBar({ bk, onPublish }: { bk: UseBrandKit; onPublish: () => void }): ReactElement {
  const [confirming, setConfirming] = useState(false)
  const hasDraft = bk.draft !== null || bk.dirty
  return (
    <div className="bk-status">
      <div>
        {hasDraft ? (
          <span className="bk-badge bk-badge-draft">Draft — not live yet</span>
        ) : (
          <span className="bk-badge bk-badge-live">No unpublished changes</span>
        )}
        <p className="bk-p bk-muted" style={{ marginTop: 6 }}>
          {bk.live?.publishedAt
            ? `Live since ${formatWhen(bk.live.publishedAt)}.`
            : 'Nothing published yet, so customers see the unbranded look.'}
          {hasDraft ? ' Changes save automatically, and customers see them only after you publish.' : ''}
        </p>
        <span className="bk-hint" aria-live="polite">
          {bk.busy ? 'Saving…' : ''}
        </span>
      </div>
      {confirming ? (
        <div className="bk-row" role="group" aria-label="Confirm discarding the draft">
          <span>Throw away every change since the live version?</span>
          <button
            type="button"
            className="bk-btn bk-btn-danger"
            onClick={() => {
              setConfirming(false)
              void bk.discard()
            }}
          >
            Yes, discard
          </button>
          <button type="button" className="bk-btn" onClick={() => setConfirming(false)}>
            Keep editing
          </button>
        </div>
      ) : (
        <div className="bk-row">
          <button type="button" className="bk-btn" disabled={!hasDraft || bk.busy} onClick={() => setConfirming(true)}>
            Discard draft
          </button>
          <button type="button" className="bk-btn bk-btn-primary" disabled={!hasDraft || bk.busy} onClick={onPublish}>
            Publish
          </button>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ drop zone

const STATUS_TEXT: Record<UploadItem['status'], string> = {
  preparing: 'Checking…',
  uploading: 'Uploading…',
  done: 'Added',
  failed: 'Not added',
}

function UploadList({ uploads }: { uploads: readonly UploadItem[] }): ReactElement | null {
  if (uploads.length === 0) return null
  return (
    <ul className="bk-uploads" aria-label="Files added" aria-live="polite">
      {uploads.map((u) => (
        <li key={u.id} className={u.status === 'failed' ? 'bk-upload bk-upload-failed' : 'bk-upload'}>
          <div className="bk-row" style={{ justifyContent: 'space-between' }}>
            <span className="bk-upload-name">{u.fileName}</span>
            <span>
              {STATUS_TEXT[u.status]}
              {u.status === 'done' && u.kind === 'logo' && u.slot ? ` as ${SLOT_COPY[u.slot].title.toLowerCase()}` : ''}
              {u.status === 'done' && u.kind === 'guide' ? ' as your brand guide' : ''}
            </span>
          </div>
          {u.problems.length > 0 ? (
            <ProblemList
              label={`Problems with ${u.fileName}`}
              problems={collectProblems([{ where: '', problems: u.problems }]).map((p) => ({ ...p, where: [] }))}
            />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function DropZone({ bk }: { bk: UseBrandKit }): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(false)
  const hintId = useId()
  const open = (): void => inputRef.current?.click()
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    }
  }
  const onDrag = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    setActive(true)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setActive(false)
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length > 0) void bk.addFiles(files)
  }
  const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length > 0) void bk.addFiles(files)
  }
  return (
    <section className="bk-section" aria-labelledby={`${hintId}-title`}>
      <h3 className="bk-h2" id={`${hintId}-title`}>
        Drop in your brand kit
      </h3>
      <div
        className={active ? 'bk-dropzone bk-dropzone-active' : 'bk-dropzone'}
        role="button"
        tabIndex={0}
        aria-label="Add brand files"
        aria-describedby={hintId}
        onClick={open}
        onKeyDown={onKeyDown}
        onDragEnter={onDrag}
        onDragOver={onDrag}
        onDragLeave={() => setActive(false)}
        onDrop={onDrop}
      >
        <span className="bk-dropzone-title">Drag your logos and brand guide here</span>
        <span className="bk-hint" id={hintId}>
          Or press Enter to choose files. Logos can be PNG, JPEG, WebP or SVG; a brand guide must be a PDF. You can add
          several at once, and we will sort each logo into a slot for you to check.
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ALL_ACCEPT}
        className="bk-visually-hidden"
        tabIndex={-1}
        aria-label="Choose brand kit files"
        onChange={onChange}
      />
      <UploadList uploads={bk.uploads} />
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ logo slots

function SlotCard({ bk, slot }: { bk: UseBrandKit; slot: LogoSlot }): ReactElement {
  const copy = SLOT_COPY[slot]
  const asset = bk.kit.logos[slot]
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const url = asset ? slotPreviewUrl(asset) : null
  const lower = copy.title.toLowerCase()
  return (
    <section className="bk-slot" aria-labelledby={`${id}-title`} data-slot={slot}>
      <h4 className="bk-h3" id={`${id}-title`}>
        {copy.title}
        {copy.optional ? <span className="bk-muted"> (optional)</span> : null}
      </h4>
      <p className="bk-hint">{copy.description}</p>
      <div className={slot === 'logoOnDark' ? 'bk-slot-preview bk-slot-preview-dark' : 'bk-slot-preview'}>
        {asset && url ? (
          <img src={url} alt={`${copy.title}: ${asset.originalName}`} />
        ) : (
          <span className="bk-slot-empty">{asset ? 'Preview not available' : 'Empty'}</span>
        )}
      </div>
      {asset ? <p className="bk-slot-file">{asset.originalName}</p> : null}
      <div className="bk-row">
        <button
          type="button"
          className="bk-btn bk-btn-small"
          aria-label={asset ? `Replace ${lower}` : `Choose a file for ${lower}`}
          disabled={bk.busy}
          onClick={() => inputRef.current?.click()}
        >
          {asset ? 'Replace' : 'Choose file'}
        </button>
        {asset ? (
          <button
            type="button"
            className="bk-btn bk-btn-small bk-btn-danger"
            aria-label={`Remove ${lower}`}
            disabled={bk.busy}
            onClick={() => void bk.removeLogo(slot)}
          >
            Remove
          </button>
        ) : null}
      </div>
      {asset ? (
        <div className="bk-field" style={{ marginBottom: 0 }}>
          <label className="bk-hint" htmlFor={`${id}-move`}>
            Wrong slot? Move it to
          </label>
          <select
            id={`${id}-move`}
            className="bk-select"
            value={slot}
            disabled={bk.busy}
            onChange={(e) => void bk.moveLogo(slot, e.target.value as LogoSlot)}
          >
            {LOGO_SLOTS.map((s) => (
              <option key={s} value={s}>
                {SLOT_COPY[s].title}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={LOGO_ACCEPT}
        className="bk-visually-hidden"
        tabIndex={-1}
        aria-label={`File for ${lower}`}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void bk.uploadLogo(slot, file)
        }}
      />
    </section>
  )
}

function GuideSection({ bk }: { bk: UseBrandKit }): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const guide = bk.kit.guide
  return (
    <section className="bk-section" aria-labelledby={`${id}-title`}>
      <h3 className="bk-h2" id={`${id}-title`}>
        Brand guide (optional)
      </h3>
      <p className="bk-p bk-hint">
        Your brand-guide PDF is kept privately for reference. Nothing is read from it automatically.
      </p>
      {guide ? (
        <div className="bk-row">
          <span className="bk-upload-name">{guide.name}</span>
          <span className="bk-muted">
            {formatBytes(guide.bytes)}, added {formatWhen(guide.uploadedAt)}
          </span>
          <button type="button" className="bk-btn bk-btn-small" disabled={bk.busy} onClick={() => inputRef.current?.click()}>
            Replace
          </button>
          <button
            type="button"
            className="bk-btn bk-btn-small bk-btn-danger"
            aria-label="Remove brand guide"
            disabled={bk.busy}
            onClick={() => void bk.removeGuide()}
          >
            Remove
          </button>
        </div>
      ) : (
        <button type="button" className="bk-btn bk-btn-small" disabled={bk.busy} onClick={() => inputRef.current?.click()}>
          Choose PDF
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="bk-visually-hidden"
        tabIndex={-1}
        aria-label="Brand guide PDF"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void bk.uploadGuide(file)
        }}
      />
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ colours

interface ColorFieldProps {
  label: string
  hint: string
  value: string | undefined
  fallback: string
  clearLabel: string
  suggestions: readonly PaletteSuggestion[]
  onChange: (hex: string | undefined) => void
  onCommit: () => void
}

const SIX_DIGIT = /^#?[0-9a-f]{6}$/i

function ColorField({ label, hint, value, fallback, clearLabel, suggestions, onChange, onCommit }: ColorFieldProps): ReactElement {
  const id = useId()
  const [text, setText] = useState(value ?? '')
  useEffect(() => {
    setText((t) => (value !== undefined && parseHex(t) === value ? t : (value ?? '')))
  }, [value])
  const invalid = text.trim() !== '' && parseHex(text.trim()) === null
  const nativeValue = value ?? parseHex(fallback) ?? '#666666'
  return (
    <div className="bk-field" role="group" aria-labelledby={`${id}-label`}>
      <span className="bk-label" id={`${id}-label`}>
        {label}
      </span>
      <span className="bk-hint" id={`${id}-hint`}>
        {hint}
      </span>
      <div className="bk-color-row">
        <input
          type="color"
          className="bk-color-native"
          aria-label={`${label}: colour picker`}
          value={nativeValue}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          onBlur={onCommit}
        />
        <input
          type="text"
          className="bk-input"
          aria-label={`${label}: colour code`}
          aria-describedby={invalid ? `${id}-hint ${id}-error` : `${id}-hint`}
          aria-invalid={invalid}
          placeholder={value === undefined ? `Default ${nativeValue}` : '#rrggbb'}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          value={text}
          onChange={(e) => {
            const t = e.target.value
            setText(t)
            if (t.trim() === '') onChange(undefined)
            else if (SIX_DIGIT.test(t.trim())) {
              const hex = parseHex(t.trim())
              if (hex) onChange(hex)
            }
          }}
          onBlur={() => {
            const hex = parseHex(text.trim())
            if (hex && hex !== value) onChange(hex)
            onCommit()
          }}
        />
        {value !== undefined ? (
          <button type="button" className="bk-btn bk-btn-small" onClick={() => onChange(undefined)}>
            {clearLabel}
          </button>
        ) : null}
      </div>
      {invalid ? (
        <span className="bk-field-error" id={`${id}-error`}>
          Use a six-digit colour code, like #1a73e8.
        </span>
      ) : null}
      {suggestions.length > 0 ? (
        <div className="bk-swatches" role="group" aria-label={`Suggestions from your logo for ${label.toLowerCase()}`}>
          {suggestions.map((s) => (
            <button
              key={s.hex}
              type="button"
              className="bk-swatch"
              style={{ background: s.hex }}
              aria-label={`Use ${s.hex}`}
              aria-pressed={value === s.hex}
              title={s.hex}
              onClick={() => onChange(s.hex)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ history

function History({ bk }: { bk: UseBrandKit }): ReactElement {
  const id = useId()
  return (
    <section className="bk-section" aria-labelledby={`${id}-title`}>
      <h3 className="bk-h2" id={`${id}-title`}>
        Version history
      </h3>
      {bk.published.length === 0 ? (
        <p className="bk-p bk-muted">No versions published yet.</p>
      ) : (
        <ul className="bk-history">
          {bk.published.map((v) => {
            const isLive = bk.live?.id === v.id
            return (
              <li key={v.id} className="bk-history-item">
                <span id={`${id}-${v.id}`}>
                  Published {formatWhen(v.publishedAt ?? v.createdAt)}
                  {v.kit.name ? <span className="bk-muted"> · {v.kit.name}</span> : null}
                </span>
                {isLive ? (
                  <span className="bk-badge bk-badge-live">Live now</span>
                ) : (
                  <button
                    type="button"
                    className="bk-btn bk-btn-small"
                    aria-describedby={`${id}-${v.id}`}
                    disabled={bk.busy}
                    onClick={() => void bk.rollback(v.id)}
                  >
                    Make this live again
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ fonts

/**
 * Add the chosen curated font's stylesheet to the document head. Done in an effect rather than with React 19's
 * `<link precedence>`, which holds back the whole screen until the stylesheet loads: a slow or blocked Google
 * Fonts request must never stop the customer editing. Only `CURATED_FONTS` addresses ever reach here.
 */
function useCuratedFontStylesheet(href: string | undefined): void {
  useEffect(() => {
    if (!href || typeof document === 'undefined') return
    const existing = Array.from(document.head.querySelectorAll('link[rel="stylesheet"]')).some(
      (l) => l.getAttribute('href') === href,
    )
    if (existing) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.bkFont = 'true'
    document.head.appendChild(link)
    return () => link.remove()
  }, [href])
}

// ------------------------------------------------------------------------------------------------ the screen

export function BrandKitDropIn(props: BrandKitDropInProps): ReactElement {
  const { store, identity, rules, fallbackName, onPublished } = props
  const surfaces = props.surfaces ?? DEFAULT_PREVIEW_SURFACES
  const loadFonts = props.loadFonts ?? true
  const hookOptions = props.debounceMs === undefined ? { rules } : { rules, debounceMs: props.debounceMs }
  const bk = useBrandKit(store, hookOptions)
  const id = useId()

  // Check the draft exactly as the store will, so a refused field is shown while the customer is still on it.
  const parsed = useMemo(() => parseKit(bk.kit, rules, 'strict'), [bk.kit, rules])

  const themes = useMemo(
    () =>
      surfaces.map((surface): BrandTheme => {
        const options: ApplyOptions = { surface, fallbackName }
        if (props.showPoweredBy !== undefined) options.showPoweredBy = props.showPoweredBy
        return deriveTheme(parsed.kit, identity, options)
      }),
    [surfaces, fallbackName, props.showPoweredBy, parsed.kit, identity],
  )

  const listed = useMemo(
    () =>
      collectProblems([
        { where: 'your details', problems: parsed.problems },
        ...themes.map((t) => ({ where: SURFACE_LABELS[t.surface], problems: t.problems })),
      ]),
    [parsed.problems, themes],
  )

  const fieldError = (field: string): string | null =>
    parsed.problems.find((p) => p.field === field && p.severity === 'refused')?.message ?? null

  const font = bk.kit.fonts.heading ? fontById(bk.kit.fonts.heading) : undefined
  useCuratedFontStylesheet(loadFonts ? font?.cssUrl : undefined)
  const unbranded = isUnbranded(parsed.kit)
  const shownName = parsed.kit.name ?? fallbackName

  const onPublish = (): void => {
    void bk.publish().then((v) => {
      if (v && onPublished) onPublished(v)
    })
  }

  const textField = (field: 'name' | 'tagline' | 'website', label: string, hint: string, placeholder: string): ReactElement => {
    const err = fieldError(field)
    const fid = `${id}-${field}`
    return (
      <div className="bk-field">
        <label className="bk-label" htmlFor={fid}>
          {label}
        </label>
        <input
          id={fid}
          className="bk-input"
          type={field === 'website' ? 'url' : 'text'}
          inputMode={field === 'website' ? 'url' : undefined}
          maxLength={TEXT_LIMITS[field]}
          placeholder={placeholder}
          value={bk.kit[field] ?? ''}
          aria-describedby={err ? `${fid}-hint ${fid}-error` : `${fid}-hint`}
          aria-invalid={err ? true : undefined}
          onChange={(e) => {
            const v = e.target.value
            bk.edit(field === 'name' ? { name: v } : field === 'tagline' ? { tagline: v } : { website: v })
          }}
          onBlur={() => void bk.flush()}
        />
        <span className="bk-hint" id={`${fid}-hint`}>
          {hint}
        </span>
        {err ? (
          <span className="bk-field-error" id={`${fid}-error`}>
            {err}
          </span>
        ) : null}
      </div>
    )
  }

  const rootClass = props.className ? `bk-root ${props.className}` : 'bk-root'

  if (bk.loading) {
    return (
      <div className={rootClass} aria-busy="true">
        <p className="bk-p bk-muted" role="status">
          Loading your brand kit…
        </p>
      </div>
    )
  }

  return (
    <div className={rootClass}>
      <StatusBar bk={bk} onPublish={onPublish} />
      {bk.error ? (
        <div className="bk-error" role="alert">
          <div className="bk-row" style={{ justifyContent: 'space-between' }}>
            <span>{bk.error}</span>
            <button type="button" className="bk-btn bk-btn-small" onClick={bk.dismissError}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="bk-layout">
        <div className="bk-stack">
          <DropZone bk={bk} />

          <section className="bk-section" aria-labelledby={`${id}-logos`}>
            <h3 className="bk-h2" id={`${id}-logos`}>
              Logos
            </h3>
            <div className="bk-slots">
              {LOGO_SLOTS.map((slot) => (
                <SlotCard key={slot} bk={bk} slot={slot} />
              ))}
            </div>
          </section>

          <section className="bk-section" aria-labelledby={`${id}-colours`}>
            <h3 className="bk-h2" id={`${id}-colours`}>
              Colours
            </h3>
            <ColorField
              label="Brand colour"
              hint={`Buttons, links and highlights. Without one, ${identity.productName}'s neutral colour is used.`}
              value={bk.kit.colors.primary}
              fallback={identity.fallbackAccent}
              clearLabel="Use default"
              suggestions={bk.suggestions}
              onChange={(hex) => bk.edit({ colors: { primary: hex } })}
              onCommit={() => void bk.flush()}
            />
            <ColorField
              label="Second colour"
              hint="Optional. Used for accents alongside your brand colour."
              value={bk.kit.colors.secondary}
              fallback={bk.kit.colors.primary ?? identity.fallbackAccent}
              clearLabel="Remove"
              suggestions={bk.suggestions}
              onChange={(hex) => bk.edit({ colors: { secondary: hex } })}
              onCommit={() => void bk.flush()}
            />
          </section>

          <section className="bk-section" aria-labelledby={`${id}-text`}>
            <h3 className="bk-h2" id={`${id}-text`}>
              Name and font
            </h3>
            {textField('name', 'Business name', `Leave blank to use "${fallbackName}".`, fallbackName)}
            {textField('tagline', 'Tagline', 'Optional. A short line under your name.', '')}
            {textField('website', 'Website', 'Optional. Shown as text, for example example.com.', 'example.com')}
            <div className="bk-field">
              <label className="bk-label" htmlFor={`${id}-font`}>
                Heading font
              </label>
              <select
                id={`${id}-font`}
                className="bk-select"
                aria-describedby={`${id}-font-hint`}
                value={bk.kit.fonts.heading ?? ''}
                onChange={(e) => bk.edit({ fonts: { heading: e.target.value || undefined } })}
                onBlur={() => void bk.flush()}
              >
                <option value="">{`${identity.productName}'s own font`}</option>
                {CURATED_FONTS.map((f) => (
                  <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                    {f.family}
                  </option>
                ))}
              </select>
              <span className="bk-hint" id={`${id}-font-hint`}>
                Used for headings on web pages. Emails and PDFs always use standard fonts so they look right everywhere.
              </span>
              <p
                className="bk-font-sample"
                aria-hidden="true"
                style={font ? { fontFamily: font.stack } : {}}
              >
                {shownName}
              </p>
            </div>
          </section>

          <GuideSection bk={bk} />
        </div>

        <div className="bk-stack">
          <section className="bk-section" aria-labelledby={`${id}-previews`}>
            <h3 className="bk-h2" id={`${id}-previews`}>
              Preview of your draft
            </h3>
            {unbranded ? (
              <p className="bk-p bk-muted" data-testid="bk-unbranded">
                {`Nothing added yet, and that is fine: until you add a logo or colour, customers see "${shownName}" as text in ${identity.productName}'s neutral look.`}
              </p>
            ) : null}
            <div className="bk-previews">
              {themes.map((t) => (
                <BrandPreview key={t.surface} theme={t} surface={t.surface} />
              ))}
            </div>
          </section>

          <section className="bk-section" aria-labelledby={`${id}-problems`}>
            <h3 className="bk-h2" id={`${id}-problems`}>
              Checks
            </h3>
            {listed.length === 0 ? (
              <p className="bk-p bk-muted">Everything looks right on every surface.</p>
            ) : (
              <ProblemList problems={listed} label="Checks on your draft" />
            )}
          </section>

          <History bk={bk} />
        </div>
      </div>
    </div>
  )
}
