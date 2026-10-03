/**
 * Cleaning a customer's SVG. SVG is a document format that can carry scripts, event handlers, embedded HTML
 * and links to other files (research §4.2), so every SVG is treated as hostile:
 *
 * 1. DOMPurify with its SVG profile removes scripts, event handlers and anything outside the profile.
 * 2. Our hooks remove what DOMPurify allows but a logo never needs: any `href` / `xlink:href` that is not
 *    an internal `#fragment` (DOMPurify keeps `https:` links), CSS `url(...)` that is not `#fragment`, and
 *    `@import` inside `<style>`.
 * 3. `svgDenyScan` (core) scans the result again; if it finds anything, the file is refused.
 *
 * `<style>` elements are CLEANED, not removed: Illustrator puts every fill colour in a `<style>` block, and
 * removing it would turn the customer's logo black without telling them. A `<style>` containing a CSS
 * escape (a backslash) is emptied instead, because escapes can spell `url(` or `@import` in ways a pattern
 * cannot see.
 *
 * `<use>` is allowed (DOMPurify removes it by default) because design tools use it to reuse shapes inside
 * the same file; its link is held to `#fragment` like every other.
 *
 * The cleaned text is only ever drawn through an `Image` loaded from a Blob URL (where browsers run no
 * script and load nothing external) and stored privately. It is never inserted into a page.
 */
import createDOMPurify from 'dompurify'
import type { Config, DOMPurify } from 'dompurify'
import { svgDenyScan } from '../core/files.js'
import { KitError } from '../core/validate.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'

export interface SanitizedSvg {
  /** The cleaned SVG as a standalone XML document (with `xmlns`), ready to put in a Blob. */
  svg: string
  /** What was removed, in short plain words, e.g. `<script> element`, `onload attribute on <svg>`. */
  removed: string[]
}

