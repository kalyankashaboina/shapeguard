#!/usr/bin/env node
// scripts/check-examples.mjs
//
// Runs quality checks on every example from the monorepo root.
// No need to cd into each folder. Results in a single table.
//
// Usage:
//   node scripts/check-examples.mjs
//   node scripts/check-examples.mjs --only 06   (filter by number)
//   node scripts/check-examples.mjs --skip 08   (skip one)
//
// Each example must have a "check" script in its package.json:
//   Server examples: "check": "tsc --noEmit"
//   Test examples:   "check": "vitest run"

import { spawnSync }                               from 'child_process'
import { readdirSync, existsSync, readFileSync }   from 'fs'
import { join, resolve }                            from 'path'
import { execFileSync }                             from 'child_process'

const ROOT         = resolve(import.meta.dirname, '..')
const EXAMPLES_DIR = join(ROOT, 'examples')
const LIB_DIST     = join(ROOT, 'packages', 'shapeguard', 'dist')

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', white: '\x1b[97m',
}
const col = (c, s) => `${C[c] ?? ''}${s}${C.reset}`
const sep = () => console.log(col('dim', '─'.repeat(70)))

// ── Auto-build lib if dist/ is missing ────────────────────────────────────────
// Examples resolve 'shapeguard' via workspace symlink → packages/shapeguard.
// If dist/ doesn't exist (fresh clone), tsc + vitest will fail to find types/entries.
// We auto-build so the checker is self-contained.
if (!existsSync(LIB_DIST)) {
  console.log(col('yellow', `  ⚠️  dist/ not found — building library first...`))
  try {
    execFileSync('npm', ['run', 'build', '--workspace=packages/shapeguard'], {
      cwd: ROOT, stdio: 'inherit', shell: true,
    })
    console.log(col('green', `  ✅ Library built successfully\n`))
  } catch {
    console.log(col('red', `  ❌ Library build failed — fix packages/shapeguard first\n`))
    process.exit(1)
  }
}

// ── Parse flags ───────────────────────────────────────────────────────────────
const args    = process.argv.slice(2)
const onlyTag = args[args.indexOf('--only') + 1] ?? null
const skipTag = args[args.indexOf('--skip') + 1] ?? null

// ── Discover examples ─────────────────────────────────────────────────────────
const allExamples = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && /^\d{2}-/.test(e.name))
  .map(e => ({ dir: join(EXAMPLES_DIR, e.name), name: e.name }))
  .filter(e => {
    if (onlyTag && !e.name.includes(onlyTag)) return false
    if (skipTag &&  e.name.includes(skipTag)) return false
    return true
  })

// ── Banner ────────────────────────────────────────────────────────────────────
sep()
console.log(col('cyan', col('bold', `  🔍 shapeguard — Example Checker (${allExamples.length} examples)`)))
if (onlyTag) console.log(col('yellow', `     Filter: --only "${onlyTag}"`))
if (skipTag) console.log(col('yellow', `     Filter: --skip "${skipTag}"`))
sep()

// ── Run checks ────────────────────────────────────────────────────────────────
const results = []
const start   = Date.now()

for (const { dir, name } of allExamples) {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) {
    console.log(col('yellow', `  ⚠️  ${name} — no package.json, skipping`))
    results.push({ name, status: 'SKIP', reason: 'no package.json', ms: 0 })
    continue
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  if (!pkg.scripts?.check) {
    console.log(col('yellow', `  ⚠️  ${name} — no "check" script, skipping`))
    results.push({ name, status: 'SKIP', reason: 'no check script', ms: 0 })
    continue
  }

  process.stdout.write(`  ${col('dim', '⏳')} ${name.padEnd(30)} ${col('dim', pkg.scripts.check)} ... `)

  const t0     = Date.now()
  const result = spawnSync('npm', ['run', 'check'], {
    cwd: dir, shell: true, encoding: 'utf-8',
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  const ms     = Date.now() - t0
  const passed = result.status === 0

  if (passed) {
    console.log(`${col('green', '✅ passed')} ${col('dim', `(${ms}ms)`)}`)
    results.push({ name, status: 'PASS', ms })
  } else {
    console.log(`${col('red', '❌ FAILED')} ${col('dim', `(${ms}ms)`)}`)
    const errOut = (result.stderr || result.stdout || '').trim().split('\n')
      .filter(l => l.includes('error') || l.includes('Error') || l.includes('FAIL'))
      .slice(0, 8)
    for (const line of errOut) {
      console.log(`     ${col('dim', line)}`)
    }
    results.push({ name, status: 'FAIL', ms })
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
const elapsed = ((Date.now() - start) / 1000).toFixed(1)
const passed  = results.filter(r => r.status === 'PASS')
const failed  = results.filter(r => r.status === 'FAIL')
const skipped = results.filter(r => r.status === 'SKIP')

sep()
console.log(col('cyan', col('bold', '  📋 RESULTS')))
sep()
for (const r of results) {
  const icon = r.status === 'PASS' ? col('green', '✅ PASS')
             : r.status === 'FAIL' ? col('red',   '❌ FAIL')
             :                       col('yellow', '⏭  SKIP')
  const timing = r.ms ? col('dim', `${r.ms}ms`) : ''
  const reason = r.reason ? col('dim', `(${r.reason})`) : ''
  console.log(`  ${icon}  ${r.name.padEnd(34)} ${timing} ${reason}`)
}
sep()
console.log(
  `  ${col('green',  `${passed.length} passed`)}  ` +
  `${col('red',    `${failed.length} failed`)}  ` +
  `${col('yellow', `${skipped.length} skipped`)}  ` +
  `${col('dim',    `— ${elapsed}s total`)}`
)
sep()

if (failed.length > 0) {
  console.log(col('red', `\n  ❌ ${failed.length} example(s) failed. Fix the errors above.\n`))
  process.exit(1)
} else {
  console.log(col('green', `\n  ✅ All examples passed!\n`))
}
