// scripts/size.mjs — bundle size report
// Cross-platform: works on Windows, Mac, Linux — no shell tools needed.
// Used by: npm run size, CI bundle size check, benchmark workflow.

import { readdirSync, statSync } from 'fs'
import { join } from 'path'

const BUDGET_KB = 50   // main ESM bundle must stay under this

function getFiles(dir, base = dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap(e => {
    const full = join(dir, e.name)
    return e.isDirectory() ? getFiles(full, base) : [full]
  })
}

function fmt(bytes) {
  if (bytes >= 1024) return (bytes / 1024).toFixed(2).padStart(8) + ' KB'
  return bytes.toString().padStart(8) + '  B'
}

const files = getFiles('dist')
  .map(f => ({ path: f.replace(/\\/g, '/'), size: statSync(f).size }))
  .sort((a, b) => a.size - b.size)

let total = 0
for (const { path, size } of files) {
  console.log(`${fmt(size)}  ${path}`)
  total += size
}

console.log('')
console.log(`${fmt(total)}  TOTAL (${files.length} files)`)

// Budget check
const mainEsm = files.find(f => f.path === 'dist/index.mjs')
if (mainEsm) {
  const kb = mainEsm.size / 1024
  const status = kb < BUDGET_KB ? '✅' : '❌'
  console.log(`\n${status} Main bundle: ${kb.toFixed(2)} KB / ${BUDGET_KB} KB budget`)
  if (kb >= BUDGET_KB) {
    console.error(`Bundle size regression! ${kb.toFixed(2)} KB exceeds ${BUDGET_KB} KB limit.`)
    process.exit(1)
  }
}
