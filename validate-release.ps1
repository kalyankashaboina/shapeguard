# validate-release.ps1
# Full dry-run validation:
#   package.json -> node/npm -> typecheck -> tests -> build -> dist -> bundle size -> benchmark
# No commit. No tag. No publish.
#
# Usage:
#   .\validate-release.ps1

# ===== EMOJI VARS =====
$iOk     = [System.Char]::ConvertFromUtf32(0x2705)  # green tick
$iErr    = [System.Char]::ConvertFromUtf32(0x274C)  # red cross
$iWarn   = [System.Char]::ConvertFromUtf32(0x26A0)  # warning
$iInfo   = [System.Char]::ConvertFromUtf32(0x1F50D) # magnifier
$iRkt    = [System.Char]::ConvertFromUtf32(0x1F680) # rocket
$iClip   = [System.Char]::ConvertFromUtf32(0x1F4CB) # clipboard
$iNext   = [System.Char]::ConvertFromUtf32(0x1F449) # point right
$iLock   = [System.Char]::ConvertFromUtf32(0x1F512) # lock
$iWrench = [System.Char]::ConvertFromUtf32(0x1F527) # wrench
$iTest   = [System.Char]::ConvertFromUtf32(0x1F9EA) # test tube
$iBuild  = [System.Char]::ConvertFromUtf32(0x1F4E6) # package
$iType   = [System.Char]::ConvertFromUtf32(0x1F4DD) # note
$iSize   = [System.Char]::ConvertFromUtf32(0x1F4CF) # ruler
$iSpeed  = [System.Char]::ConvertFromUtf32(0x26A1)  # lightning/benchmark

# ===== HELPERS =====
function Log($msg, $color = "White") { Write-Host $msg -ForegroundColor $color }
function Sep { Write-Host ("-" * 55) -ForegroundColor DarkGray }

function Ok($msg)   { Write-Host "  $iOk $msg"   -ForegroundColor Green  }
function Warn($msg) { Write-Host "  $iWarn $msg" -ForegroundColor Yellow }
function Info($msg) { Write-Host "  $iInfo $msg" -ForegroundColor Cyan   }

function Step($n, $total, $msg) {
    Sep
    Log "  $iWrench STEP $n/$total  --  $msg" Cyan
}

function Fail($msg) {
    Sep
    Write-Host "  $iErr FAILED: $msg" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Fix the issue above and re-run .\validate-release.ps1" -ForegroundColor Yellow
    Sep
    exit 1
}

# track each step result for final summary
$results = [ordered]@{}

$env:GIT_PAGER = "cat"
$startTime     = Get-Date

Sep
Log "  $iRkt VALIDATE-RELEASE  --  DRY RUN MODE" Cyan
Log "     package.json -> node/npm -> typecheck -> tests" DarkGray
Log "     -> build -> dist -> bundle size -> benchmark" DarkGray
Log "     No commit. No tag. No publish." DarkGray
Sep

# ===== READ PACKAGE.JSON =====
try {
    if (-not (Test-Path "package.json")) {
        Fail "package.json not found. Run this script from the project root."
    }
    $pkg     = Get-Content "package.json" -Raw | ConvertFrom-Json
    $VERSION = $pkg.version
    $PACKAGE = $pkg.name
    $TAG     = "v$VERSION"
    $AUTHOR  = $pkg.author
    $REPO    = $pkg.repository.url
    $NODE_REQ = if ($pkg.engines.node) { $pkg.engines.node } else { "not specified" }

    Info "Reading package.json..."
    Ok "Package      : $PACKAGE"
    Ok "Version      : $VERSION  (tag: $TAG)"
    Ok "Author       : $AUTHOR"
    Ok "Node engine  : $NODE_REQ"
    Ok "Repo         : $REPO"

    # Print all scripts found
    Sep
    Log "  $iClip SCRIPTS IN package.json" Cyan
    $pkg.scripts.PSObject.Properties | ForEach-Object {
        Write-Host "     $($_.Name.PadRight(20)) : $($_.Value)" -ForegroundColor DarkGray
    }

    # Print peer deps
    Sep
    Log "  $iClip PEER DEPENDENCIES" Cyan
    $pkg.peerDependencies.PSObject.Properties | ForEach-Object {
        Write-Host "     $($_.Name.PadRight(20)) : $($_.Value)" -ForegroundColor White
    }

    # Print optional deps
    Log "  $iClip OPTIONAL DEPENDENCIES" Cyan
    $pkg.optionalDependencies.PSObject.Properties | ForEach-Object {
        Write-Host "     $($_.Name.PadRight(20)) : $($_.Value)" -ForegroundColor DarkGray
    }

    # Print exports
    Sep
    Log "  $iClip EXPORTS" Cyan
    $pkg.exports.PSObject.Properties | ForEach-Object {
        Write-Host "     $($_.Name)" -ForegroundColor Cyan
    }

    $results["package.json"] = "PASS"
} catch {
    Fail "Could not read package.json -- $($_.Exception.Message)"
}

