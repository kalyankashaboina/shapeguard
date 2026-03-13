# shapeguard — GitHub & npm Publish Guide

This is the complete step-by-step guide to push shapeguard to GitHub and publish it to npm.

---

## Before you start

You need:
- Node.js 18+ installed
- A GitHub account
- An npm account (create free at [npmjs.com](https://npmjs.com))

---

## STEP 1 — Open terminal in your shapeguard folder

```bash
cd shapeguard-v2
```

---

## STEP 2 — Install dependencies

```bash
npm install
```

Installs pino, pino-pretty, express, zod, typescript, vitest, and all dev tools.

---

## STEP 3 — Typecheck (optional but recommended)

```bash
npm run typecheck
```

Should output nothing — zero errors means clean.

---

## STEP 4 — Run tests (optional but recommended)

```bash
npm test
```

Should show all tests passing, 0 failures.

---

## STEP 5 — Build dist/

```bash
npm run build
```

Creates `dist/` with:

```
dist/
  index.mjs          ← ESM entry point
  index.d.ts         ← TypeScript declarations
  adapters/
    joi.mjs / joi.d.ts
    yup.mjs / yup.d.ts
```

> If you already have a `dist/` folder from a previous build, this overwrites it cleanly.

---

## STEP 6 — Push to GitHub

### Create the repo on GitHub first

Go to [github.com](https://github.com) → **New repository** → name it `shapeguard` → **Create repository** — do NOT add README or .gitignore, we already have them.

### Push

```bash
git init
git add .
git commit -m "feat: initial release v0.1.0"
git branch -M main
git remote add origin https://github.com/kalyankashaboina/shapeguard-.git
git push -u origin main
```

### Verify

Open `https://github.com/kalyankashaboina/shapeguard-` — all files should be visible.

---

## STEP 7 — Publish to npm

### Login (first time only)

```bash
npm login
```

Enter your npm username, password, and the OTP sent to your email.

### Publish

```bash
npm publish --access public
```

### Verify it published

```bash
npm info shapeguard
```

Should show `0.1.0` and your name as author.

Your package is live at: `https://www.npmjs.com/package/shapeguard`

---

## How people install it

```bash
npm install shapeguard zod express
```

```ts
import { shapeguard, validate, AppError, notFoundHandler, errorHandler } from 'shapeguard'
```

---

## Future releases

```bash
# Bug fix: 0.1.0 → 0.1.1
npm version patch
git push && git push --tags
npm publish

# New feature: 0.1.0 → 0.2.0
npm version minor
git push && git push --tags
npm publish

# Stable API, declare 1.0.0
npm version major
git push && git push --tags
npm publish
```

`npm version` automatically bumps `package.json`, creates a git commit, and creates a git tag.

---

## Project structure

```
shapeguard-v2/              ← your local dev folder
  src/
    adapters/               joi, yup, zod adapters
    core/                   pre-parse guards, request-id, env
    errors/                 AppError, errorHandler, notFoundHandler, asyncHandler
    logging/                logger (pino + console fallback), request-log
    router/                 createRouter (auto 405), withShape
    validation/             validate, defineRoute, sanitize, res-helpers
    types/                  all TypeScript types + Express augmentation
    __tests__/              unit + integration tests
    index.ts                single entry point — everything exported here
    shapeguard.ts           main middleware factory
  dist/                     compiled output — what npm publishes
  docs/
    VALIDATION.md
    ERRORS.md
    LOGGING.md
    RESPONSE.md
    CONFIGURATION.md
  README.md
  CHANGELOG.md
  LICENSE
  SETUP.md                  ← this file
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  .gitignore
  .npmignore
```

---

## npm scripts reference

| Script | What it does |
|--------|-------------|
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests + coverage report |
| `npm run typecheck` | TypeScript check without building |
| `npm run build` | Build ESM + declarations to dist/ |
| `npm run build:watch` | Build in watch mode |
| `npm run lint` | ESLint on src/ |