/** True when CSS text (a `<style>` block or a `style` attribute) has a `url(...)` that is not `#fragment`. */
export function hasExternalCssUrl(css: string): boolean {
  // The lookahead covers spaces and quotes itself, so backtracking `\s*` cannot sneak past `url( "#a")`.
  return /url\s*\((?![\s'"]*#)/i.test(css)
}

/** CSS functions that take a plain string as an address, so they load files without `url(`. */
const STRING_URL_FUNCTIONS = /(?:-webkit-)?image-set\s*\(|\bimage\s*\(|cross-fade\s*\(|\belement\s*\(|expression\s*\(|-moz-binding|\bbehavior\s*:/i

/**
 * Cleans the text of a `<style>` element: drops comments, every `@import`, and replaces each external
 * `url(...)` with `none`. Text with a CSS escape, or a string-address function, is emptied.
 */
export function cleanSvgCss(css: string): { css: string; removed: string[] } {
  if (css.includes('\\')) return { css: '', removed: ['<style> block containing CSS escapes'] }
  const removed: string[] = []
  // An unclosed comment runs to the end of the text, as it does in CSS.
  let out = css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '')
  const withoutImports = out.replace(/@import\b[^;]*(?:;|$)/gi, '')
  if (withoutImports !== out) removed.push('@import in <style>')
  out = withoutImports
  const withoutUrls = out.replace(/url\s*\((?![\s'"]*#)\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi, 'none')
  if (withoutUrls !== out) removed.push('link to another file (url) in <style>')
  out = withoutUrls
  if (STRING_URL_FUNCTIONS.test(out) || hasExternalCssUrl(out)) {
    return { css: '', removed: [...removed, '<style> block loading other files'] }
  }
  return { css: out, removed }
}

const CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['use'],
  FORBID_TAGS: ['foreignObject', 'foreignobject', 'script', 'iframe', 'embed', 'object', 'animate', 'set', 'handler', 'listener'],
  KEEP_CONTENT: false,
}

let purifier: DOMPurify | null = null
/** Notes from the `<style>` hook during the current (synchronous) sanitize call. */
let styleNotes: string[] = []

/** A DOMPurify instance of our own, so our hooks never touch the host app's global DOMPurify. */
function getPurifier(): DOMPurify {
  if (purifier !== null) return purifier
  const win = (globalThis as { window?: unknown }).window
  if (win === undefined) throw new Error('sanitizeSvg needs a browser window (or jsdom)')
  const p = createDOMPurify(win as Parameters<typeof createDOMPurify>[0])
  if (!p.isSupported) throw new Error('This browser cannot run the SVG cleaner')

  p.addHook('uponSanitizeElement', (node, event) => {
    if (event.tagName !== 'style') return
    const text = node.textContent ?? ''
    const cleaned = cleanSvgCss(text)
    if (cleaned.css !== text) node.textContent = cleaned.css
    styleNotes.push(...cleaned.removed)
  })

  p.addHook('uponSanitizeAttribute', (_node, event) => {
    const name = event.attrName
    const value = event.attrValue
    if (name === 'href' || name.endsWith(':href')) {
      if (!value.trim().startsWith('#')) event.keepAttr = false
      return
    }
    if (name === 'style') {
      if (value.includes('\\') || hasExternalCssUrl(value) || STRING_URL_FUNCTIONS.test(value) || /@import/i.test(value)) {
        event.keepAttr = false
      }
      return
    }
    // Presentation attributes such as fill="url(...)" can point at other files too.
    if (hasExternalCssUrl(value)) event.keepAttr = false
  })

  purifier = p
  return p
}

function refuse(message: string): never {
  throw new KitError([{ field: 'logo', severity: 'refused', message }])
}

/**
 * Cleans an SVG. Returns the cleaned document and what was removed; throws `KitError` when the text is not
 * an SVG, or when anything dangerous is still there after cleaning.
 */
export function sanitizeSvg(text: string): SanitizedSvg {
  const p = getPurifier()
  styleNotes = []
  let body: Node
  let notes: string[]
  try {
    body = p.sanitize(text, { ...CONFIG, RETURN_DOM: true })
  } finally {
    notes = styleNotes
    styleNotes = []
  }

  const root = firstElement(body)
  if (root === null || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
    refuse('This file is not an SVG image we can read. Export the logo again as SVG or PNG.')
  }
  if (nextElementSibling(root) !== null) {
    refuse('This SVG has more than one top-level image in it. Export the logo again as a single SVG.')
  }

  // Declare the xlink prefix, so kept internal links serialise as `xlink:href` rather than `ns1:href`.
  root.setAttributeNS(XMLNS_NS, 'xmlns:xlink', XLINK_NS)
  const svg = new XMLSerializer().serializeToString(root)

  const removed = [...describeRemoved(p.removed), ...notes]
  const remaining = svgDenyScan(svg)
  if (remaining.length > 0) {
    refuse(`This SVG contains content that is not allowed in a logo (${remaining.join('; ')}). Export it again as PNG, or as a plain SVG.`)
  }
  return { svg, removed }
}

function firstElement(node: Node): Element | null {
  for (let c = node.firstChild; c !== null; c = c.nextSibling) if (c.nodeType === 1) return c as Element
  return null
}

function nextElementSibling(node: Node): Element | null {
  for (let c = node.nextSibling; c !== null; c = c.nextSibling) if (c.nodeType === 1) return c as Element
  return null
}

/** DOMPurify's removal records, in short words. Wrapper elements and comments are left out. */
function describeRemoved(records: DOMPurify['removed']): string[] {
  const out: string[] = []
  for (const r of records) {
    if ('element' in r) {
      const el = r.element
      if (el.nodeType !== 1) continue
      const name = (el as Element).localName ?? el.nodeName.toLowerCase()
      if (name === 'body' || name === 'html' || name === 'head') continue
      out.push(`<${name}> element`)
    } else {
      const attr = r.attribute?.name ?? 'an'
      const from = (r.from as Element | null)?.localName ?? 'element'
      out.push(`${attr} attribute on <${from}>`)
    }
  }
  return [...new Set(out)]
}
