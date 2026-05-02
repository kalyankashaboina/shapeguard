#!/usr/bin/env node
// validate-release.mjs
// Cross-platform (Windows / Linux / macOS) full dry-run validation for NPM LIBRARIES.
//
// Checks:
//   package.json → required fields → node/npm → node_modules
//   → typecheck → lint → tests → build
//   → dist files → dual CJS+ESM → types → exports map
//   → sourcemaps → bundle size → benchmark (npm run size)
//
// No commit. No tag. No publish.
//
// Usage:
//   node validate-release.mjs
//   npm run validate          ← add "validate": "node validate-release.mjs" to package.json

import { spawnSync }                                       from "child_process";
import { existsSync, statSync, readdirSync, readFileSync } from "fs";
import { join, relative }                                  from "path";
import { platform }                                        from "os";

// ─── EMOJI ───────────────────────────────────────────────────────────────────
const E = {
  ok:     "✅",
  err:    "❌",
  warn:   "⚠️ ",
  info:   "🔍",
  rocket: "🚀",
  clip:   "📋",
  next:   "👉",
  lock:   "🔒",
  wrench: "🔧",
  size:   "📏",
  speed:  "⚡",
  skip:   "⏭️ ",
  lib:    "📦",
  type:   "📝",
  map:    "🗺️ ",
};

// ─── ANSI COLORS (Windows 10+ / Linux / macOS) ───────────────────────────────
const C = {
  reset:   "\x1b[0m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  cyan:    "\x1b[36m",
  magenta: "\x1b[35m",
  gray:    "\x1b[90m",
  white:   "\x1b[97m",
  blue:    "\x1b[34m",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const col  = (c, msg) => `${C[c] ?? ""}${msg}${C.reset}`;
const sep  = ()       => console.log(col("gray", "─".repeat(62)));
const log  = (msg, c = "white") => console.log(col(c, msg));
const ok   = (msg)  => console.log(col("green",   `  ${E.ok}  ${msg}`));
const warn = (msg)  => console.log(col("yellow",  `  ${E.warn} ${msg}`));
const info = (msg)  => console.log(col("cyan",    `  ${E.info} ${msg}`));
const skip = (msg)  => console.log(col("gray",    `  ${E.skip} SKIPPED — ${msg}`));
const note = (msg)  => console.log(col("blue",    `  ${E.lib}  ${msg}`));

function step(n, total, msg) {
  sep();
  console.log(col("cyan", `  ${E.wrench} STEP ${n}/${total}  ──  ${msg}`));
}

function fail(msg) {
  sep();
  console.log(col("red",    `  ${E.err}  FAILED: ${msg}`));
  console.log(col("yellow", `\n  Fix the issue above and re-run:  npm run validate\n`));
  sep();
  process.exit(1);
}

/** Silent run — returns { ok, stdout, stderr } */
function run(cmd) {
  const r = spawnSync(cmd, {
    shell: true, encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "1", GIT_PAGER: "cat" },
  });
  return { ok: r.status === 0, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

/** Live run — streams output to terminal, returns boolean */
function runLive(cmd) {
  const r = spawnSync(cmd, {
    shell: true, stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1", GIT_PAGER: "cat" },
  });
  return r.status === 0;
}

/** Recursively list all files under dir */
function allFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    e.isDirectory() ? allFiles(full, acc) : acc.push(full);
  }
  return acc;
}

/** Check if any test files exist */
function detectTestFiles() {
  const pat  = /\.(test|spec)\.(js|ts|mjs|cjs|jsx|tsx)$/;
  const dirs = ["src", "test", "tests", "__tests__", "."];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    try {
      const found = allFiles(d).filter(f => !f.includes("node_modules") && pat.test(f));
      if (found.length) return { found: true, count: found.length, sample: found[0] };
    } catch { /**/ }
  }
  return { found: false };
}

/** Check if script exists in package.json */
const hasScript = (pkg, name) => !!(pkg.scripts?.[name]);

/** Bytes → KB string */
const toKB = (b) => (b / 1024).toFixed(2);

// ─── RESULTS MAP ─────────────────────────────────────────────────────────────
const results   = new Map();
const startTime = Date.now();

// ─── BANNER ──────────────────────────────────────────────────────────────────
sep();
log(`  ${E.rocket} VALIDATE-RELEASE  ──  LIBRARY DRY RUN`, "cyan");
log(`     platform: ${platform()}`, "gray");
log(`     package.json → typecheck → lint → tests → build`, "gray");
log(`     → dist → CJS+ESM → types → exports → sourcemaps → size`, "gray");
log(`     No commit. No tag. No publish.`, "gray");
sep();

