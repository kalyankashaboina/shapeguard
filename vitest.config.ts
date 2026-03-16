import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    // Only run tests inside src/ — never pick up examples/
    include:     ['src/**/*.test.ts'],
    exclude:     ['examples/**', 'node_modules/**'],
    coverage: {
      provider:   'v8',
      reporter:   ['text', 'lcov'],
      include:    ['src/**/*.ts'],
      exclude:    ['src/**/*.test.ts', 'src/types/**'],
      thresholds: {
        lines:      80,
        functions:  80,
        branches:   75,
        statements: 80,
      },
    },
  },
})
