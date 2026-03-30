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
      reporter:   ['text', 'lcov', 'html'],
      include:    ['src/**/*.ts'],
      exclude:    ['src/**/*.test.ts', 'src/types/**'],
      // shapeguard is a security library — thresholds are higher than average.
      // core/, errors/, security/ must be near-perfect. Other modules 85%+.
      thresholds: {
        lines:      85,
        functions:  85,
        branches:   80,
        statements: 85,
      },
    },
  },
})
