import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    // Core tests run in plain Node on purpose: the core must not need a DOM. Browser and React tests opt in
    // per file with a `// @vitest-environment jsdom` comment.
    environment: 'node',
  },
})
