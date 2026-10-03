# SkyDrive mock brand kit (for testing only)

Kyle, 2026-10-03: *"please make a mock brand kit for skydrive and we'll use it to test the brand kit"*.

**This is a MOCK.** It is not an approved SkyDrive identity: the suite's public name and logo are still
undecided (TBD-001a). It uses the suite's real colours (from DZGO's theme: `#5eb0ff`, `#ffb454`,
`#0b1220`, `#e8eefc`) so tests look like the product, and it arrives the way a real customer's kit does: a
folder of files to drop in.

## What to drop in

| File | What it is | Drop it as |
|---|---|---|
| `logo.svg` | Wide logo for light backgrounds: parachute canopy plus "SkyDrive" | Main logo |
| `logo-on-dark.svg` | The same in light colours, for dark backgrounds (hangar TVs) | Logo for dark backgrounds |
| `mark.svg` | Square icon: the canopy on a dark rounded square | Square icon |
| `logo.png`, `logo-on-dark.png`, `mark.png` | The same three as PNGs (1040×320 and 1024×1024, transparent) | Same slots: to test the raster path |
| `brand-guide.pdf` | One-page brand guide (logo use, colours, font, voice) | Brand guide |

**To type in by hand** (from the guide):

| Field | Value |
|---|---|
| Name | SkyDrive |
| Brand colour | `#5eb0ff` (sky blue) |
| Second colour | `#ffb454` (canopy orange) |
| Heading font | Inter |

`brand-guide.src.html` is the guide's source. To regenerate the PDF and PNGs, use headless Chrome; the
commands are in this folder's commit message.

## Deliberately bad files: `bad-files/`

Each tests one refusal or repair.

| File | What is wrong | What the engine does |
|---|---|---|
| `logo-with-script.svg` | The real logo plus an `onload`, a `<script>` and a link to an outside site | **Accepted after cleaning**, with a note: "We removed things a logo does not need from your SVG (onload attribute on `<svg>`, `<script>` element, xlink:href attribute on `<a>`)…" |
| `external-only.svg` | Only an outside image and an embedded web page | **Refused:** "This logo has nothing visible in it: every pixel is transparent." |
| `tiny-logo.png` | 48×15 pixels | **Refused:** "…only 10 pixels on its shorter side; the smallest we accept is 64…" |
| `jpeg-named-as.png` | A JPEG with a `.png` name | **Refused:** "This file is named as a PNG file but its contents are a JPEG image…" |
| `not-a-pdf.pdf` | A text file with a `.pdf` name | **Refused as a brand guide:** "A brand guide must be a PDF file. This file is not one." |
| `tall-logo.png` | Taller than it is wide, dropped as the main logo | **Accepted with a warning:** "This logo is taller than it is wide, so it will look small in headers…" |

## What the engine did with the good files (real Chrome, 2026-10-03)

| File | Shape (width÷height after trimming) | Brightness (0 dark, 1 light) | Transparent | Sizes made | Notes |
|---|---|---|---|---|---|
| `logo.svg` | 4.88 | 0.10 | yes | 5 | none |
| `logo-on-dark.svg` | 4.88 | 0.73 | yes | 5 | none |
| `mark.svg` | 1.00 | 0.04 | no | 7 | none |
| `logo.png` | 4.89 | 0.10 | yes | 5 | warning: 194 px high once trimmed, "will look soft when printed large" (true: the PNG is 320 px high including its margins) |
| `logo-on-dark.png` | 4.89 | 0.73 | yes | 5 | same print warning |
| `mark.png` | 1.00 | 0.04 | no | 7 | none |
| `brand-guide.pdf` | | | | | accepted |

**Colour warnings, also expected:**
- **Sky blue `#5eb0ff`** is "very pale, so it is hard to see on a white page", so dark text is drawn on it.
- **Canopy orange `#ffb454`** is "close to the amber used for cautions such as weather holds". A realistic case: plenty of real brands use amber.
- **On the TV (dark) theme,** only the amber warning applies.

**A realistic quirk, kept on purpose.** The SVG logos use live text ("SkyDrive" in Inter, falling back to
Segoe UI or Arial), as many customer SVGs do. So the word looks slightly different on a machine without
Inter. Real logos usually have their text converted to outlines.

## Rerun it

Serve the package root after `npm run build`:

```sh
python -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/fixtures/check.html` and keep the tab in front: a background tab is
throttled and takes much longer. `test/fixtures-mock-kit.test.ts` checks the parts that don't need a canvas
on every `npm test`.
