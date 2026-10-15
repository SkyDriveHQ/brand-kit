# @skydrivehq/brand-kit

**The engine behind "drop in your brand kit".** A dropzone, rigging shop or video business arrives with its
own brand: logos, colours, maybe a font and a brand-guide PDF. It drops them into a Stratica product, which
**stores** them in its own database and **applies** them to the screens, emails, PDFs and posters its
customers see.

Kyle, 2026-10-02: *"the app needs a place for customers to drop in their brand kit. we'll need this for the
rigging app, skyvideo, and dzgo"*, and *"It will store and apply them."* We never design anyone's brand.

- **Research:** skyapp `docs/research/customer-brand-kit-engine-research-v1.0.0.md`.
- **Decisions:** the Ops rows titled "Brand kits: …", each with Recommended taken.
- **Build row:** Ops `b0cc2835`.

## The shape (and why)

**One shared library; each product keeps its own copy of the data.** No product calls another product or a
central brand service at run time (suite Rule 13). Each product:

1. copies `sql/brand_kit.sql` into its own migrations and fills in its tenant table and permission checks;
2. builds a store with `supabaseBrandStore(client, rules)`;
3. mounts `<BrandKitDropIn>` on its settings page;
4. reads the live kit wherever it draws a customer-facing surface, and applies it with `deriveTheme` and
   friends.

| Entry | What it is | Runs in |
|---|---|---|
| `@skydrivehq/brand-kit` | **Core:** kit types, `parseKit`, colour maths, theme, CSS/email/PDF helpers, file sniffing, paths, versions. **No DOM, no dependencies** | Browser, Node, Deno edge functions |
| `@skydrivehq/brand-kit/browser` | `prepareLogo` (clean, measure, trim, make every PNG size, extract colours) and `prepareGuide` | Browser only (canvas, DOMPurify) |
| `@skydrivehq/brand-kit/supabase` | `supabaseBrandStore`: drafts, uploads, publish, rollback | Browser (any supabase-js v2 client) |
| `@skydrivehq/brand-kit/react` | `<BrandKitDropIn>`, `<BrandPreview>`, `useBrandKit` | React 18/19; styles in `react/styles.css` |
| `sql/brand_kit.sql` | The reference migration a product copies | The product's Supabase project |

## The security model: read this before wiring a surface

1. **Always read a stored kit through `parseKit(kit, rules, 'lenient')` before drawing it.** The database
   checks only that a kit is a JSON object under 64 KB. A tampered browser could store anything there.
   - Lenient parsing drops every bad field: non-hex colours, logo addresses that aren't this tenant's own
     public PNGs, unknown keys, fonts outside the curated list.
   - So what reaches a page is always safe, and one bad field never blanks a screen.
   - Writes use `'strict'`, which refuses with plain-English messages.
2. **SVG is never served.**
   - An uploaded SVG is cleaned (DOMPurify plus a second deny scan) and stored **privately** as the source.
   - Every surface shows PNGs generated from it.
   - Logos are drawn only as `<img>` from https or blob addresses, and no customer markup is ever inserted
     into a page.
3. **Published files are permanent.**
   - Renditions live at `{tenant}/{version}/{sha256}.png` in a public bucket, cached for a year.
   - There is no update policy, and deletion is allowed only under a draft's folder. So an email sent last
     year still shows its logo.
4. **Brand colour is chrome, never meaning.**
   - Status colours (errors, wind limits, holds) stay the product's own.
   - `statusColourWarning` tells the customer when their colour is close to red or amber.
   - Text on the brand colour is always at least 4.5:1, and on dark screens the brand colour is always at
     least 3:1 against the ground. Both are tested on 400 random colours.
5. **CSS and email output cannot be broken out of.**
   - `themeCssText` re-checks every value as strict hex or a curated font stack, and refuses odd selectors.
   - The email HTML escapes every text and checks every address again.

## Install

```sh
npm install github:SkyDriveHQ/brand-kit#v0.2.1
```

