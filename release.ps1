# release.ps1 - shapeguard release script
# Place in the project root (next to package.json)
#
# Usage:
#   .\release.ps1              -- dry run (typecheck + tests + build only)
#   .\release.ps1 -Publish     -- full release
#
# Correct order: commit -> pull (merge, local wins) -> typecheck -> tests -> build
#                -> push main -> create tag -> push tag -> npm publish
#
# Key design decisions:
#   - push main branch FIRST, then tag (tag points to what's on main)
#   - git pull uses merge not rebase (ours/theirs semantics correct in merge mode)
#   - package.json snapshot/restore prevents merge from corrupting it
#   - package.json validated as JSON before any npm command runs
#   - tag already exists -> warn + skip (not fail)
#   - npm already published -> warn + skip (not fail)

param(
    [switch]$Publish
)

function Pass($msg)  { Write-Host "  [OK] $msg"   -ForegroundColor Green }
function Fail($msg)  { Write-Host "  [FAIL] $msg" -ForegroundColor Red; exit 1 }
function Step($msg)  { Write-Host ""; Write-Host ">> $msg" -ForegroundColor Cyan }
function Warn($msg)  { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

# ── Read version from package.json ────────────────────────────
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

# ── Step 1: commit all local changes ──────────────────────────
Step "1/9  git add + commit local changes"
$gitStatus = git status --porcelain
if ($gitStatus) {
    git add .
    git commit -m "chore: pre-release commit for $TAG"
    if ($LASTEXITCODE -ne 0) { Fail "git commit failed." }
    Pass "Local changes committed"
} else {
    Pass "Nothing to commit"
}

# ── Step 2: snapshot package.json before pull ─────────────────
$ourPackageJson = Get-Content "package.json" -Raw

# ── Step 3: pull remote (merge, local always wins) ────────────
Step "2/9  git pull (merge, local wins on conflict)"
git pull --no-rebase -X ours
if ($LASTEXITCODE -ne 0) {
    Warn "Merge conflicts -- accepting all local changes."
    git checkout --ours .
    git add .
    git merge --continue --no-edit 2>$null
}
Pass "Pull complete"

# ── Step 4: always restore our package.json ───────────────────
# Merge can overwrite it with a remote version even with -X ours
$afterPull = Get-Content "package.json" -Raw
if ($afterPull -ne $ourPackageJson) {
    Warn "package.json changed during merge -- restoring our version."
    Set-Content "package.json" $ourPackageJson -NoNewline
    git add package.json
    git commit -m "chore: restore package.json after merge for $TAG" 2>$null
}
Pass "package.json is our version"

# ── Step 5: validate package.json ─────────────────────────────
Step "3/9  Validate package.json"
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" 2>$null
if ($LASTEXITCODE -ne 0) { Fail "package.json is invalid JSON. Fix before releasing." }
Pass "package.json valid"

# ── Step 6: typecheck ─────────────────────────────────────────
Step "4/9  TypeScript typecheck"
npm run typecheck
if ($LASTEXITCODE -ne 0) { Fail "TypeScript errors. Fix before releasing." }
Pass "No type errors"

# ── Step 7: tests ─────────────────────────────────────────────
Step "5/9  Test suite"
npm test
if ($LASTEXITCODE -ne 0) { Fail "Tests failed. Fix before releasing." }
Pass "All tests passed"

# ── Step 8: build ─────────────────────────────────────────────
Step "6/9  Build"
npm run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed." }
foreach ($f in @("dist/index.cjs", "dist/index.mjs", "dist/index.d.ts")) {
    if (-not (Test-Path $f)) { Fail "dist/ missing: $f" }
}
Pass "Build clean -- ESM + CJS + types present"

# ── Dry run stops here ─────────────────────────────────────────
if (-not $Publish) {
    Write-Host ""
    Write-Host "Dry run complete -- all checks passed for $TAG." -ForegroundColor Yellow
    Write-Host "Run .\release.ps1 -Publish to push to GitHub and publish to npm."
    Write-Host ""
    exit 0
}

# ── Step 9: push main branch FIRST ────────────────────────────
# IMPORTANT: push the branch before creating the tag.
# The tag must point to what is actually on main.
Step "7/9  Push main branch to GitHub"
git push --force-with-lease
if ($LASTEXITCODE -ne 0) {
    git push
    if ($LASTEXITCODE -ne 0) { Fail "git push main failed." }
}
Pass "main branch pushed to GitHub"

# ── Step 10: create and push tag ──────────────────────────────
Step "8/9  Git tag $TAG"
git rev-parse $TAG 2>$null
if ($LASTEXITCODE -eq 0) {
    Warn "Tag $TAG already exists -- skipping tag creation."
} else {
    git tag -a $TAG -m "Release $TAG"
    git push origin $TAG
    if ($LASTEXITCODE -ne 0) { Fail "git push tag failed." }
    Pass "Tagged $TAG and pushed"
}

# ── Step 11: npm publish ───────────────────────────────────────
Step "9/9  npm publish $PACKAGE@$VERSION"
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