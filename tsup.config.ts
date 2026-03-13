import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index:          'src/index.ts',
    'adapters/joi': 'src/adapters/joi.ts',
    'adapters/yup': 'src/adapters/yup.ts',
  },
  format:    ['esm', 'cjs'],
  dts:       true,
  sourcemap: true,
  clean:     true,
  splitting: false,
  treeshake: true,
  minify:    true,           // ← minify for smallest bundle
  target:    'node18',
  outDir:    'dist',

  // NEVER bundle any of these — keeps our bundle tiny
  external: [
    'express',
    'zod',
    'joi',
    'yup',
    'pino',          // ← moved out — lazy loaded at runtime
    'pino-pretty',   // ← moved out
  ],

  banner: { js: `/* shapeguard v1.0.0 — MIT */` },

  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' }
  },

  esbuildOptions(options) {
    options.conditions = ['import', 'require']
    // Tree-shake unused code aggressively
    options.treeShaking = true
    options.minifyWhitespace  = true
    options.minifyIdentifiers = true
    options.minifySyntax      = true
  },
})