// ─── READ package.json ───────────────────────────────────────────────────────
let pkg, VERSION, PACKAGE, TAG, AUTHOR, REPO, NODE_REQ;

try {
  if (!existsSync("package.json")) fail("package.json not found — run from project root.");

  pkg      = JSON.parse(readFileSync("package.json", "utf8"));
  VERSION  = pkg.version;
  PACKAGE  = pkg.name;
  TAG      = `v${VERSION}`;
  AUTHOR   = typeof pkg.author === "object" ? pkg.author.name : (pkg.author || "—");
  REPO     = pkg.repository?.url ?? (typeof pkg.repository === "string" ? pkg.repository : "—");
  NODE_REQ = pkg.engines?.node ?? "not specified";

  info("Reading package.json...");
  ok(`Package      : ${PACKAGE}`);
  ok(`Version      : ${VERSION}  (tag: ${TAG})`);
  ok(`Author       : ${AUTHOR}`);
  ok(`Node engine  : ${NODE_REQ}`);
  ok(`Repo         : ${REPO}`);

  // Scripts
  sep();
  log(`  ${E.clip} SCRIPTS`, "cyan");
  for (const [k, v] of Object.entries(pkg.scripts || {}))
    console.log(col("gray", `     ${k.padEnd(22)}: ${v}`));

  // Peer deps
  if (Object.keys(pkg.peerDependencies || {}).length) {
    sep();
    log(`  ${E.clip} PEER DEPENDENCIES`, "cyan");
    for (const [k, v] of Object.entries(pkg.peerDependencies))
      console.log(`     ${k.padEnd(22)}: ${v}`);
  }

  // Optional deps
  if (Object.keys(pkg.optionalDependencies || {}).length) {
    log(`  ${E.clip} OPTIONAL DEPENDENCIES`, "cyan");
    for (const [k, v] of Object.entries(pkg.optionalDependencies))
      console.log(col("gray", `     ${k.padEnd(22)}: ${v}`));
  }

  // Exports map preview
  if (pkg.exports) {
    sep();
    log(`  ${E.clip} EXPORTS MAP`, "cyan");
    for (const key of Object.keys(pkg.exports))
      console.log(col("cyan", `     ${key}`));
  }

  results.set("package.json", "PASS");
} catch (e) {
  fail(`Could not read package.json — ${e.message}`);
}

// ─── NODE + NPM ──────────────────────────────────────────────────────────────
sep();
{
  info("Checking Node.js and npm...");
  const nR = run("node --version");
  const mR = run("npm --version");
  if (!nR.ok || !mR.ok) fail("node or npm not found in PATH");
  ok(`Node : ${nR.stdout}`);
  ok(`npm  : ${mR.stdout}`);
  const nodeMajor = parseInt(nR.stdout.replace(/^v(\d+).*/, "$1"), 10);
  const reqMajor  = parseInt(NODE_REQ.replace(/[^\d]*(\d+).*/, "$1"), 10);
  if (!isNaN(reqMajor)) {
    nodeMajor < reqMajor
      ? warn(`Node ${nR.stdout} may not satisfy engine requirement: ${NODE_REQ}`)
      : ok(`Node version satisfies engine requirement (${NODE_REQ})`);
  }
  results.set("node/npm", "PASS");
}

// ─── node_modules ────────────────────────────────────────────────────────────
sep();
{
  info("Checking node_modules...");
  if (!existsSync("node_modules")) {
    warn("node_modules not found — running npm install...");
    if (!runLive("npm install")) fail("npm install failed");
    ok("npm install completed");
    results.set("node_modules", "INSTALLED");
  } else {
    const lockTime = existsSync("package-lock.json") ? statSync("package-lock.json").mtimeMs : 0;
    const nmTime   = statSync("node_modules").mtimeMs;
    if (lockTime > nmTime) {
      warn("package-lock.json newer than node_modules — running npm install...");
      if (!runLive("npm install")) fail("npm install failed");
      ok("npm install completed (refreshed)");
      results.set("node_modules", "REFRESHED");
    } else {
      ok("node_modules present and up to date");
      results.set("node_modules", "PASS");
    }
  }
}

const TOTAL = 9;

