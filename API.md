# brand-kit v0.1 — the agreed internal API (build contract)

Types live in `src/core/kit.ts`: read it first. It is the contract and is not to be changed without saying so in your report.
Every module is ESM TypeScript with NodeNext resolution, so imports end in `.js`.

## Entry points and who builds what

| Entry | Directory | Rule | Builder |
|---|---|---|---|
| `.` | `src/core/` | **No DOM, no dependencies.** Runs in Deno edge functions and in Node. `tsconfig.core.json` type-checks it without the DOM library | A (core), B (`analyse.ts`, `palette.ts`) |
| `./browser` | `src/browser/` | DOM allowed. May import `dompurify` and `../core/*.js` | B |
| `./supabase` | `src/supabase/` | No `@supabase/supabase-js` import; the client is typed structurally (`SupabaseLike`) | B |
| `./react` | `src/react/` | React as a peer. Imports core, browser and the supabase `BrandKitStore` type | C |
| SQL | `sql/brand_kit.sql` | Reference migration a product copies | B |

## Core (`src/core/`)

- **`validate.ts`**
  - `parseKit(input: unknown, rules: BrandStorageRules, mode: 'strict' | 'lenient'): ParseResult`. Unknown keys are dropped.
    - **Strict** (writes): every bad field becomes a `refused` problem and is dropped from the returned kit.
    - **Lenient** (reads of stored rows): bad fields are dropped silently, so one bad value never blanks a screen.
    - Colours must be `#rrggbb`, and 3-digit or upper-case input is normalised with a `repaired` problem.
    - Text is trimmed, its whitespace collapsed, and checked against `TEXT_LIMITS`.
    - `website` is a bare host or an http(s) URL; `javascript:` and similar are refused.
    - Every rendition `url` must pass `isOwnPublicAssetUrl`. Every `originalPath` and `guide.path` must start with `${tenantId}/`.
    - `fonts.heading` must be a `CURATED_FONTS` id.
  - `assertKit(input, rules): BrandKit` is strict and throws `KitError` (with `.problems`) when anything was refused.
- **`color.ts`**
  - `parseHex(s: string): string | null` returns lower-case `#rrggbb`.
  - `relativeLuminance(hex)` and `contrastRatio(a, b)` follow WCAG 2.
  - `inkFor(bg): '#000000' | '#ffffff'`.
  - `hexToOklch(hex): {l, c, h}` and `oklchToHex({l, c, h})`, which clamps into the sRGB gamut.
  - `ensureContrast(fg, bg, min): string` moves `fg`'s OKLCH lightness until the pair reaches `min`.
  - `deriveColors(colors: BrandKitColors, fallbackAccent: string, ground: 'light' | 'dark'): { colors: ThemeColors; problems: KitProblem[] }`.
    - On a dark ground, an accent too dark to see against `#111111` (contrast below 3:1) is lightened in OKLCH, with a `repaired` problem.
    - `accentInk` is black or white at 4.5:1 or better; if neither reaches it, the accent itself is adjusted.
  - `statusColourWarning(hex): KitProblem | null` warns when the OKLCH hue is near red (about 0–45°) or amber (about 45–100°) and chroma is above 0.08. Brand colour must never be mistaken for a status colour.
- **`files.ts`** (bytes in, never a DOM)
  - `sniffType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml' | 'application/pdf' | null` decides by magic bytes. SVG is recognised as text whose first element is `<svg`, after an optional XML prolog, comments and BOM.
  - `readImageSize(bytes): { width; height } | null` for PNG (IHDR), JPEG (SOF0/1/2) and WebP (VP8, VP8L, VP8X).
  - `svgDenyScan(text): string[]` is defence in depth after DOMPurify. It returns reasons for:
    - `<script`, `on*=` handlers, `<foreignObject`, `<iframe`, `<embed`, `<object`;
    - `href` / `xlink:href` not starting with `#`;
    - `@import`, `url(` not pointing at `#`, and `<!ENTITY` / `<!DOCTYPE`.
  - `checkPng(bytes, expected?: { width; height; maxBytes }): KitProblem[]` is the server-side check of an uploaded rendition: magic bytes, size and dimensions.
- **`paths.ts`** builds every path from `BrandStorageRules`.
  - `publicAssetPath(rules, versionId, sha256)` gives `${tenantId}/${versionId}/${sha256}.png`.
  - `publicAssetUrl(rules, path)` gives `${storageOrigin}/storage/v1/object/public/${publicBucket}/${path}`.
  - `originalPath(rules, versionId, sha256, ext)` gives `${tenantId}/${versionId}/original-${sha256}.${ext}`.
  - `guidePath(rules, versionId, sha256)` gives `${tenantId}/${versionId}/guide-${sha256}.pdf`.
  - `isOwnPublicAssetUrl(url, rules): boolean` requires https, the exact origin, the public bucket and the tenant prefix, with a file name of 64 hex characters plus `.png`, no `..`, and no query or credentials.