# ===== CHECK NODE + NPM =====
Sep
try {
    Info "Checking Node.js and npm..."
    $nodeVer = node --version 2>&1
    $npmVer  = npm --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "node/npm not found" }
    Ok "Node : $nodeVer"
    Ok "npm  : $npmVer"

    # Check node version satisfies engine requirement
    $nodeMajor = [int]($nodeVer -replace 'v(\d+).*','$1')
    $reqMajor  = [int]($NODE_REQ -replace '[^\d]*(\d+).*','$1')
    if ($nodeMajor -lt $reqMajor) {
        Warn "Node $nodeVer may not satisfy engine requirement: $NODE_REQ"
    } else {
        Ok "Node version satisfies engine requirement ($NODE_REQ)"
    }
    $results["node/npm"] = "PASS"
} catch {
    Fail "Node.js or npm not available -- $($_.Exception.Message)"
}

# ===== NODE_MODULES CHECK =====
Sep
try {
    Info "Checking node_modules..."
    if (-not (Test-Path "node_modules")) {
        Warn "node_modules not found -- running npm install..."
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        Ok "npm install completed"
        $results["node_modules"] = "INSTALLED"
    } else {
        $lockTime = if (Test-Path "package-lock.json") { (Get-Item "package-lock.json").LastWriteTime } else { $null }
        $nmTime   = (Get-Item "node_modules").LastWriteTime
        if ($lockTime -and $lockTime -gt $nmTime) {
            Warn "package-lock.json is newer than node_modules -- running npm install..."
            npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
            Ok "npm install completed (refreshed)"
            $results["node_modules"] = "REFRESHED"
        } else {
            Ok "node_modules present and up to date"
            $results["node_modules"] = "PASS"
        }
    }
} catch {
    Fail "npm install failed -- $($_.Exception.Message)"
}

# ===== STEP 1: VALIDATE package.json =====
Step 1 6 "Validate package.json JSON"
try {
    $null = Get-Content "package.json" -Raw | ConvertFrom-Json
    Ok "package.json is valid JSON"
    $results["1. JSON valid"] = "PASS"
} catch {
    $results["1. JSON valid"] = "FAIL"
    Fail "package.json is invalid JSON -- $($_.Exception.Message)"
}

# ===== STEP 2: TYPECHECK =====
Step 2 6 "TypeScript typecheck"
try {
    Info "Running tsc --noEmit..."
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw "TypeScript errors found" }
    Ok "No type errors"
    $results["2. TypeScript"] = "PASS"
} catch {
    $results["2. TypeScript"] = "FAIL"
    Fail "TypeScript typecheck failed -- $($_.Exception.Message)"
}

# ===== STEP 3: TESTS =====
Step 3 6 "Test suite"
try {
    Info "Running vitest..."
    npm test
    if ($LASTEXITCODE -ne 0) { throw "One or more tests failed" }
    Ok "All tests passed"
    $results["3. Tests"] = "PASS"
} catch {
    $results["3. Tests"] = "FAIL"
    Fail "Tests failed -- $($_.Exception.Message)"
}

# ===== STEP 4: BUILD =====
Step 4 6 "Build"
try {
    Info "Running tsup build..."
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build command failed" }
    Ok "Build complete"
    $results["4. Build"] = "PASS"
} catch {
    $results["4. Build"] = "FAIL"
    Fail "Build failed -- $($_.Exception.Message)"
}

