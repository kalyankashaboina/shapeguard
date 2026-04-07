import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    include:     ['src/**/*.test.ts'],
    exclude:     ['examples/**', 'node_modules/**'],
    coverage: {
      provider:   'v8',
      reporter:   ['text', 'lcov', 'html'],
      include:    ['src/**/*.ts'],
      exclude:    ['src/**/*.test.ts', 'src/types/**'],
      thresholds: {
        lines:      90,
        functions:  90,
        branches:   85,
        statements: 90,
      },
    },
  },
})