- **`fonts.ts`**
  - `CURATED_FONTS: readonly { id; family; fallback; category: 'sans' | 'serif' | 'display' | 'mono'; cssUrl }[]` holds about 12 SIL Open Font Licence Google Fonts.
  - `cssUrl` is the `https://fonts.googleapis.com/css2?family=...&display=swap` address.
  - `fontById(id)` looks one up.
- **`theme.ts`**
  - `chooseLogo(kit, surface): LogoChoice | null`. Dark surfaces (`web-dark`, `tv`) prefer `logoOnDark`. Otherwise `logo` is used with `chip = tone.transparent && tone.luminance < 0.4`. The other surfaces use `logo`, then `mark`.
    - Rendition per surface: web uses `web2x`, email `email`, pdf `pdf`, print `print`, tv `web2x`.
    - Width and height are the display size: height 48 on web/tv, 60 on email, and the true pixel size on pdf/print.
  - `deriveTheme(kit, identity, options: ApplyOptions): BrandTheme`. Problems are those from `deriveColors`, plus a `statusColourWarning`, plus a `warning` when a dark logo is chipped.
- **`apply.ts`**
  - `themeCssVars(theme): Record<string, string>` covers `--brand-accent`, `--brand-accent-ink`, `--brand-accent-hover`, `--brand-accent-soft`, `--brand-secondary`, `--brand-secondary-ink` and `--brand-font-heading`. Secondary and font are omitted when null.
  - `themeCssText(theme, selector = ':root'): string`. Values are re-validated as hex or curated font stacks, and the selector is checked against a strict pattern.
  - `applyThemeToElement(theme, el: { style: { setProperty(k, v): void; removeProperty(k): void } })` is typed structurally, so core stays DOM-free. It removes vars the theme doesn't set.
  - `emailHeaderHtml(theme): string` is a table-based header.
    - The logo cell has an explicit `bgcolor` and `style` background, so dark-mode inversion cannot hide the logo.
    - The `<img>` has width, height and alt (the business name), and every text is escaped.
    - With no logo, the name is drawn as text.
  - `emailFooterHtml(theme): string` carries the website and the powered-by line.
  - `pdfLogo(theme): { url; width; height; ratio } | null`.
  - `escapeHtml(s)`.
- **`versions.ts`**
  - `publishProblems(version): KitProblem[]` refuses publishing anything that isn't a draft. It does not require a logo: an empty kit is a valid published kit.
  - `draftFrom(live: BrandKitVersion | null): BrandKit` deep-copies the live kit, or returns `emptyKit()`.
- **`analyse.ts`** (B; pure)
  - `analysePixels(rgba: Uint8Array | Uint8ClampedArray, width, height): { trim: { x; y; width; height }; tone: LogoTone; aspect: number } | null`.
  - `trim` excludes transparent margins (alpha below 16). For opaque images it excludes uniform near-white or near-black border rows and columns.
  - `tone.luminance` is the alpha-weighted mean luminance of visible pixels. `transparent` means at least 5% of pixels have alpha below 250.
  - Returns null when nothing is visible.
- **`palette.ts`** (B; pure)
  - `extractPalette(rgba, width, height, max = 5): { hex: string; share: number }[]` uses median cut over visible pixels and skips pixels with alpha below 128.
  - Near-white and near-black are included but sorted after chromatic colours, so the first entries are good brand-colour suggestions.
- **`index.ts`** (A) re-exports everything in `src/core/`, including B's two files.

## Browser (`src/browser/`, B)

- **`types.ts`**
  - `PreparedRendition = { name: RenditionName; blob: Blob; width: number; height: number; sha256: string }`.
  - `PreparedLogo = { slot: LogoSlot; original: { blob: Blob; type: LogoSourceType; name: string; sha256: string; ext: string }; renditions: PreparedRendition[]; tone: LogoTone; aspect: number; palette: { hex: string; share: number }[]; problems: KitProblem[] }`.
  - `PreparedGuide = { blob: Blob; name: string; bytes: number; sha256: string }`.
