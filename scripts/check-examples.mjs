#!/usr/bin/env node
// scripts/check-examples.mjs
//
// Runs a full quality check across every example package — from the monorepo root.
// No need to cd into each folder. Results are summarised in a single table.
//
// Usage:
//   node scripts/check-examples.mjs              — check all
//   node scripts/check-examples.mjs --only 06    — check only example 06
//   node scripts/check-examples.mjs --skip 08    — skip example 08
//
// Each example must declare a "check" script in its package.json.
//   - For server examples: "check": "tsc --noEmit"
//   - For test examples:   "check": "vitest run"

import { spawnSync }     from 'child_process'
import { readdirSync, existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

// ── Config ────────────────────────────────────────────────────────────────────
const ROOT         = resolve(import.meta.dirname, '..')
const EXAMPLES_DIR = join(ROOT, 'examples')
const C = {
  reset:   '\x1b[0m',  green:   '\x1b[32m',
  red:     '\x1b[31m', yellow:  '\x1b[33m',
  cyan:    '\x1b[36m', gray:    '\x1b[90m',
  white:   '\x1b[97m', magenta: '\x1b[35m',
  bold:    '\x1b[1m',
}
const col   = (c, s) => `${C[c] ?? ''}${s}${C.reset}`
const sep   = () => console.log(col('gray', '─'.repeat(68)))
const start = Date.now()

// ── Parse flags ───────────────────────────────────────────────────────────────
const args   = process.argv.slice(2)
const onlyIdx  = args.indexOf('--only')
const skipIdx  = args.indexOf('--skip')
const onlyTag  = onlyIdx  >= 0 ? args[onlyIdx  + 1] : null
const skipTag  = skipIdx  >= 0 ? args[skipIdx  + 1] : null

// ── Discover examples ─────────────────────────────────────────────────────────
const allExamples = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && /^\d{2}-/.test(e.name))
  .map(e => ({
    dir:  join(EXAMPLES_DIR, e.name),
    name: e.name,
  }))
  .filter(e => {
    if (onlyTag && !e.name.includes(onlyTag)) return false
    if (skipTag &&  e.name.includes(skipTag)) return false
    return true
  })

// ── Banner ────────────────────────────────────────────────────────────────────
sep()
console.log(col('cyan', col('bold', `  🔍 shapeguard — Example Checker (${allExamples.length} examples)`)))
console.log(col('gray', `     Root: ${ROOT}`))
if (onlyTag) console.log(col('yellow', `     Filter: --only "${onlyTag}"`))
if (skipTag) console.log(col('yellow', `     Filter: --skip "${skipTag}"`))
sep()

// ── Results table ─────────────────────────────────────────────────────────────
const results = []

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

  process.stdout.write(col('cyan', `  ⏳ ${name} — ${pkg.scripts.check} ... `))
  const t0 = Date.now()

  const result = spawnSync('npm', ['run', 'check'], {
    cwd:      dir,
    shell:    true,
    encoding: 'utf-8',
    env:      { ...process.env, FORCE_COLOR: '0' },
  })

  const ms     = Date.now() - t0
  const passed = result.status === 0

  if (passed) {
    console.log(col('green', `✅ passed (${ms}ms)`))
    results.push({ name, status: 'PASS', ms })
  } else {
    console.log(col('red', `❌ FAILED (${ms}ms)`))
    // Print the stderr/stdout for the failing example
    const errOut = (result.stderr || result.stdout || '').trim().split('\n').slice(0, 20)
    for (const line of errOut) {
      console.log(col('gray', `       ${line}`))
    }
    results.push({ name, status: 'FAIL', ms, output: result.stderr || result.stdout })
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
sep()
console.log(col('cyan', col('bold', '  📋 RESULTS')))
sep()

const passed  = results.filter(r => r.status === 'PASS')
const failed  = results.filter(r => r.status === 'FAIL')
const skipped = results.filter(r => r.status === 'SKIP')
const elapsed = ((Date.now() - start) / 1000).toFixed(1)

const statusCol = {
  PASS: s => col('green',  `✅ PASS`),
  FAIL: s => col('red',    `❌ FAIL`),
  SKIP: s => col('yellow', `⏭️  SKIP`),
}

for (const r of results) {
  const label  = statusCol[r.status]()
  const timing = r.ms ? col('gray', `${r.ms}ms`) : ''
  const reason = r.reason ? col('gray', `(${r.reason})`) : ''
  console.log(`  ${label}  ${r.name.padEnd(32)} ${timing} ${reason}`)
}

sep()
console.log(
  `  ${col('green',  `${passed.length} passed`)}  ` +
  `${col('red',    `${failed.length} failed`)}  ` +
  `${col('yellow', `${skipped.length} skipped`)}  ` +
  `${col('gray',   `— ${elapsed}s total`)}`
)
sep()

if (failed.length > 0) {
  console.log(col('red', `\n  ❌ ${failed.length} example(s) failed. Fix the errors above.\n`))
  process.exit(1)
} else {
  console.log(col('green', `\n  ✅ All examples passed!\n`))
}
