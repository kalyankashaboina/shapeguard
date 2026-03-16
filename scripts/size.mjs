// scripts/size.mjs — cross-platform replacement for du -sh dist/* | sort -h
// Works on Windows, Mac, Linux — no shell tools needed.

import { readdirSync, statSync } from 'fs'
import { join } from 'path'

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