// ─── STEP 1 — package.json required fields (library-specific) ────────────────
step(1, TOTAL, "package.json required fields (library)");
{
  const required = ["name", "version", "description", "license", "author"];
  let anyWarn = false;

  for (const f of required) {
    if (pkg[f]) ok(`${f.padEnd(14)}: ${pkg[f]}`);
    else        { warn(`Missing recommended field: "${f}"`); anyWarn = true; }
  }

  // "files" — controls npm tarball contents
  if (pkg.files?.length) ok(`files         : [ ${pkg.files.join(", ")} ]`);
  else { warn('"files" not set — full project will publish; add "files": ["dist"] to restrict'); anyWarn = true; }

  // Entry points
  if (pkg.main)             ok(`main          : ${pkg.main}`);
  else                      { warn('"main" missing — CJS consumers may not resolve your package'); anyWarn = true; }

  if (pkg.module)           ok(`module        : ${pkg.module}`);
  else                      warn('"module" missing — bundlers use this for ESM tree-shaking (non-fatal)');

  if (pkg.types || pkg.typings) ok(`types         : ${pkg.types || pkg.typings}`);
  else                      { warn('"types"/"typings" missing — TypeScript consumers get no declarations'); anyWarn = true; }

  // exports map
  if (pkg.exports)          ok(`exports map   : present (${Object.keys(pkg.exports).length} entries)`);
  else                      warn('"exports" map missing — modern Node.js and bundlers prefer it over "main"');

  // sideEffects — tree-shaking hint
  if (pkg.sideEffects !== undefined) ok(`sideEffects   : ${JSON.stringify(pkg.sideEffects)}`);
  else note('"sideEffects" not set — set to false if side-effect free for better tree-shaking by consumers');

  results.set("1. pkg fields", anyWarn ? "WARN" : "PASS");
}

// ─── STEP 2 — TypeScript typecheck ───────────────────────────────────────────
step(2, TOTAL, "TypeScript typecheck");
if (hasScript(pkg, "typecheck")) {
  info("Running npm run typecheck...");
  if (!runLive("npm run typecheck")) { results.set("2. TypeScript", "FAIL"); fail("TypeScript typecheck failed"); }
  ok("No type errors");
  results.set("2. TypeScript", "PASS");
} else if (existsSync("tsconfig.json")) {
  info("No 'typecheck' script — trying npx tsc --noEmit...");
  if (!runLive("npx tsc --noEmit")) { results.set("2. TypeScript", "FAIL"); fail("TypeScript typecheck failed"); }
  ok("No type errors (via tsc --noEmit)");
  results.set("2. TypeScript", "PASS");
} else {
  skip("no typecheck script and no tsconfig.json found");
  results.set("2. TypeScript", "SKIP");
}

// ─── STEP 3 — Lint ───────────────────────────────────────────────────────────
step(3, TOTAL, "Lint");
if (hasScript(pkg, "lint")) {
  info("Running npm run lint...");
  if (!runLive("npm run lint")) { results.set("3. Lint", "FAIL"); fail("Lint failed — fix errors before releasing"); }
  ok("Lint passed");
  results.set("3. Lint", "PASS");
} else {
  skip("no 'lint' script found in package.json");
  results.set("3. Lint", "SKIP");
}

// ─── STEP 4 — Tests ──────────────────────────────────────────────────────────
step(4, TOTAL, "Test suite");
const testDet = detectTestFiles();
if (!hasScript(pkg, "test") && !hasScript(pkg, "test:run")) {
  skip("no test script found in package.json");
  results.set("4. Tests", "SKIP");
} else if (!testDet.found) {
  skip("no *.test.* / *.spec.* files found — skipping test run");
  results.set("4. Tests", "SKIP");
} else {
  info(`Found ${testDet.count} test file(s) — e.g. ${relative(process.cwd(), testDet.sample)}`);
  info("Running tests...");
  // prefer test:run (vitest non-watch mode) to avoid hanging
  const testCmd = hasScript(pkg, "test:run") ? "npm run test:run" : "npm test";
  if (!runLive(testCmd)) { results.set("4. Tests", "FAIL"); fail("One or more tests failed"); }
  ok("All tests passed");
  results.set("4. Tests", "PASS");
}

// ─── STEP 5 — Build ──────────────────────────────────────────────────────────
step(5, TOTAL, "Build");
if (hasScript(pkg, "build")) {
  info("Running npm run build...");
  if (!runLive("npm run build")) { results.set("5. Build", "FAIL"); fail("Build failed"); }
  ok("Build complete");
  results.set("5. Build", "PASS");
} else {
  skip("no 'build' script found in package.json");
  results.set("5. Build", "SKIP");
}

