/**
 * Faithful mock-ups of the surfaces a brand kit is applied to, drawn from a `BrandTheme`.
 *
 * Safety: nothing here inserts customer-supplied markup into the page. Text is rendered by React (escaped),
 * colours arrive as `--brand-*` variables from `themeCssVars` (re-validated by core), logos are only ever an
 * `<img src>` of an https PNG rendition or a `blob:` URL, and the email mock-up is `emailHeaderHtml` inside an
 * `<iframe sandbox="">`, where nothing can run, submit or navigate.
 */
import type { CSSProperties, ReactElement } from 'react'
import { emailFooterHtml, emailHeaderHtml, themeCssVars } from '../core/index.js'
import type { BrandTheme, LogoChoice, Surface } from '../core/index.js'

export interface BrandPreviewProps {
  theme: BrandTheme
  /** Which mock-up to draw. Defaults to `theme.surface`. */
  surface?: Surface
  /** Overrides the caption above the mock-up. */
  caption?: string
}

export const SURFACE_LABELS: Readonly<Record<Surface, string>> = {
  'web-light': 'Web page',
  'web-dark': 'Web page, dark mode',
  email: 'Email',
  pdf: 'PDF document',
  print: 'Printed poster',
  tv: 'Hangar TV',
}

/** Only https renditions and blob: previews are ever drawn as images; anything else falls back to the name. */
export function isDrawableLogoUrl(url: string): boolean {
  return /^https:\/\//i.test(url) || /^blob:/i.test(url)
}

function varsStyle(theme: BrandTheme): CSSProperties {
  return themeCssVars(theme) as CSSProperties
}

function Logo({ logo, name, className }: { logo: LogoChoice; name: string; className?: string }): ReactElement {
  const img = (
    <img
      className="bk-mock-logo"
      src={logo.url}
      width={logo.width}
      height={logo.height}
      alt={name}
      draggable={false}
    />
  )
  if (logo.chip) {
    return (
      <span className={className ? `bk-mock-chip ${className}` : 'bk-mock-chip'} data-chip="true">
        {img}
      </span>
    )
  }
  return img
}

function BrandMark({ theme, headingLevel }: { theme: BrandTheme; headingLevel: 'p' | 'h1' }): ReactElement {
  if (theme.logo && isDrawableLogoUrl(theme.logo.url)) {
    return <Logo logo={theme.logo} name={theme.name} />
  }
  const Tag = headingLevel
  return <Tag className="bk-mock-heading">{theme.name}</Tag>
}

function PoweredBy({ theme }: { theme: BrandTheme }): ReactElement | null {
  if (!theme.poweredBy) return null
  return <div className="bk-mock-powered">{theme.poweredBy.label}</div>
}

function WebHeader({ theme, dark }: { theme: BrandTheme; dark: boolean }): ReactElement {
  return (
    <div className={dark ? 'bk-mock bk-mock-web bk-mock-web-dark' : 'bk-mock bk-mock-web'} style={varsStyle(theme)}>
      <div className="bk-mock-web-bar">
        <div className="bk-mock-web-brand">
          <BrandMark theme={theme} headingLevel="p" />
        </div>
        <div className="bk-mock-web-nav" aria-hidden="true">
          <span>About</span>
          <span>Prices</span>
          <span>Contact</span>
        </div>
      </div>
      <div className="bk-mock-web-body">
        <p className="bk-mock-heading">Welcome to {theme.name}</p>
        {theme.tagline ? <p className="bk-mock-tagline">{theme.tagline}</p> : null}
        <span className="bk-mock-button">Book now</span>
        <span className="bk-mock-pill">Open today</span>
      </div>
      <PoweredBy theme={theme} />
    </div>
  )
}

function TvHeader({ theme }: { theme: BrandTheme }): ReactElement {
  return (
    <div className="bk-mock bk-mock-tv" style={varsStyle(theme)}>
      <div className="bk-mock-tv-bar">
        <BrandMark theme={theme} headingLevel="p" />
        <span className="bk-mock-tv-clock" aria-hidden="true">
          10:42
        </span>
      </div>
      <div className="bk-mock-tv-rows" aria-hidden="true">
        <div className="bk-mock-tv-row">
          <strong>Next up</strong>
          <span>15 min</span>
        </div>
        <div className="bk-mock-tv-row">
          <span>Then</span>
          <span>40 min</span>
        </div>
      </div>
    </div>
  )
}

/** The whole email document shown in the sandboxed frame. Every piece of it comes from core's escaping helpers. */
export function emailPreviewDocument(theme: BrandTheme): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '</head><body style="margin:0;padding:12px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">' +
    emailHeaderHtml(theme) +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">' +
    '<tr><td style="background:#ffffff;padding:16px 20px;color:#18181b;font-size:14px;line-height:1.5;">' +
    'Your booking is confirmed. See you soon.' +
    '</td></tr></table>' +
    emailFooterHtml(theme) +
    '</body></html>'
  )
}

function EmailHeader({ theme }: { theme: BrandTheme }): ReactElement {
  return (
    <div className="bk-mock bk-mock-email">
      <iframe
        className="bk-mock-email-frame"
        title={`Email preview for ${theme.name}`}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={emailPreviewDocument(theme)}
      />
    </div>
  )
}

function PdfHeader({ theme }: { theme: BrandTheme }): ReactElement {
  const logo = theme.logo && isDrawableLogoUrl(theme.logo.url) ? theme.logo : null
  return (
    <div className="bk-mock bk-mock-pdf" style={varsStyle(theme)}>
      <div className="bk-mock-paper">
        <div className="bk-mock-paper-head">
          <div>
            {logo ? (
              <Logo logo={logo} name={theme.name} />
            ) : (
              <p className="bk-mock-paper-name">{theme.name}</p>
            )}
          </div>
          <div className="bk-mock-paper-meta">
            {theme.website ? <div>{theme.website}</div> : null}
            <div>Receipt</div>
          </div>
        </div>
        <div className="bk-mock-paper-lines" aria-hidden="true">
          <div className="bk-mock-paper-line" style={{ width: '70%' }} />
          <div className="bk-mock-paper-line" style={{ width: '90%' }} />
          <div className="bk-mock-paper-line" style={{ width: '55%' }} />
        </div>
      </div>
    </div>
  )
}

export function BrandPreview({ theme, surface, caption }: BrandPreviewProps): ReactElement {
  const s = surface ?? theme.surface
  let body: ReactElement
  switch (s) {
    case 'web-light':
      body = <WebHeader theme={theme} dark={false} />
      break
    case 'web-dark':
      body = <WebHeader theme={theme} dark={true} />
      break
    case 'tv':
      body = <TvHeader theme={theme} />
      break
    case 'email':
      body = <EmailHeader theme={theme} />
      break
    case 'pdf':
    case 'print':
      body = <PdfHeader theme={theme} />
      break
  }
  const drawnLogo = theme.logo && isDrawableLogoUrl(theme.logo.url)
  return (
    <figure className="bk-preview" data-surface={s}>
      <figcaption className="bk-preview-caption">{caption ?? SURFACE_LABELS[s]}</figcaption>
      {body}
      {!drawnLogo ? (
        <p className="bk-preview-note">No logo for this surface yet, so your name is shown as text.</p>
      ) : theme.logo?.chip ? (
        <p className="bk-preview-note">Your logo is on a light panel so it shows up on this dark screen.</p>
      ) : null}
    </figure>
  )
}
