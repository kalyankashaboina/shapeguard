# release.ps1 - shapeguard release script
# Place in the project root (next to package.json)
#
# Usage:
#   .\release.ps1              -- dry run only (typecheck + tests + build)
#   .\release.ps1 -Publish     -- full release (dry run + git tag + npm publish)
#
# Flow:
#   1. git add . + git commit
#   2. git pull --no-rebase (merge strategy, NOT rebase)
#   3. On any conflict -> accept ours (local always wins)
#   4. Restore package.json to local version (always)
#   5. typecheck -> tests -> build
#   6. (Publish only) git tag + push + npm publish

param(
    [switch]$Publish
)

function Pass($msg)  { Write-Host "  [OK] $msg"   -ForegroundColor Green }
function Fail($msg)  { Write-Host "  [FAIL] $msg" -ForegroundColor Red; exit 1 }
function Step($msg)  { Write-Host ""; Write-Host ">> $msg" -ForegroundColor Cyan }
function Warn($msg)  { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

# ── Read version ───────────────────────────────
if (-not (Test-Path "package.json")) {
    Fail "package.json not found. Run this script from the project root."
}
$VERSION = node -p "require('./package.json').version"
$PACKAGE = node -p "require('./package.json').name"
$TAG     = "v$VERSION"

Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor White
Write-Host " $PACKAGE  --  releasing $TAG"            -ForegroundColor White
Write-Host "----------------------------------------" -ForegroundColor White
if (-not $Publish) {
    Warn "Dry run -- checks only. Run .\release.ps1 -Publish to tag and publish."
}

# ── Step 1: git add + commit ──────────────────
Step "1/8  git add + commit local changes"
$gitStatus = git status --porcelain
if ($gitStatus) {
    git add .
    git commit -m "chore: pre-release commit for $TAG"
    if ($LASTEXITCODE -ne 0) { Fail "git commit failed." }
    Pass "Local changes committed"
} else {
    Pass "Nothing to commit"
}

# ── Step 2: snapshot package.json ─────────────
# Save our version BEFORE pull so we can always restore it
$ourPackageJson = Get-Content "package.json" -Raw

# ── Step 3: git pull --no-rebase (merge) ──────
Step "2/8  git pull (merge, local always wins on conflict)"
git pull --no-rebase -X ours
if ($LASTEXITCODE -ne 0) {
    Warn "Merge had conflicts -- accepting all local changes."
    git checkout --ours .
    git add .
    git merge --continue --no-edit 2>$null
}
Pass "Pull complete"

# ── Step 4: always restore our package.json ───
# git merge can overwrite it with the remote version even with -X ours
# so we always put ours back, no matter what
$afterPull = Get-Content "package.json" -Raw
if ($afterPull -ne $ourPackageJson) {
    Warn "package.json changed during pull -- restoring our version."
    Set-Content "package.json" $ourPackageJson -NoNewline
    git add package.json
    git commit -m "chore: restore package.json after merge for $TAG" 2>$null
}
Pass "package.json is our version"

# ── Step 5: validate package.json ─────────────
Step "3/8  Validate package.json"
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" 2>$null
if ($LASTEXITCODE -ne 0) {
    Fail "package.json is invalid JSON. Cannot continue."
}
Pass "package.json valid"

# ── Step 6: typecheck ─────────────────────────
Step "4/8  TypeScript typecheck"
npm run typecheck
if ($LASTEXITCODE -ne 0) { Fail "TypeScript errors. Fix before releasing." }
Pass "No type errors"

# ── Step 7: tests ─────────────────────────────
Step "5/8  Test suite"
npm test
if ($LASTEXITCODE -ne 0) { Fail "Tests failed. Fix before releasing." }
Pass "All tests passed"

# ── Step 8: build ─────────────────────────────
Step "6/8  Build"
npm run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed." }
foreach ($f in @("dist/index.cjs", "dist/index.mjs", "dist/index.d.ts")) {
    if (-not (Test-Path $f)) { Fail "dist/ missing: $f" }
}
Pass "Build clean -- ESM + CJS + types present"

# ── Dry run stops here ─────────────────────────
if (-not $Publish) {
    Write-Host ""
    Write-Host "Dry run complete -- all checks passed for $TAG." -ForegroundColor Yellow
    Write-Host "Run .\release.ps1 -Publish to tag and publish."
    Write-Host ""
    exit 0
}

# ── Step 9: git tag + push ─────────────────────
Step "7/8  Git tag $TAG + push"
git rev-parse $TAG 2>$null
if ($LASTEXITCODE -eq 0) {
    Warn "Tag $TAG already exists -- skipping tag creation."
} else {
    git tag -a $TAG -m "Release $TAG"
    git push origin $TAG
    if ($LASTEXITCODE -ne 0) { Fail "git push tag failed." }
    Pass "Tagged $TAG and pushed"
}
git push --force-with-lease
if ($LASTEXITCODE -ne 0) {
    git push
    if ($LASTEXITCODE -ne 0) { Fail "git push branch failed." }
}
Pass "Branch pushed to GitHub"

# ── Step 10: npm publish ───────────────────────
Step "8/8  npm publish $PACKAGE@$VERSION"
$published = npm view "$PACKAGE@$VERSION" version 2>$null
if ($published -eq $VERSION) {
    Warn "$PACKAGE@$VERSION already on npm -- skipping."
} else {
    npm publish --access public
    if ($LASTEXITCODE -ne 0) { Fail "npm publish failed." }
    Pass "Published $PACKAGE@$VERSION to npm"
}

Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor Green
Write-Host " $PACKAGE@$VERSION released successfully" -ForegroundColor Green
Write-Host "----------------------------------------" -ForegroundColor Green
Write-Host ""