// ─── STEP 6 — Dist files: CJS + ESM + types ─────────────────────────────────
step(6, TOTAL, "Dist output — CJS + ESM + types");
if (!existsSync("dist")) {
  skip("no dist/ directory — was build skipped or output elsewhere?");
  results.set("6. Dist files", "SKIP");
} else {
  let distWarn = false;

  // CJS entry
  const cjsFile = pkg.main ? (pkg.main.startsWith("./") ? pkg.main.slice(2) : pkg.main) : "dist/index.cjs";
  if (existsSync(cjsFile))  ok(`CJS entry     : ${cjsFile}  (${toKB(statSync(cjsFile).size)} KB)`);
  else                      { warn(`CJS entry not found: ${cjsFile}`); distWarn = true; }

  // ESM entry
  const esmFile = pkg.module ? (pkg.module.startsWith("./") ? pkg.module.slice(2) : pkg.module) : "dist/index.mjs";
  if (existsSync(esmFile))  ok(`ESM entry     : ${esmFile}  (${toKB(statSync(esmFile).size)} KB)`);
  else                      { warn(`ESM entry not found: ${esmFile} — bundlers cannot tree-shake without ESM output`); distWarn = true; }

  // Types entry
  const typesFile = (pkg.types || pkg.typings || "dist/index.d.ts").replace(/^\.\//, "");
  if (existsSync(typesFile)) ok(`Types entry   : ${typesFile}  (${toKB(statSync(typesFile).size)} KB)`);
  else                       { warn(`Types entry not found: ${typesFile} — TypeScript consumers get no autocomplete`); distWarn = true; }

  // Declaration map — optional but nice for go-to-source
  const dtsMapFile = typesFile.replace(/\.d\.ts$/, ".d.ts.map");
  if (existsSync(dtsMapFile)) ok(`Decl map      : ${dtsMapFile}  ✓`);
  else note(`Declaration map (${dtsMapFile}) not found — optional, improves go-to-source in IDEs`);

  if (distWarn) warn("Some dist files are missing — check your build config (tsup/rollup/esbuild)");
  results.set("6. Dist files", distWarn ? "WARN" : "PASS");
}

// ─── STEP 7 — Exports map validation ─────────────────────────────────────────
step(7, TOTAL, "Exports map — all paths resolve");
if (!pkg.exports) {
  skip("no exports map in package.json");
  results.set("7. Exports map", "SKIP");
} else {
  let exportWarn = false;

  function checkExportValue(condition, value, depth = 0) {
    if (typeof value === "string") {
      const filePath = value.replace(/^\.\//, "");
      if (existsSync(filePath)) ok(`exports["${condition}"] → ${value}  ✓`);
      else { warn(`exports["${condition}"] → ${value}  ✗  FILE NOT FOUND`); exportWarn = true; }
    } else if (typeof value === "object" && value !== null) {
      for (const [cond, nested] of Object.entries(value))
        checkExportValue(`${condition}"]["${cond}`, nested, depth + 1);
    }
  }

  for (const [condition, value] of Object.entries(pkg.exports))
    checkExportValue(condition, value);

  if (!exportWarn) ok("All export paths resolve to existing files");
  results.set("7. Exports map", exportWarn ? "WARN" : "PASS");
}

// ─── STEP 8 — Sourcemaps ─────────────────────────────────────────────────────
step(8, TOTAL, "Sourcemaps");
if (!existsSync("dist")) {
  skip("no dist/ directory");
  results.set("8. Sourcemaps", "SKIP");
} else {
  const jsFiles  = allFiles("dist").filter(f => /\.(js|cjs|mjs)$/.test(f));
  const mapFiles = allFiles("dist").filter(f => f.endsWith(".map") && !f.endsWith(".d.ts.map"));

  if (mapFiles.length === 0) {
    warn("No .js.map sourcemap files found in dist/ — sourcemaps help users debug your library");
    note("Add  sourcemap: true  to your tsup / rollup / esbuild config");
    results.set("8. Sourcemaps", "WARN");
  } else {
    let mapWarn = false;
    for (const js of jsFiles) {
      if (existsSync(js + ".map")) ok(`${relative(process.cwd(), js).padEnd(45)} .map ✓`);
      else                         { warn(`No sourcemap for ${relative(process.cwd(), js)}`); mapWarn = true; }
    }
    ok(`${mapFiles.length} sourcemap file(s) found in dist/`);
    results.set("8. Sourcemaps", mapWarn ? "WARN" : "PASS");
  }
}

// ─── STEP 9 — Bundle size + benchmark ────────────────────────────────────────
step(9, TOTAL, "Bundle size + benchmark");
if (!existsSync("dist")) {
  skip("no dist/ directory");
  results.set("9. Size", "SKIP");
} else {
  sep();
  log(`  ${E.size} BUNDLE SIZE BREAKDOWN`, "cyan");

  const distFiles = allFiles("dist").sort((a, b) => statSync(b).size - statSync(a).size);
  let totalBytes  = 0;

  for (const f of distFiles) {
    const bytes = statSync(f).size;
    totalBytes += bytes;
    const kb    = toKB(bytes);
    const rel   = relative(process.cwd(), f);
    const color = f.endsWith(".cjs")    ? "yellow"
                : f.endsWith(".mjs")    ? "cyan"
                : f.endsWith(".d.ts")   ? "white"
                : f.endsWith(".map")    ? "gray"
                : "gray";
    console.log(col(color, `     ${rel.padEnd(50)} ${String(kb).padStart(8)} KB`));
  }

  sep();
  const totalKB = parseFloat(toKB(totalBytes));
  console.log(col("magenta", `     TOTAL dist size : ${totalKB} KB`));

  if      (totalKB > 500) warn(`Bundle is large (${totalKB} KB) — consider tree-shaking or splitting`);
  else if (totalKB > 100) warn(`Bundle is moderate (${totalKB} KB) — within acceptable range`);
  else                    ok(`Bundle size is lean (${totalKB} KB)`);

  // npm run size (size-limit etc.)
  if (hasScript(pkg, "size")) {
    sep();
    info("Running npm run size (benchmark)...");
    runLive("npm run size")
      ? ok("Benchmark / size script completed")
      : warn("Size script reported issues (non-fatal)");
  } else {
    note('No "size" script — consider adding size-limit for gzip/brotli budget tracking');
  }

  results.set("9. Size", "PASS");
}

// ─── ELAPSED ─────────────────────────────────────────────────────────────────
const elapsed    = Date.now() - startTime;
const elapsedStr = `${String(Math.floor(elapsed / 60000)).padStart(2, "0")}:${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0")}`;

// ─── FINAL SUMMARY ───────────────────────────────────────────────────────────
sep();
log(`  ${E.clip} FINAL SUMMARY`, "cyan");
sep();

let allPassed = true;
for (const [key, val] of results) {
  switch (val) {
    case "PASS":
    case "INSTALLED":
    case "REFRESHED":
      console.log(col("green",  `     ${E.ok}  ${key}`)); break;
    case "FAIL":
      console.log(col("red",    `     ${E.err}  ${key}`)); allPassed = false; break;
    case "SKIP":
      console.log(col("gray",   `     ${E.skip} ${key}  (skipped)`)); break;
    case "WARN":
      console.log(col("yellow", `     ${E.warn} ${key}  (warning)`)); break;
  }
}

sep();
log(allPassed
  ? `  ${E.ok}  ALL CHECKS PASSED  ──  DRY RUN COMPLETE`
  : `  ${E.err}  SOME CHECKS FAILED  ──  FIX BEFORE RELEASING`,
  allPassed ? "green" : "red"
);
sep();

console.log("");
console.log(col("green",   `     ${E.ok}  ${PACKAGE}@${VERSION} is ready to release!`));
console.log("");
console.log(col("cyan",    `     Package     : ${PACKAGE}`));
console.log(col("magenta", `     Version     : ${VERSION}`));
console.log(col("magenta", `     Tag         : ${TAG}`));
console.log(col("cyan",    `     Author      : ${AUTHOR}`));
console.log(col("cyan",    `     Repo        : ${REPO}`));
console.log(col("gray",    `     Platform    : ${platform()}`));
console.log(col("gray",    `     Time        : ${elapsedStr}`));
console.log("");
warn(`${E.lock} Nothing was committed, tagged, or published.`);
console.log("");
sep();
log(`  ${E.next} To publish for real, run your CI/CD or:`, "white");
console.log(col("gray", "     npm publish --access public"));
sep();

if (!allPassed) process.exit(1);