# ===== STEP 5: DIST CHECK + BUNDLE SIZE =====
Step 5 6 "Dist output check + bundle size"
try {
    $required = @(
        "dist/index.cjs",
        "dist/index.mjs",
        "dist/index.d.ts"
    )
    foreach ($f in $required) {
        if (-not (Test-Path $f)) { throw "Missing dist file: $f" }
        $sizeKB = [math]::Round((Get-Item $f).Length / 1KB, 2)
        Ok "Found: $f  ($sizeKB KB)"
    }

    # Full dist size breakdown
    Sep
    Log "  $iSize BUNDLE SIZE BREAKDOWN" Cyan
    $totalBytes = 0
    Get-ChildItem -Path "dist" -Recurse -File | Sort-Object Length -Descending | ForEach-Object {
        $kb = [math]::Round($_.Length / 1KB, 2)
        $totalBytes += $_.Length
        $rel = $_.FullName.Replace("$PWD\dist\", "")

        # Color by file type
        $color = switch -Wildcard ($_.Name) {
            "*.cjs"  { "Yellow" }
            "*.mjs"  { "Cyan"   }
            "*.d.ts" { "White"  }
            default  { "DarkGray" }
        }
        Write-Host ("     {0,-45} {1,8} KB" -f $rel, $kb) -ForegroundColor $color
    }
    $totalKB = [math]::Round($totalBytes / 1KB, 2)
    Sep
    Write-Host "     TOTAL dist size : $totalKB KB" -ForegroundColor Magenta

    # Benchmark thresholds
    if ($totalKB -gt 500) {
        Warn "Bundle is large ($totalKB KB) -- consider tree-shaking or splitting"
    } elseif ($totalKB -gt 100) {
        Warn "Bundle is moderate ($totalKB KB) -- within acceptable range"
    } else {
        Ok "Bundle size is lean ($totalKB KB)"
    }

    $results["5. Dist+Size"] = "PASS"
} catch {
    $results["5. Dist+Size"] = "FAIL"
    Fail "Dist/size check failed -- $($_.Exception.Message)"
}

# ===== STEP 6: BENCHMARK (npm run size) =====
Step 6 6 "Bundle size script (npm run size)"
try {
    # Check if size script exists in package.json
    if ($pkg.scripts.PSObject.Properties.Name -contains "size") {
        Info "Running npm run size..."
        npm run size
        if ($LASTEXITCODE -ne 0) { throw "Size script failed" }
        Ok "Size script completed"
        $results["6. Benchmark"] = "PASS"
    } else {
        Warn "No 'size' script found in package.json -- skipping"
        $results["6. Benchmark"] = "SKIP"
    }
} catch {
    $results["6. Benchmark"] = "WARN"
    Warn "Size script had issues -- $($_.Exception.Message) (non-fatal)"
}

# ===== ELAPSED =====
$elapsed    = (Get-Date) - $startTime
$elapsedStr = "{0:mm\:ss}" -f $elapsed

# ===== FINAL SUMMARY =====
Sep
Log "  $iClip FINAL SUMMARY" Cyan
Sep
$allPassed = $true
foreach ($key in $results.Keys) {
    $val = $results[$key]
    switch ($val) {
        "PASS" { Write-Host "     $iOk $key" -ForegroundColor Green  }
        "FAIL" { Write-Host "     $iErr $key" -ForegroundColor Red; $allPassed = $false }
        "SKIP" { Write-Host "     $iWarn $key (skipped)" -ForegroundColor DarkGray }
        "WARN" { Write-Host "     $iWarn $key (warning)" -ForegroundColor Yellow }
    }
}

Sep
if ($allPassed) {
    Log "  $iOk  ALL CHECKS PASSED  --  DRY RUN COMPLETE" Green
} else {
    Log "  $iErr  SOME CHECKS FAILED  --  FIX BEFORE RELEASING" Red
}
Sep
Write-Host ""
Write-Host "     $iOk  $PACKAGE@$VERSION is ready to release!" -ForegroundColor Green
Write-Host ""
Write-Host "     Package  : $PACKAGE"              -ForegroundColor Cyan
Write-Host "     Version  : $VERSION"              -ForegroundColor Magenta
Write-Host "     Tag      : $TAG"                  -ForegroundColor Magenta
Write-Host "     Author   : $AUTHOR"               -ForegroundColor Cyan
Write-Host "     Repo     : $REPO"                 -ForegroundColor Cyan
Write-Host "     Time     : $elapsedStr"           -ForegroundColor DarkGray
Write-Host ""
Warn "$iLock Nothing was committed, tagged, or published."
Write-Host ""
Sep
Log "  $iNext To publish for real, run your CI/CD or:" White
Write-Host "     npm publish --access public" -ForegroundColor DarkGray
Sep