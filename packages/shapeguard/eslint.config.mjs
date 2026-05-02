// eslint.config.mjs — shapeguard
// ESLint 9 flat config — no type-aware rules to avoid tsconfig exclude conflicts

import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'examples/**',
      'website/**',
      'scripts/**',
      '*.mjs',
    ],
  },
  {
    // Source files — strict rules, no console
    files: ['src/**/*.ts'],
    ignores: ['src/__tests__/**', 'src/logging/logger.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType:  'module',
        // No "project" — avoids "file not in project" errors for excluded test files
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any':      'warn',
      '@typescript-eslint/no-unused-vars':       ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console':  'error',
      'no-debugger': 'error',
    },
  },
  {
    // logger.ts IS the fallback logger — console.* is intentional here
    files: ['src/logging/logger.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Test files — relaxed rules
    files: ['src/__tests__/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
]
