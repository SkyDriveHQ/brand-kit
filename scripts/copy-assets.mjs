// tsc does not copy CSS. The React drop-in ships one stylesheet; copy it next to the compiled components.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
const from = 'src/react/styles.css'
if (existsSync(from)) {
  mkdirSync('dist/react', { recursive: true })
  copyFileSync(from, 'dist/react/styles.css')
}