- **`sanitize.ts`:** `sanitizeSvg(text: string): { svg: string; removed: string[] }` runs DOMPurify with `USE_PROFILES: { svg: true, svgFilters: true }`, forbids `foreignObject`, `script` and `style` (or cleans `style` of `url(` and `@import`), and then runs `svgDenyScan`. It throws `KitError` if anything dangerous remains.
- **`prepare.ts`**
  - `prepareLogo(file: File, slot: LogoSlot): Promise<PreparedLogo>`:
    - checks size against `UPLOAD_LIMITS` and sniffs the type from bytes (refusing a mismatch);
    - sanitises SVG;
    - decodes to a canvas and analyses it;
    - refuses a logo whose trimmed shorter side is under `logoMinPx`;
    - renders `WIDE_RENDITIONS` (or `MARK_RENDITIONS` for `mark`) as PNG from the trimmed box, with a small padding (4% of height);
    - extracts the palette and hashes everything.
  - `prepareGuide(file: File): Promise<PreparedGuide>` requires PDF magic bytes and `guideMaxBytes`.
- **`rasterise.ts`** and **`hash.ts`** (`sha256Hex(blob | Uint8Array)` via `crypto.subtle`) are internal helpers.
- **`index.ts`** re-exports.

## Supabase (`src/supabase/`, B)

- `SupabaseLike` is the minimal structural shape of supabase-js v2 used: `from(table)` with select/insert/update/delete/eq/is/order/maybeSingle/single, `storage.from(bucket).upload(path, blob, { contentType, cacheControl, upsert: false })`, and `rpc(fn, args)`.
- `interface BrandKitStore`:
  - `loadLive(): Promise<BrandKitVersion | null>`
  - `loadDraft(): Promise<BrandKitVersion | null>`
  - `createDraft(): Promise<BrandKitVersion>`, which starts from live via `draftFrom`.
  - `saveDraft(id, kit): Promise<BrandKitVersion>`, which validates strictly and refuses on `refused`.
  - `uploadLogo(draftId, prepared: PreparedLogo): Promise<LogoAsset>`. The original goes to the private bucket and the renditions to the public bucket at content-hash paths, with `cacheControl` set to one year and `upsert: false`.
  - `uploadGuide(draftId, prepared: PreparedGuide): Promise<BrandGuideRef>`
  - `publish(draftId): Promise<BrandKitVersion>` calls the `brand_kit_publish` rpc, which is atomic.
  - `rollback(versionId): Promise<void>` calls the `brand_kit_rollback` rpc.
  - `listPublished(): Promise<BrandKitVersion[]>`
  - `discardDraft(id): Promise<void>`
  - `publicUrl(path): string`
- `supabaseBrandStore(client: SupabaseLike, rules: BrandStorageRules, options?: { versionsTable?: string; liveTable?: string }): BrandKitStore`
- **`sql/brand_kit.sql`:**
  - **Tables:** `brand_kit_versions` (with a partial unique index allowing one draft per tenant; published rows immutable by trigger) and `brand_kit_live` (tenant primary key, pointing at a published version).
  - **RPCs:** `brand_kit_publish(draft_id)` and `brand_kit_rollback(version_id)`, `security definer`, each checking the caller's right to edit the tenant.
  - **Buckets** with storage policies:
    - **`brand-assets`:** public read; insert only into your own tenant's folder; **no update policy**; delete only for paths of never-published drafts.
    - **`brand-originals`:** private, member read and insert only.
  - **Placeholders** a product replaces: `:tenant_table`, `:tenant_id_type`, and the function `:can_edit_tenant(tenant_id)` and `:can_read_tenant(tenant_id)` calls, clearly marked with comments.

## React (`src/react/`, C)

- `useBrandKit(store: BrandKitStore)` loads live and draft. It exposes `draft`, `live`, `published[]`, `busy`, `error`, `edit(patch)` (debounced save), `uploadLogo(slot, file)`, `removeLogo(slot)`, `uploadGuide(file)`, `publish()`, `rollback(id)` and `discard()`.
- `<BrandKitDropIn store identity rules fallbackName surfaces? showPoweredBy? onPublished? />` is the whole drop-in. It has:
  - a drop zone that accepts several files at once and guesses the slot (square goes to `mark`, a light-toned transparent logo to `logoOnDark`, otherwise `logo`; the customer can change it);
  - three logo slots;
  - a colour picker with palette suggestions from the logo;
  - a heading-font picker from `CURATED_FONTS`;
  - name, tagline and website fields;
  - a brand-guide upload;
  - a problems list in plain English;
  - live previews on several surfaces;
  - Publish, version history with rollback, and Discard draft.
- `<BrandPreview theme surface />` gives faithful mock-ups of a web header (light), a dark TV header, an email header (rendered from `emailHeaderHtml` inside a sandboxed `iframe srcdoc`), and a PDF header.
- **`styles.css`** is self-contained and scoped under `.bk-`, uses CSS variables with neutral defaults, and contains no Tailwind.
- `index.ts` re-exports.
