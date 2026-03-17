# release.ps1 - shapeguard release script
# Place in the project root (next to package.json)
#
# Usage:
#   .\release.ps1              -- dry run: typecheck + tests + build only
#   .\release.ps1 -Publish     -- full release: dry run + git tag + npm publish
#
# Version is read automatically from package.json -- no manual editing needed.

param(
    [switch]$Publish
)

# ── Helpers ───────────────────────────────────────────────────
function Pass($msg)  { Write-Host "  [OK] $msg"   -ForegroundColor Green }
function Fail($msg)  { Write-Host "  [FAIL] $msg" -ForegroundColor Red; exit 1 }
function Step($msg)  { Write-Host ""; Write-Host ">> $msg" -ForegroundColor Cyan }
function Warn($msg)  { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Info($msg)  { Write-Host "  $msg" }

# ── Read version from package.json automatically ───────────────
if (-not (Test-Path "package.json")) {
    Fail "package.json not found. Run this script from the project root."
}

$VERSION = node -p "require('./package.json').version"
$PACKAGE = node -p "require('./package.json').name"
$TAG     = "v$VERSION"

Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor White
Write-Host " $PACKAGE  --  releasing $TAG" -ForegroundColor White
Write-Host "----------------------------------------" -ForegroundColor White

if (-not $Publish) {
    Warn "Dry run -- checks only. Run .\release.ps1 -Publish to tag and publish."
}

# ── Step 1: clean working directory ───────────────────────────
Step "1/6  Git status"
$gitStatus = git status --porcelain
if ($gitStatus) {
    Fail "Uncommitted changes found. Commit or stash everything before releasing."
}
Pass "Working directory clean"

# ── Step 2: typecheck ──────────────────────────────────────────
Step "2/6  TypeScript typecheck"
npm run typecheck
if ($LASTEXITCODE -ne 0) { Fail "TypeScript errors found. Fix before releasing." }
Pass "No type errors"

# ── Step 3: tests ──────────────────────────────────────────────
Step "3/6  Test suite"
npm test
if ($LASTEXITCODE -ne 0) { Fail "Tests failed. Fix before releasing." }
Pass "All tests passed"

# ── Step 4: build + dist sanity check ─────────────────────────
Step "4/6  Build"
npm run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed." }

$required = @("dist/index.cjs", "dist/index.mjs", "dist/index.d.ts")
foreach ($f in $required) {
    if (-not (Test-Path $f)) {
        Fail "dist/ is missing expected file: $f"
    }
}
Pass "Build clean -- ESM + CJS + types present"

# ── Dry run stops here ─────────────────────────────────────────
if (-not $Publish) {
    Write-Host ""
    Write-Host "Dry run complete -- all checks passed for $TAG." -ForegroundColor Yellow
    Write-Host "Run .\release.ps1 -Publish to create the git tag and publish to npm."
    Write-Host ""
    exit 0
}

# ── Step 5: git tag + push ────────────────────────────────────
Step "5/6  Git tag $TAG"

# Check tag does not already exist
git rev-parse $TAG 2>$null
if ($LASTEXITCODE -eq 0) {
    Fail "Tag $TAG already exists. Bump the version in package.json first."
}

git tag -a $TAG -m "Release $TAG"
if ($LASTEXITCODE -ne 0) { Fail "git tag failed." }

git push origin $TAG
if ($LASTEXITCODE -ne 0) { Fail "git push tag failed." }

git push
if ($LASTEXITCODE -ne 0) { Fail "git push failed." }

Pass "Tagged $TAG and pushed to GitHub"

# ── Step 6: npm publish ───────────────────────────────────────
Step "6/6  npm publish $PACKAGE@$VERSION"
npm publish --access public
if ($LASTEXITCODE -ne 0) { Fail "npm publish failed." }
Pass "Published $PACKAGE@$VERSION to npm"

Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor Green
Write-Host " $PACKAGE@$VERSION released successfully" -ForegroundColor Green
Write-Host "----------------------------------------" -ForegroundColor Green
Write-Host ""