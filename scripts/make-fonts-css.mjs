// Writes fonts/fonts.css: the @font-face rules for every curated font, with addresses relative to that
// file. Runs after tsc so it uses the same code the package ships. test/core-fonts.test.ts checks the
// committed copy is in step.
import { writeFileSync } from 'node:fs'
import { allFontFacesCss } from '../dist/core/fonts.js'
writeFileSync('fonts/fonts.css', allFontFacesCss('./'))
