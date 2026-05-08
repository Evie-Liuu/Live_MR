# prepare_clone.ps1
# This script bundles the project for cloning/distribution based on specific rules.

$ErrorActionPreference = "Stop"

$sourceDir = Get-Location
$parentDir = Split-Path $sourceDir -Parent
$targetDirName = "Live_MR_Export"
$targetDir = Join-Path $parentDir $targetDirName

Write-Host "Preparing project clone in: $targetDir" -ForegroundColor Cyan

# 1. Create target directory
if (Test-Path $targetDir) {
    Write-Host "Removing existing target directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $targetDir
}
New-Item -ItemType Directory -Path $targetDir | Out-Null

# 2. Get all tracked and untracked files (respects .gitignore)
Write-Host "Gathering files (respecting .gitignore)..."
# --cached: tracked files
# --others --exclude-standard: untracked files that are NOT ignored
$trackedFiles = git ls-files --cached --others --exclude-standard

# Filter out the script files themselves
$trackedFiles = $trackedFiles | Where-Object { 
    $_ -ne "prepare_clone.ps1" -and 
    $_ -ne "clone_project.bat"
}

# 3. Define paths to force include even if ignored
$forceIncludePaths = @(
    "frontend/public/mediapipe-*",
    "frontend/public/models",
    "frontend/src/assets/models",
    ".env"
)

# 4. Gather files from force-include paths
$extraFiles = @()
foreach ($pattern in $forceIncludePaths) {
    Write-Host "Checking force-include path: $pattern"
    # Files matching the pattern directly (e.g. .env, *.zip)
    $directFiles = Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue
    # Recurse into directories matching the pattern (wildcard in path stops -Recurse from entering them)
    $dirFiles = Get-ChildItem -Path $pattern -Directory -ErrorAction SilentlyContinue |
                ForEach-Object { Get-ChildItem -Path $_.FullName -Recurse -File -ErrorAction SilentlyContinue }
    $files = @($directFiles) + @($dirFiles) | Where-Object { $_ }
    if ($files) {
        foreach ($file in $files) {
            # Convert to relative path from sourceDir
            $relPath = Resolve-Path -Path $file.FullName -Relative
            $relPath = $relPath -replace "^\.\\", ""
            $extraFiles += $relPath
        }
    }
}

# 5. Combine and filter out test files
$allFiles = ($trackedFiles + $extraFiles) | Sort-Object -Unique

Write-Host "Filtering out test files..."
$filteredFiles = $allFiles | Where-Object {
    $isTest = $_ -match "\.test\." -or 
              $_ -match "\.spec\." -or 
              $_ -match "[\\/]tests[\\/]" -or 
              $_ -match "[\\/]__tests__[\\/]"
    -not $isTest
}

# 6. Copy files
Write-Host "Copying $($filteredFiles.Count) files..."
foreach ($file in $filteredFiles) {
    $srcFile = Join-Path $sourceDir $file
    $dstFile = Join-Path $targetDir $file
    
    $dstDir = Split-Path $dstFile -Parent
    if (-not (Test-Path $dstDir)) {
        New-Item -ItemType Directory -Path $dstDir | Out-Null
    }
    
    Copy-Item -Path $srcFile -Destination $dstFile -Force
}

Write-Host "`nSuccessfully prepared clone in: $targetDir" -ForegroundColor Green
Write-Host "You can now zip this folder or move it to your destination."
