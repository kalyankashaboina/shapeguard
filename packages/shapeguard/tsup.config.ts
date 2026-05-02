import { defineConfig } from 'tsup'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

export default defineConfig({
  entry: {
    index:              'src/index.ts',
    'adapters/joi':     'src/adapters/joi.ts',
    'adapters/yup':     'src/adapters/yup.ts',
    'adapters/winston': 'src/adapters/winston.ts',
    'testing/index':    'src/testing/index.ts',
    'openapi/index':    'src/openapi/index.ts',
  },
  format:    ['esm', 'cjs'],
  dts:       true,
  sourcemap: true,
  clean:     true,
  splitting: false,
  treeshake: true,
  minify:    true,
  target:    'node18',
  outDir:    'dist',

  // NEVER bundle these — keeps the bundle tiny and lets consumers tree-shake
  external: [
    'express',
    'zod',
    'joi',
    'yup',
    'pino',
    'pino-pretty',
    'winston',
  ],

  // Dynamic banner — always matches package.json version
  banner: { js: `/* shapeguard v${version} — MIT */` },

  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' }
  },

  esbuildOptions(options) {
    options.conditions      = ['import', 'require']
    options.treeShaking     = true
    options.minifyWhitespace  = true
    options.minifyIdentifiers = true
    options.minifySyntax      = true
  },
})
