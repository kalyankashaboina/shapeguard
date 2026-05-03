import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// ── Why the alias? ────────────────────────────────────────────────────────────
// In a workspace, 'shapeguard' resolves to packages/shapeguard via symlink.
// Vite/Vitest then looks at the package `exports` field which points to dist/.
// If dist/ doesn't exist (fresh clone, no build yet), the test suite fails
// with "Failed to resolve entry for package shapeguard".
//
// The alias tells Vite to resolve 'shapeguard' directly from TypeScript source,
// bypassing the dist/ requirement entirely. This means tests always work —
// even without running `npm run build` first.
//
// Production consumers use dist/ (via npm install). Tests use src/ directly.
export default defineConfig({
  resolve: {
    alias: {
      // Map 'shapeguard' → src/index.ts (no dist/ required)
      'shapeguard/testing': resolve(__dirname, '../../packages/shapeguard/src/testing/index.ts'),
      'shapeguard':         resolve(__dirname, '../../packages/shapeguard/src/index.ts'),
    },
  },
  test: {
    globals:     true,
    environment: 'node',
    include:     ['src/**/*.test.ts'],
  },
})