The repo is public and installed by tag, like `suite-contracts`. The package builds itself on install, and no
GitHub token is needed; that was verified with no credentials on 2026-10-03, which is how a Netlify build
installs it.

## Using it in a product

```ts
import { deriveTheme, parseKit, themeCssVars, emailHeaderHtml } from '@skydrivehq/brand-kit'
import { supabaseBrandStore } from '@skydrivehq/brand-kit/supabase'
import { BrandKitDropIn } from '@skydrivehq/brand-kit/react'
import '@skydrivehq/brand-kit/react/styles.css'

const rules = { storageOrigin: 'https://<ref>.supabase.co', publicBucket: 'brand-assets', privateBucket: 'brand-originals', tenantId: site.id }
const identity = { product: 'skyweather', productName: 'SkyWeather', poweredByLabel: 'Powered by Stratica', fallbackAccent: '#2563eb' }

// Settings page:
<BrandKitDropIn store={supabaseBrandStore(supabase, rules)} identity={identity} rules={rules} fallbackName={site.name} />

// A customer-facing surface:
const { kit } = parseKit(liveKitFromDb, rules, 'lenient')
const theme = deriveTheme(kit, identity, { surface: 'tv', fallbackName: site.name })
```

**CSS opt-in pattern.** Write `color: var(--brand-accent, var(--accent))` and an unbranded install looks
untouched.

**"Powered by".** It is one string in `ProductIdentity`, because the suite's public name is still undecided.
Whether a plan may hide it is the product's call, through `showPoweredBy`.

## Static sites: no Supabase, no browser

```ts
import { loadKitFromDir, prepareLogoFile, fileStoreRules } from '@skydrivehq/brand-kit/node'
const { kit } = await loadKitFromDir('./brand', { publicBase: 'https://example.com/brand/' })
```

- `loadKitFromDir(dir, opts)` reads `kit.json`. A logo may be a relative path (`"logos": { "logo": "logo.svg" }`),
  which is prepared into PNG renditions in `<dir>/brand-kit-out/`, or a full logo record with relative paths.
  Paths are checked with `fileStoreRules`, then resolved on disk: `..`, absolute paths, URLs and symlinks that
  leave the folder are refused. The default Supabase rules are unchanged.
- `prepareLogoFile(path, slot, outDir)` is `prepareLogo` for Node: same checks, sizes and result, using `sharp`
  (optional peer: `npm install sharp`). An SVG is rasterised and never served.
- Self-hosted heading font: pass `selfHostedFonts: true` to `deriveTheme`. `--brand-font-heading` is still set and
  no Google Fonts address is returned. Questrial, Aldrich and Roboto Condensed are in the curated list.
- `brand-kit-css <kitDir> --surface web-light [--selector :root] [--self-hosted-fonts] > kit.css` prints the theme CSS.

## Known gaps (v0.2)

- **The SQL template has never been applied anywhere.** Apply it to a branch first and run the checks in its
  header.
- **No server-side check of uploaded PNGs or of publishing yet.** For that, publish through an edge function
  that runs `publishProblems(version, rules)` and `checkPng`; core runs in Deno.
- **Heading fonts load from Google's servers by default.** `selfHostedFonts: true` turns that off; the site supplies the `@font-face`.
- **The canvas pipeline is unit-tested with a fake canvas.** It was checked in real Chrome on 2026-10-02 with
  `smoke/index.html`: a PNG trimmed to 6:1 with its two brand colours extracted and all 5 sizes made; an SVG
  with `<script>` and `onload` cleaned and all 7 icon sizes made; a hostile SVG refused. Firefox and Safari
  are not yet checked.
  - To rerun it, serve the package root (`python -m http.server 8765 --bind 127.0.0.1`) and open
    `/smoke/index.html` after `npm run build`.

## Develop

```sh
npm install
npm run typecheck   # core is checked WITHOUT the DOM library, so a DOM call in core fails the build
npm test
npm run build
```

`API.md` is the build contract the three parts were written against.
