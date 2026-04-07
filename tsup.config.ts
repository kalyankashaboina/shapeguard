import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index:               'src/index.ts',
    'adapters/joi':      'src/adapters/joi.ts',
    'adapters/yup':      'src/adapters/yup.ts',
    'adapters/winston':  'src/adapters/winston.ts',
    'testing/index':     'src/testing/index.ts',
    'openapi/index':     'src/openapi/index.ts',
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
    'winston',       // ← BUG #9 FIX: was missing — downstream bundlers could accidentally inline winston
  ],

  banner: { js: `/* shapeguard v0.9.0 — MIT */` },

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
